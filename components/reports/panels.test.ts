import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PnlStatement } from "@/components/reports/pnl-statement"
import { VatReturn } from "@/components/reports/vat-return"
import type { PnlReport } from "@/lib/reports/pnl"
import type { VatReport } from "@/lib/reports/vat"

const vat = (over: Partial<VatReport> = {}): VatReport => ({
  from: "2026-06-01",
  to: "2026-07-31",
  output: 14406.18,
  input: 5100,
  net: 9306.18,
  months: [
    { month: "2026-06", label: "June 2026", output: 0, input: 3000, net: -3000 },
    { month: "2026-07", label: "July 2026", output: 14406.18, input: 2100, net: 12306.18 },
  ],
  counts: { sales: 61, credits: 0, purchases: 3 },
  truncated: false,
  ...over,
})

const pnl = (over: Partial<PnlReport> = {}): PnlReport => ({
  from: "2026-06-01",
  to: "2026-07-31",
  revenue: 96041.37,
  cost: 53854,
  gross: 42187.37,
  grossPct: 43.93,
  expenses: 0,
  net: 42187.37,
  expenseRows: [],
  counts: { sales: 61, credits: 0, payouts: 0 },
  truncated: false,
  ...over,
})

describe("VatReturn renders", () => {
  it("the real figures, month names and all", () => {
    const html = renderToStaticMarkup(createElement(VatReturn, { report: vat() }))
    expect(html).toContain("Rs 14,406.18")
    expect(html).toContain("Rs 5,100.00")
    expect(html).toContain("July 2026")
    expect(html).toContain("Net VAT payable")
  })

  it("an empty period without reaching into an empty months array", () => {
    const html = renderToStaticMarkup(
      createElement(VatReturn, {
        report: vat({ months: [], output: 0, input: 0, net: 0 }),
      }),
    )
    expect(html).toContain("No VAT activity in this range")
  })

  it("months that exist but are all zero, as the empty chart", () => {
    const html = renderToStaticMarkup(
      createElement(VatReturn, {
        report: vat({
          output: 0,
          input: 0,
          net: 0,
          months: vat().months.map((m: VatReport["months"][number]) => ({
            ...m,
            output: 0,
            input: 0,
            net: 0,
          })),
        }),
      }),
    )
    expect(html).toContain("No VAT activity in this range")
  })

  it("a reclaimable position as a positive figure under its own label", () => {
    const html = renderToStaticMarkup(
      createElement(VatReturn, { report: vat({ output: 100, input: 5000, net: -4900 }) }),
    )
    expect(html).toContain("Net VAT reclaimable")
    expect(html).toContain("Rs 4,900.00")
  })

  it("the truncation warning", () => {
    const html = renderToStaticMarkup(
      createElement(VatReturn, { report: vat({ truncated: true }) }),
    )
    expect(html).toContain("must not be filed")
  })

  it("explains that historical VAT comes from document snapshots, not one current rate", () => {
    const html = renderToStaticMarkup(createElement(VatReturn, { report: vat() }))
    expect(html).toContain("frozen values")
    expect(html).not.toContain("subtraction at")
  })
})

describe("PnlStatement renders", () => {
  it("a profit with its margin", () => {
    const html = renderToStaticMarkup(createElement(PnlStatement, { report: pnl() }))
    expect(html).toContain("Rs 42,187.37")
    expect(html).toContain("43.9%")
    expect(html).toContain("Net profit")
  })

  it("a loss, with every pay-out listed", () => {
    const html = renderToStaticMarkup(
      createElement(PnlStatement, {
        report: pnl({
          expenses: 50000,
          net: -7812.63,
          counts: { sales: 61, credits: 0, payouts: 3 },
          expenseRows: [
            { reason: "Stock from the market", amount: 45000, count: 1 },
            { reason: "petty cash", amount: 5000, count: 2 },
          ],
        }),
      }),
    )
    expect(html).toContain("Net loss")
    expect(html).toContain("Stock from the market")
    expect(html).toContain("×2")
  })

  it("a period that sold nothing without printing a NaN margin", () => {
    const html = renderToStaticMarkup(
      createElement(PnlStatement, {
        report: pnl({
          revenue: 0,
          cost: 0,
          gross: 0,
          grossPct: 0,
          net: 0,
          counts: { sales: 0, credits: 0, payouts: 0 },
        }),
      }),
    )
    expect(html).not.toContain("NaN")
    expect(html).toContain("0 pay-outs")
  })
})
