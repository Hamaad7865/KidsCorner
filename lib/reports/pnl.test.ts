import { describe, expect, it } from "vitest"

import { groupPayouts } from "./pnl"

describe("groupPayouts", () => {
  it("counts only money leaving the drawer", () => {
    // A positive till movement is a float top-up or change from the safe. It
    // costs the shop nothing, and counting it as an expense would turn every
    // morning's float into a loss.
    const rows = groupPayouts([
      { amount: -500, reason: "Paid the bread supplier" },
      { amount: 2000, reason: "Opening float top-up" },
    ])
    expect(rows).toEqual([
      { reason: "Paid the bread supplier", amount: 500, count: 1 },
    ])
  })

  it("folds the same reason typed two ways into one row", () => {
    // Free text at a counter. Two rows for "Petty cash" and "petty cash" would
    // invite the owner to add them up by hand — and to get it wrong.
    const rows = groupPayouts([
      { amount: -100, reason: "Petty cash" },
      { amount: -250, reason: "petty cash " },
    ])
    expect(rows).toEqual([{ reason: "Petty cash", amount: 350, count: 2 }])
  })

  it("puts the biggest expense first", () => {
    const rows = groupPayouts([
      { amount: -100, reason: "Taxi" },
      { amount: -900, reason: "Stock from the market" },
      { amount: -400, reason: "Cleaner" },
    ])
    expect(rows.map((r) => r.reason)).toEqual([
      "Stock from the market",
      "Cleaner",
      "Taxi",
    ])
  })

  it("names an unexplained pay-out rather than hiding it", () => {
    const rows = groupPayouts([
      { amount: -75, reason: null },
      { amount: -25, reason: "   " },
    ])
    expect(rows).toEqual([{ reason: "No reason given", amount: 100, count: 2 }])
  })

  it("rounds at each step rather than accumulating float drift", () => {
    const rows = groupPayouts([
      { amount: -0.1, reason: "Bag" },
      { amount: -0.2, reason: "Bag" },
    ])
    expect(rows[0]?.amount).toBe(0.3)
  })

  it("returns nothing for a period with no pay-outs", () => {
    expect(groupPayouts([])).toEqual([])
    expect(groupPayouts([{ amount: 500, reason: "Float" }])).toEqual([])
  })
})
