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
  { id: 1, sale_date: "2026-07-02T06:00:00+00:00", total: 230, vat_enabled: true, vat_rate: 0.15, vat_amount: 30, status: "completed" },
  { id: 2, sale_date: "2026-07-10T06:00:00+00:00", total: 115, vat_enabled: true, vat_rate: 0.15, vat_amount: 15, status: "completed" },
  { id: 3, sale_date: "2026-07-20T06:00:00+00:00", total: 460, vat_enabled: true, vat_rate: 0.15, vat_amount: 60, status: "refunded" },
]

const CREDITS = [
  { id: 1, created_at: "2026-07-21T06:00:00+00:00", total: 76.67, vat_enabled: true, vat_rate: 0.15, vat_amount: 10 },
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

  it("uses each latest received purchase snapshot for VAT-exclusive inventory cost", async () => {
    client = fakeClient({
      sales: [
        {
          id: 1,
          sale_date: "2026-07-10T06:00:00+00:00",
          total: 230,
          vat_enabled: false,
          vat_rate: 0,
          vat_amount: 0,
          status: "completed",
        },
      ],
      sale_items: [
        {
          qty: 1,
          variant_id: 101,
          product_variants: { cost_price: 115 },
        },
        {
          qty: 1,
          variant_id: 202,
          product_variants: { cost_price: 115 },
        },
      ],
      purchases: [
        {
          id: 12,
          status: "received",
          total_amount: 115,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [{ variant_id: 101, qty: 1, unit_cost: 115 }],
        },
        {
          id: 11,
          status: "received",
          total_amount: 115,
          vat_enabled: true,
          vat_amount: 15,
          purchase_items: [{ variant_id: 202, qty: 1, unit_cost: 115 }],
        },
      ],
      stock_movements: [
        {
          id: 2,
          variant_id: 101,
          movement_type: "purchase",
          reference_type: "purchase",
          reference_id: 12,
          qty: 1,
          created_at: "2026-07-04T10:00:00+00:00",
          created_by: null,
          location_id: null,
          notes: null,
        },
        {
          id: 1,
          variant_id: 202,
          movement_type: "purchase",
          reference_type: "purchase",
          reference_id: 11,
          qty: 1,
          created_at: "2026-07-03T10:00:00+00:00",
          created_by: null,
          location_id: null,
          notes: null,
        },
      ],
      // Deliberately unrelated to both receipt snapshots. A report that asks
      // today's setting for historical cost would produce a different result.
      settings: [{ key: "vat_rate", value: 0.5 }],
    })

    const report = await getPnlReport("2026-07-01", "2026-07-31")

    // Disabled receipt: Rs115 gross cost. Enabled receipt: Rs115 - Rs15 VAT.
    expect(report.cost).toBe(215)
    expect(report.gross).toBe(15)
  })

  it("chooses the last receipt movement when draft ids were created in the opposite order", async () => {
    client = fakeClient({
      sales: [
        {
          id: 1,
          sale_date: "2026-07-10T06:00:00+00:00",
          total: 230,
          vat_enabled: false,
          vat_rate: 0,
          vat_amount: 0,
          status: "completed",
        },
      ],
      sale_items: [
        {
          qty: 1,
          variant_id: 101,
          product_variants: { cost_price: 130 },
        },
      ],
      stock_movements: [
        {
          id: 502,
          variant_id: 101,
          movement_type: "purchase",
          reference_type: "purchase",
          reference_id: 10,
          qty: 1,
          created_at: "2026-07-04T10:00:00+00:00",
          created_by: null,
          location_id: null,
          notes: null,
        },
        {
          id: 501,
          variant_id: 101,
          movement_type: "purchase",
          reference_type: "purchase",
          reference_id: 20,
          qty: 1,
          created_at: "2026-07-03T10:00:00+00:00",
          created_by: null,
          location_id: null,
          notes: null,
        },
      ],
      // PostgREST returns the current implementation's purchase-id order:
      // higher draft id first, even though its receipt movement is older.
      purchases: [
        {
          id: 20,
          status: "received",
          total_amount: 115,
          vat_enabled: true,
          vat_amount: 15,
          purchase_items: [{ variant_id: 101, qty: 1, unit_cost: 115 }],
        },
        {
          id: 10,
          status: "received",
          total_amount: 130,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [{ variant_id: 101, qty: 1, unit_cost: 130 }],
        },
      ],
    })

    const report = await getPnlReport("2026-07-01", "2026-07-31")

    expect(report.cost).toBe(130)
    expect(client.filtersOn("stock_movements")).toContainEqual([
      "eq",
      "movement_type",
      "purchase",
    ])
    expect(client.filtersOn("stock_movements")).toContainEqual([
      "eq",
      "reference_type",
      "purchase",
    ])
    expect(client.filtersOn("stock_movements")).toContainEqual([
      "not",
      "reference_id",
      "is",
      null,
    ])
    expect(client.filtersOn("stock_movements")).toContainEqual([
      "order",
      "created_at",
      { ascending: false },
    ])
    expect(client.filtersOn("stock_movements")).toContainEqual([
      "order",
      "id",
      { ascending: false },
    ])
    expect(client.filtersOn("purchases")).toContainEqual([
      "eq",
      "status",
      "received",
    ])
  })

  it("skips an unreceived newest candidate and breaks equal receipt times by movement id", async () => {
    client = fakeClient({
      sales: [
        {
          id: 1,
          sale_date: "2026-07-10T06:00:00+00:00",
          total: 230,
          vat_enabled: false,
          vat_rate: 0,
          vat_amount: 0,
          status: "completed",
        },
      ],
      sale_items: [
        {
          qty: 1,
          variant_id: 101,
          product_variants: { cost_price: 999 },
        },
      ],
      // Deliberately unsorted: correctness must not depend on PostgREST or on
      // the report fake applying the requested order.
      stock_movements: [
        {
          id: 100,
          variant_id: 101,
          reference_id: 10,
          created_at: "2026-07-01T10:00:00+00:00",
        },
        {
          id: 300,
          variant_id: 101,
          reference_id: 999,
          created_at: "2026-07-03T10:00:00+00:00",
        },
        {
          id: 201,
          variant_id: 101,
          reference_id: 20,
          created_at: "2026-07-02T10:00:00+00:00",
        },
        {
          id: 202,
          variant_id: 101,
          reference_id: 30,
          created_at: "2026-07-02T10:00:00+00:00",
        },
      ],
      purchases: [
        {
          id: 10,
          status: "received",
          total_amount: 110,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [{ variant_id: 101, qty: 1, unit_cost: 110 }],
        },
        {
          id: 20,
          status: "received",
          total_amount: 120,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [{ variant_id: 101, qty: 1, unit_cost: 120 }],
        },
        {
          id: 30,
          status: "received",
          total_amount: 130,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [{ variant_id: 101, qty: 1, unit_cost: 130 }],
        },
        // The fake intentionally returns this despite the server-side filter,
        // proving application code validates the selected header status.
        {
          id: 999,
          status: "draft",
          total_amount: 999,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [{ variant_id: 101, qty: 1, unit_cost: 999 }],
        },
      ],
    })

    const report = await getPnlReport("2026-07-01", "2026-07-31")

    // Draft 999 is skipped. Purchases 20 and 30 share a timestamp, so the
    // higher receipt movement id selects purchase 30.
    expect(report.cost).toBe(130)
  })

  it("weights duplicate variant lines by quantity without counting duplicate movements", async () => {
    client = fakeClient({
      sales: [
        {
          id: 1,
          sale_date: "2026-07-10T06:00:00+00:00",
          total: 600,
          vat_enabled: false,
          vat_rate: 0,
          vat_amount: 0,
          status: "completed",
        },
      ],
      sale_items: [
        {
          qty: 2,
          variant_id: 202,
          product_variants: { cost_price: 999 },
        },
      ],
      stock_movements: [
        {
          id: 401,
          variant_id: 202,
          reference_id: 40,
          created_at: "2026-07-04T10:00:00+00:00",
        },
        {
          id: 400,
          variant_id: 202,
          reference_id: 40,
          created_at: "2026-07-04T10:00:00+00:00",
        },
      ],
      purchases: [
        {
          id: 40,
          status: "received",
          total_amount: 520,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [
            { variant_id: 202, qty: 1, unit_cost: 100 },
            { variant_id: 202, qty: 3, unit_cost: 140 },
          ],
        },
      ],
    })

    const report = await getPnlReport("2026-07-01", "2026-07-31")

    // Weighted unit cost is (1*100 + 3*140) / 4 = 130. Two sold units cost
    // 260; the duplicate receipt movement must not apply that cost twice.
    expect(report.cost).toBe(260)
  })

  it("sorts every returned receipt before applying the report row cap", async () => {
    const olderReceipts = Array.from({ length: 5_000 }, (_, index) => ({
      id: index + 1,
      variant_id: 101,
      reference_id: 10,
      created_at: "2026-07-01T10:00:00+00:00",
    }))

    client = fakeClient({
      sales: [
        {
          id: 1,
          sale_date: "2026-07-10T06:00:00+00:00",
          total: 300,
          vat_enabled: false,
          vat_rate: 0,
          vat_amount: 0,
          status: "completed",
        },
      ],
      sale_items: [
        {
          qty: 1,
          variant_id: 101,
          product_variants: { cost_price: 999 },
        },
      ],
      // The fake does not apply PostgREST ordering. The true newest receipt is
      // deliberately the 5,001st response row and must survive the local cap.
      stock_movements: [
        ...olderReceipts,
        {
          id: 5_001,
          variant_id: 101,
          reference_id: 20,
          created_at: "2026-07-05T10:00:00+00:00",
        },
      ],
      purchases: [
        {
          id: 10,
          status: "received",
          total_amount: 110,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [{ variant_id: 101, qty: 1, unit_cost: 110 }],
        },
        {
          id: 20,
          status: "received",
          total_amount: 130,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [{ variant_id: 101, qty: 1, unit_cost: 130 }],
        },
      ],
    })

    const report = await getPnlReport("2026-07-01", "2026-07-31")

    expect(report.cost).toBe(130)
    expect(report.truncated).toBe(true)
  })

  it("ignores a receipt with a malformed timestamp and uses catalogue cost", async () => {
    client = fakeClient({
      sales: [
        {
          id: 1,
          sale_date: "2026-07-10T06:00:00+00:00",
          total: 200,
          vat_enabled: false,
          vat_rate: 0,
          vat_amount: 0,
          status: "completed",
        },
      ],
      sale_items: [
        {
          qty: 1,
          variant_id: 202,
          product_variants: { cost_price: 77 },
        },
      ],
      stock_movements: [
        {
          id: 600,
          variant_id: 202,
          reference_id: 60,
          created_at: "not-a-timestamp",
        },
      ],
      purchases: [
        {
          id: 60,
          status: "received",
          total_amount: 999,
          vat_enabled: false,
          vat_amount: 0,
          purchase_items: [{ variant_id: 202, qty: 1, unit_cost: 999 }],
        },
      ],
    })

    const report = await getPnlReport("2026-07-01", "2026-07-31")

    expect(report.cost).toBe(77)
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
