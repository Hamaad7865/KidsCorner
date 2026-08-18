import { beforeEach, describe, expect, it, vi } from "vitest"

import { fakeClient, type FakeClient } from "./report-fake"

let client: FakeClient

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client,
}))

const { getVatReport } = await import("./vat")

/**
 * The whole VAT report over rows shaped like the real ones.
 *
 * The figures are chosen so every rule has a fingerprint in the answer: if
 * credit notes were added rather than subtracted July would read 85 instead of
 * 65, and if the boundary sale were bucketed by its UTC month June would read
 * 45 instead of 30. Neither mistake looks wrong on its own.
 */
const SALES = [
  // 14:00 in Mauritius on 15 June — June either way.
  { id: 1, sale_date: "2026-06-15T10:00:00+00:00", vat_enabled: false, vat_rate: 0, vat_amount: 0, status: "completed" },
  // 01:14 in Mauritius on 1 JULY, which is 21:14 on 30 June in UTC. This sale's
  // VAT belongs in the July return.
  { id: 2, sale_date: "2026-06-30T21:14:00+00:00", vat_enabled: true, vat_rate: 0.15, vat_amount: 15, status: "completed" },
  { id: 3, sale_date: "2026-07-20T06:00:00+00:00", vat_enabled: true, vat_rate: 0.15, vat_amount: 60, status: "refunded" },
]

const CREDITS = [
  { id: 1, created_at: "2026-07-21T06:00:00+00:00", vat_enabled: true, vat_rate: 0.15, vat_amount: 10 },
  // A disabled sale returned after registration was enabled. It remains outside VAT.
  { id: 2, created_at: "2026-07-22T06:00:00+00:00", vat_enabled: false, vat_rate: 0, vat_amount: 0 },
]

const PURCHASES = [
  { id: 1, purchase_date: "2026-06-12", total_amount: 23000, status: "received", vat_enabled: false, vat_rate: 0, vat_amount: 0 },
  { id: 2, purchase_date: "2026-07-04", total_amount: 11500, status: "received", vat_enabled: true, vat_rate: 0.15, vat_amount: 1500 },
]

// Deliberately opposite to the frozen rows. Historical output must ignore it.
const SETTINGS = [{ value: 0.5 }]

beforeEach(() => {
  client = fakeClient({
    sales: SALES,
    credit_notes: CREDITS,
    purchases: PURCHASES,
    settings: SETTINGS,
  })
})

describe("getVatReport", () => {
  it("files each sale's VAT in the month the SHOP was in", async () => {
    const report = await getVatReport("2026-06-01", "2026-07-31")
    const june = report.months.find((m) => m.month === "2026-06")
    const july = report.months.find((m) => m.month === "2026-07")

    // The disabled June sale remains gross turnover but contributes no output VAT.
    expect(june?.output).toBe(0)
    expect(july?.output).toBe(65)
  })

  it("uses only the VAT frozen when each purchase was received", async () => {
    const report = await getVatReport("2026-06-01", "2026-07-31")
    expect(report.months.find((m) => m.month === "2026-06")?.input).toBe(0)
    expect(report.months.find((m) => m.month === "2026-07")?.input).toBe(1500)
    expect(report.input).toBe(1500)
  })

  it("nets the period and names the months in order", async () => {
    const report = await getVatReport("2026-06-01", "2026-07-31")
    expect(report.output).toBe(65)
    expect(report.net).toBe(-1435)
    expect(report.months.map((m) => m.label)).toEqual(["June 2026", "July 2026"])
    expect(report.months.map((m) => m.net)).toEqual([0, -1435])
  })

  it("shows a month inside the range that had no activity at all", async () => {
    // A quiet month still has a return to file. Skipping it would read as
    // though the shop had never been asked for one.
    const report = await getVatReport("2026-05-01", "2026-07-31")
    expect(report.months.map((m) => m.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
    ])
    expect(report.months[0]).toMatchObject({ output: 0, input: 0, net: 0 })
  })

  it("reads only received purchases and only sales that charged VAT", async () => {
    // Invisible in the totals above, because the fake returns whatever it is
    // given. A draft order has not been invoiced and a void sale charged
    // nothing — both would inflate a return that is filed with the MRA.
    await getVatReport("2026-06-01", "2026-07-31")
    expect(client.filtersOn("purchases")).toContainEqual([
      "eq",
      "status",
      "received",
    ])
    expect(client.filtersOn("sales")).toContainEqual([
      "in",
      "status",
      ["completed", "refunded"],
    ])
  })

  it("does not expose today's configured rate as a historical report fact", async () => {
    const report = await getVatReport("2026-06-01", "2026-07-31")
    expect(report).not.toHaveProperty("rate")
    expect(report.counts).toEqual({ sales: 3, credits: 2, purchases: 2 })
  })
})
