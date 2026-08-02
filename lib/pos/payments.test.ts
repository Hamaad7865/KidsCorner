import { describe, expect, it } from "vitest"

import { changeDue, outstandingOn, withPayment, type Payment } from "./payments"

/**
 * Split payments — what the shop records as taken.
 *
 * The case that matters most is the second one: a take clamped against a stale
 * balance records more than the sale is worth, which inflates the Z's cash line
 * and leaves the drawer looking short at close. Nothing downstream catches it,
 * because `commitSale` checks for under-payment and not over.
 */

const cash = (amount: number, tendered: number | null = null): Payment => ({
  method: "cash",
  amount,
  tendered,
})

describe("withPayment", () => {
  it("records a payment that is less than the balance in full", () => {
    const rows = withPayment([], 1_000, "cash", 400, null)
    expect(rows).toEqual([{ method: "cash", amount: 400, tendered: null }])
  })

  it("clamps a payment larger than the balance — the excess is change", () => {
    const rows = withPayment([], 1_000, "cash", 2_000, 2_000)
    expect(rows[0]?.amount).toBe(1_000)
    // The tendered figure is kept as handed over, so change can be worked out.
    expect(rows[0]?.tendered).toBe(2_000)
  })

  it("measures each take against what is ALREADY recorded, not a stale balance", () => {
    // Two takes of the full amount, as a double press would produce if both
    // landed before a re-render. The second must see the first.
    let rows = withPayment([], 1_000, "cash", 1_000, 1_000)
    rows = withPayment(rows, 1_000, "cash", 1_000, 1_000)

    expect(rows).toHaveLength(1)
    expect(rows.reduce((sum, p) => sum + p.amount, 0)).toBe(1_000)
  })

  it("is a no-op once the sale is covered", () => {
    const covered = [cash(1_000)]
    expect(withPayment(covered, 1_000, "card", 500, null)).toBe(covered)
  })

  it("builds a split across methods, totalling exactly the sale", () => {
    let rows: Payment[] = []
    rows = withPayment(rows, 1_451.42, "card", 1_000, null)
    rows = withPayment(rows, 1_451.42, "cash", 500, 500)

    expect(rows).toHaveLength(2)
    expect(rows[1]?.amount).toBe(451.42) // clamped to what was left
    expect(outstandingOn(rows, 1_451.42)).toBe(0)
  })

  it("ignores a zero or negative take", () => {
    const rows: Payment[] = []
    expect(withPayment(rows, 1_000, "cash", 0, null)).toBe(rows)
    expect(withPayment(rows, 1_000, "cash", -50, null)).toBe(rows)
    expect(withPayment(rows, 1_000, "cash", Number.NaN, null)).toBe(rows)
  })

  it("rounds to the cent rather than carrying a float tail", () => {
    const rows = withPayment([], 100, "cash", 33.333, null)
    expect(rows[0]?.amount).toBe(33.33)
  })
})

describe("changeDue", () => {
  it("is what was handed over beyond the cash owed", () => {
    expect(changeDue([cash(1_306.28, 1_500)])).toBe(193.72)
  })

  it("is nothing when the cash was exact", () => {
    expect(changeDue([cash(1_000, 1_000)])).toBe(0)
  })

  it("never goes negative", () => {
    expect(changeDue([cash(1_000, 500)])).toBe(0)
  })

  it("ignores non-cash rows entirely", () => {
    // A card payment cannot produce change from the drawer.
    expect(changeDue([{ method: "card", amount: 1_000, tendered: 5_000 }])).toBe(0)
  })

  it("does not let over-tendering on cash offset a card row", () => {
    // 500 cash tendered against 400 of cash owed is 100 change — the 600 taken
    // by card has nothing to do with the drawer.
    const rows: Payment[] = [
      { method: "card", amount: 600, tendered: null },
      cash(400, 500),
    ]
    expect(changeDue(rows)).toBe(100)
  })

  it("sums across several cash rows", () => {
    expect(changeDue([cash(300, 500), cash(200, 200)])).toBe(200)
  })

  it("does not let a cash row with no tendered figure eat another's change", () => {
    // Rs 500 taken without recording what was handed over, then Rs 500 paid
    // with a Rs 1,000 note. The note is worth Rs 500 change on its own row.
    //
    // Totalling the tendered figures and subtracting the total cash owed gave
    // zero here — the first row's amount cancelled the second row's note —
    // which disagreed with the tablet till, where the same split has always
    // been measured a row at a time.
    const rows: Payment[] = [
      { method: "cash", amount: 500, tendered: null },
      cash(500, 1_000),
    ]
    expect(changeDue(rows)).toBe(500)
  })

  it("does not let a short row eat a long one", () => {
    // Rs 100 over on the first, Rs 100 under on the second. Under is not
    // change owed back, so it cannot cancel the note that was.
    expect(changeDue([cash(400, 500), cash(600, 500)])).toBe(100)
  })
})

describe("outstandingOn", () => {
  it("is the whole sale before anything is paid", () => {
    expect(outstandingOn([], 1_451.42)).toBe(1_451.42)
  })

  it("falls as rows are added and never goes below zero", () => {
    expect(outstandingOn([cash(1_000)], 1_451.42)).toBe(451.42)
    expect(outstandingOn([cash(2_000)], 1_451.42)).toBe(0)
  })
})
