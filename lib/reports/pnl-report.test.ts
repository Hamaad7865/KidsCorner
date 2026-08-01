import { beforeEach, describe, expect, it, vi } from "vitest"

import { fakeClient, type FakeClient } from "./report-fake"

let client: FakeClient

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client,
}))

const { getPnlReport } = await import("./pnl")

/**
 * The whole P&L over rows shaped like the real ones.
 *
 * Every figure is chosen to have a fingerprint. Revenue is VAT-exclusive, so a
 * report that forgot to take VAT out would read 805 rather than 700; a return
 * that failed to put its stock back would leave cost at 220 rather than 170.
 */
const SALES = [
  { id: 1, sale_date: "2026-07-02T06:00:00+00:00", total: 230, vat_amount: 30, status: "completed" },
  { id: 2, sale_date: "2026-07-10T06:00:00+00:00", total: 115, vat_amount: 15, status: "completed" },
  { id: 3, sale_date: "2026-07-20T06:00:00+00:00", total: 460, vat_amount: 60, status: "refunded" },
]

const CREDITS = [
  { id: 1, created_at: "2026-07-21T06:00:00+00:00", total: 76.67, vat_amount: 10 },
]

const ITEMS = [
  { qty: 2, product_variants: { cost_price: 50 } },
  { qty: 1, product_variants: { cost_price: 120 } },
]

const RETURNED = [{ qty: 1, product_variants: { cost_price: 50 } }]

function build(movements: unknown[] = []) {
  return fakeClient({
    sales: SALES,
    credit_notes: CREDITS,
    sale_items: ITEMS,
    credit_note_items: RETURNED,
    till_movements: movements,
  })
}

beforeEach(() => {
  client = build()
})

describe("getPnlReport", () => {
  it("states revenue net of VAT and net of credit notes", async () => {
    // 200 + 100 + 400 sold, less the 66.67 net of the credit note.
    const report = await getPnlReport("2026-07-01", "2026-07-31")
    expect(report.revenue).toBe(633.33)
  })

  it("puts returned stock back rather than counting it as consumed", async () => {
    // 100 + 120 left the shelf, 50 of it came back.
    const report = await getPnlReport("2026-07-01", "2026-07-31")
    expect(report.cost).toBe(170)
    expect(report.gross).toBe(463.33)
    expect(report.grossPct).toBeCloseTo(73.16, 2)
  })

  it("takes only money that left the drawer off the bottom line", async () => {
    client = build([
      { id: 1, amount: -500, reason: "Paid the bread supplier" },
      { id: 2, amount: -250, reason: "petty cash" },
      { id: 3, amount: -100, reason: "Petty cash" },
      // A float top-up. It is cash arriving and costs the shop nothing — the
      // query excludes it, and `groupPayouts` would too.
      { id: 4, amount: 2000, reason: "Opening float" },
    ])

    const report = await getPnlReport("2026-07-01", "2026-07-31")
    expect(report.expenses).toBe(850)
    expect(report.expenseRows).toEqual([
      { reason: "Paid the bread supplier", amount: 500, count: 1 },
      { reason: "petty cash", amount: 350, count: 2 },
    ])
    expect(report.net).toBe(-386.67)
  })

  it("shows a profit when the pay-outs are smaller than the margin", async () => {
    client = build([{ id: 1, amount: -63.33, reason: "Taxi" }])
    const report = await getPnlReport("2026-07-01", "2026-07-31")
    expect(report.net).toBe(400)
  })

  it("reads only sales that took money", async () => {
    // A void sale rang nothing up. Counting it would put revenue on the shop
    // that it never had, and cost against stock that never left.
    await getPnlReport("2026-07-01", "2026-07-31")
    expect(client.filtersOn("sales")).toContainEqual([
      "in",
      "status",
      ["completed", "refunded"],
    ])
    expect(client.filtersOn("sale_items")).toContainEqual([
      "in",
      "sales.status",
      ["completed", "refunded"],
    ])
    expect(client.filtersOn("till_movements")).toContainEqual(["lt", "amount", 0])
  })

  it("gives no margin percentage for a period that sold nothing", async () => {
    client = fakeClient({})
    const report = await getPnlReport("2026-07-01", "2026-07-31")
    expect(report).toMatchObject({
      revenue: 0,
      cost: 0,
      gross: 0,
      grossPct: 0,
      expenses: 0,
      net: 0,
    })
  })
})
