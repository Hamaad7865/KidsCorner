import { describe, expect, it } from "vitest"

import { settleCreditTender, type PaymentInput, type TillClient } from "./sale-core"

/**
 * The credit tender gate.
 *
 * A trigger on `sale_payments` enforces these rules in the database, so none of
 * this is what makes them true. What is tested here is the part the database
 * cannot do: refusing early, and refusing with a sentence a cashier can act on.
 * A raw `check_violation` through PostgREST is not one.
 *
 * There is no ceiling any more: an open account may run a tab of any size. The
 * two things left to check are that the customer has an OPEN account and that
 * it is not on hold.
 *
 * The other property worth locking down is that an ordinary paid sale — which
 * is nearly all of them — costs no query at all.
 */

type AccountRow = {
  full_name: string | null
  credit_enabled: boolean | null
  credit_on_hold: boolean | null
}

/** Counts reads so "an ordinary sale asks the database nothing" is testable. */
function stubClient(account: AccountRow | null, error: { message: string } | null = null) {
  const state = { reads: 0 }
  const client = {
    from(table: string) {
      if (table !== "customer_credit_accounts") {
        throw new Error(`unexpected table ${table}`)
      }
      state.reads += 1
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => ({ data: error ? null : account, error }),
          }),
        }),
      }
    },
  } as unknown as TillClient
  return { client, state }
}

function pay(method: string, amount: number): PaymentInput {
  return { method, amount, tendered: method === "cash" ? amount : null }
}

const OPEN_ACCOUNT: AccountRow = {
  full_name: "Rita Appadoo",
  credit_enabled: true,
  credit_on_hold: false,
}

describe("settleCreditTender", () => {
  it("does nothing, and asks nothing, for a sale with no credit tender", async () => {
    const { client, state } = stubClient(OPEN_ACCOUNT)
    const result = await settleCreditTender(client, 5, [pay("cash", 500)])

    expect(result).toEqual({ credit: 0 })
    expect(state.reads).toBe(0)
  })

  it("does not read the account for a walk-in paying cash", async () => {
    const { client, state } = stubClient(null)
    expect(await settleCreditTender(client, null, [pay("card", 200)])).toEqual({
      credit: 0,
    })
    expect(state.reads).toBe(0)
  })

  it("refuses a credit tender with no customer attached", async () => {
    const { client, state } = stubClient(OPEN_ACCOUNT)
    const result = await settleCreditTender(client, null, [pay("credit", 500)])

    expect(result).toEqual({
      error: "A sale on account needs a customer. Attach one, or take payment now.",
    })
    // There is nobody to look up, so it must not have tried.
    expect(state.reads).toBe(0)
  })

  it("refuses when the customer has no account", async () => {
    const { client } = stubClient({ ...OPEN_ACCOUNT, credit_enabled: false })
    const result = await settleCreditTender(client, 5, [pay("credit", 500)])

    expect("error" in result && result.error).toContain("does not have a credit account")
    expect("error" in result && result.error).toContain("Rita Appadoo")
  })

  it("refuses when the account is on hold", async () => {
    const { client } = stubClient({ ...OPEN_ACCOUNT, credit_on_hold: true })
    const result = await settleCreditTender(client, 5, [pay("credit", 100)])

    expect("error" in result && result.error).toContain("on hold")
  })

  it("allows a charge of any size on an open account", async () => {
    // The whole point of dropping the limit: no figure refuses this.
    const { client } = stubClient(OPEN_ACCOUNT)
    expect(await settleCreditTender(client, 5, [pay("credit", 5_000_000)])).toEqual({
      credit: 5_000_000,
    })
  })

  it("sums several credit rows into one total", async () => {
    const { client } = stubClient(OPEN_ACCOUNT)
    expect(
      await settleCreditTender(client, 5, [pay("credit", 600), pay("credit", 600)]),
    ).toEqual({ credit: 1_200 })
  })

  it("measures only the credit part of a split tender", async () => {
    const { client } = stubClient(OPEN_ACCOUNT)
    // Rs 700 of the Rs 800 sale is cash, so only Rs 100 touches the account.
    const result = await settleCreditTender(client, 5, [
      pay("cash", 700),
      pay("credit", 100),
    ])

    expect(result).toEqual({ credit: 100 })
  })

  it("refuses when the customer has vanished", async () => {
    const { client } = stubClient(null)
    expect(await settleCreditTender(client, 5, [pay("credit", 100)])).toEqual({
      error: "That customer no longer exists.",
    })
  })

  it("passes a read failure through rather than guessing", async () => {
    const { client } = stubClient(OPEN_ACCOUNT, { message: "connection reset" })
    expect(await settleCreditTender(client, 5, [pay("credit", 100)])).toEqual({
      error: "connection reset",
    })
  })

  it("ignores a zero-amount credit row", async () => {
    const { client, state } = stubClient(OPEN_ACCOUNT)
    expect(await settleCreditTender(client, 5, [pay("credit", 0)])).toEqual({
      credit: 0,
    })
    expect(state.reads).toBe(0)
  })

  it("rounds the credit total it returns", async () => {
    const { client } = stubClient(OPEN_ACCOUNT)
    // 33.333 + 33.333 = 66.666, rounded to the cent.
    expect(
      await settleCreditTender(client, 5, [pay("credit", 33.333), pay("credit", 33.333)]),
    ).toEqual({ credit: 66.67 })
  })
})
