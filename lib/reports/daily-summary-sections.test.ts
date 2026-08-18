import { describe, expect, it } from "vitest"

import type { DailySummary } from "./daily-summary"
import { columnDefs } from "./daily-summary-sections"

describe("daily summary VAT columns", () => {
  it("shows only frozen enabled bands and never a synthetic disabled 0% band", () => {
    const summary: DailySummary = {
      from: "2026-08-18",
      to: "2026-08-18",
      methods: [],
      taxes: ["15.00"],
      sellers: [],
      categories: [],
      rows: [],
    }

    const heads = columnDefs(summary, new Set(["taxes"])).map((column) => column.head)

    expect(heads).toContain("15.00% / VAT")
    expect(heads.some((head) => head.startsWith("0.00%"))).toBe(false)
  })
})
