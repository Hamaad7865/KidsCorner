import { describe, expect, it } from "vitest"

import { shopDayOf } from "@/lib/format"
import { bucketOf, frozenVatAmount, monthLabel, monthsBetween } from "./vat"

describe("frozenVatAmount", () => {
  it("excludes a disabled document even if a stale amount is present", () => {
    expect(frozenVatAmount({ vatEnabled: false, vatAmount: 999 })).toBe(0)
  })

  it("uses the amount frozen on an enabled document", () => {
    expect(frozenVatAmount({ vatEnabled: true, vatAmount: 15 })).toBe(15)
  })
})

describe("monthsBetween", () => {
  it("fills every month the range touches, including the empty ones", () => {
    // A quarter with no sales in February still has a return to file, so the
    // ladder must show it at zero rather than skipping from January to March.
    expect(monthsBetween("2026-01-15", "2026-03-02")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ])
  })

  it("rolls the year over at December", () => {
    expect(monthsBetween("2025-11-01", "2026-02-28")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ])
  })

  it("gives one month for a range inside a single month", () => {
    expect(monthsBetween("2026-07-03", "2026-07-29")).toEqual(["2026-07"])
  })

  it("returns nothing for a range typed backwards", () => {
    expect(monthsBetween("2026-07-01", "2026-01-01")).toEqual([])
  })

  it("caps a mistyped century rather than building thousands of rows", () => {
    const months = monthsBetween("1900-01-01", "2026-12-31")
    expect(months).toHaveLength(60)
    expect(months[0]).toBe("1900-01")
  })
})

describe("monthLabel", () => {
  it("names the month in full with its year", () => {
    expect(monthLabel("2026-07")).toBe("July 2026")
    expect(monthLabel("2026-01")).toBe("January 2026")
    expect(monthLabel("2025-12")).toBe("December 2025")
  })
})

describe("bucketOf", () => {
  const ladder = () =>
    new Map([
      ["2026-06", { output: 0, input: 0 }],
      ["2026-07", { output: 0, input: 0 }],
    ])

  it("adds output and input into the month named", () => {
    const months = ladder()
    bucketOf(months, "2026-07", 150, 0)
    bucketOf(months, "2026-07", 0, 40)
    expect(months.get("2026-07")).toEqual({ output: 150, input: 40 })
  })

  it("subtracts a credit note from the month it was raised in", () => {
    const months = ladder()
    bucketOf(months, "2026-07", 150, 0)
    bucketOf(months, "2026-07", -50, 0)
    expect(months.get("2026-07")?.output).toBe(100)
  })

  it("ignores a month outside the range instead of inventing a row", () => {
    const months = ladder()
    bucketOf(months, "2026-09", 999, 0)
    expect(months.has("2026-09")).toBe(false)
    expect([...months.values()].every((b) => b.output === 0)).toBe(true)
  })

  it("rounds at each step rather than accumulating float drift", () => {
    const months = ladder()
    bucketOf(months, "2026-06", 0.1, 0)
    bucketOf(months, "2026-06", 0.2, 0)
    expect(months.get("2026-06")?.output).toBe(0.3)
  })
})

describe("the month a sale's VAT is filed under", () => {
  it("uses the shop's calendar month, not UTC's", () => {
    // 01:14 on 1 July in Mauritius is 21:14 on 30 June in UTC. Slicing the ISO
    // string files that sale's VAT in the WRONG return — one month early — and
    // both returns are then wrong by the same amount. This is the same defect
    // that put a 01:14 sale on the previous day in the cash-flow view.
    const instant = "2026-06-30T21:14:00+00:00"
    expect(instant.slice(0, 7)).toBe("2026-06")
    expect(shopDayOf(instant).slice(0, 7)).toBe("2026-07")
  })

  it("keeps a late-evening sale in the month it was rung up", () => {
    // 23:30 on 31 July MU is 19:30 on 31 July UTC — same month either way.
    // The pair matters: without it the test above could pass on a rule that
    // simply shifted everything forward.
    const instant = "2026-07-31T19:30:00+00:00"
    expect(shopDayOf(instant).slice(0, 7)).toBe("2026-07")
  })
})
