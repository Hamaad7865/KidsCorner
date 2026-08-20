import { describe, expect, it } from "vitest"

import { settleCreditTender, type PaymentInput, type TillClient } from "./sale-core"

/**
 * The credit tender gate.
 *
 * A trigger on `sale_payments` enforces every one of these rules in the
 * database, so none of this is what makes them true. What is tested here is the
 * part the database cannot do: refusing early, and refusing with a sentence a
 * cashier can act on. A raw `check_violation` through PostgREST is not one.
 *
 * The other property worth locking down is that an ordinary paid sale — which
 * is nearly all of them — costs no query at all.
 */

type AccountRow = {
  full_name: string | null
  credit_limit: number | null
  credit_on_hold: boolean | null
  balance: number | null
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
  credit_limit: 1_000,
  credit_on_hold: false,
  balance: 0,
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
    const { client } = stubClient({ ...OPEN_ACCOUNT, credit_limit: 0 })
    const result = await settleCreditTender(client, 5, [pay("credit", 500)])

    expect(result).toMatchObject({})
    expect("error" in result && result.error).toContain("does not have a credit account")
    expect("error" in result && result.error).toContain("Rita Appadoo")
  })

  it("refuses when the account is on hold", async () => {
    const { client } = stubClient({ ...OPEN_ACCOUNT, credit_on_hold: true })
    const result = await settleCreditTender(client, 5, [pay("credit", 100)])

    expect("error" in result && result.error).toContain("on hold")
  })

  it("refuses when the charge would pass the limit, and says by how much", async () => {
    const { client } = stubClient({ ...OPEN_ACCOUNT, balance: 900 })
    const result = await settleCreditTender(client, 5, [pay("credit", 200)])

    const message = "error" in result ? result.error : ""
    expect(message).toContain("Rs 900.00")
    expect(message).toContain("Rs 1,000.00")
    expect(message).toContain("Rs 200.00")
  })

  it("allows a charge that lands exactly on the limit", async () => {
    const { client } = stubClient({ ...OPEN_ACCOUNT, balance: 800 })
    expect(await settleCreditTender(client, 5, [pay("credit", 200)])).toEqual({
      credit: 200,
    })
  })

  it("measures only the credit part of a split tender", async () => {
    const { client } = stubClient({ ...OPEN_ACCOUNT, balance: 900 })
    // Rs 700 of the Rs 800 sale is cash, so only Rs 100 touches the account —
    // which fits under the limit even though the sale does not.
    const result = await settleCreditTender(client, 5, [
      pay("cash", 700),
      pay("credit", 100),
    ])

    expect(result).toEqual({ credit: 100 })
  })

  it("sums several credit rows before checking the limit", async () => {
    const { client } = stubClient({ ...OPEN_ACCOUNT, balance: 0 })
    const result = await settleCreditTender(client, 5, [
      pay("credit", 600),
      pay("credit", 600),
    ])

    // 1,200 against a 1,000 limit: refused. Checked one row at a time, both
    // would have passed.
    expect("error" in result).toBe(true)
  })

  it("lets an account in credit spend what the shop is holding for it", async () => {
    const { client } = stubClient({ ...OPEN_ACCOUNT, balance: -300 })
    // A negative balance means the shop owes them, so there is more room than
    // the limit alone: -300 + 1,200 is still under 1,000.
    expect(await settleCreditTender(client, 5, [pay("credit", 1_200)])).toEqual({
      credit: 1_200,
    })
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

  it("rounds the credit total before comparing it to the limit", async () => {
    const { client } = stubClient({ ...OPEN_ACCOUNT, balance: 999.99 })
    // 999.99 + 0.01 is exactly the limit, and must not fail on float drift.
    expect(await settleCreditTender(client, 5, [pay("credit", 0.01)])).toEqual({
      credit: 0.01,
    })
  })
})
