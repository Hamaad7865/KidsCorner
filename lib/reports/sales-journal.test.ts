import { describe, expect, it } from "vitest"

import { creditLine, journalTotals, saleLine, type JournalRow } from "./sales-journal"

/**
 * The four accounting rules the journal exists to get right.
 *
 * This is the document an accountant files a VAT return from. Each case below
 * is a way the figure gets overstated — and VAT is remitted on the overstated
 * figure, so the shop pays for the mistake.
 */

const sale = (over: Partial<Parameters<typeof saleLine>[0]> = {}) =>
  saleLine({
    saleNo: "S260731-1",
    saleDate: "2026-07-31T14:32:00Z",
    status: "completed",
    // A VAT-inclusive 2,300 at 15%: 300 of VAT inside it, 2,000 net.
    vatAmount: 300,
    total: 2_300,
    ...over,
  })

describe("VAT is derived by subtraction, never added on top", () => {
  it("takes the VAT out of the gross", () => {
    const row = sale()
    expect(row.gross).toBe(2_300)
    expect(row.vat).toBe(300)
    expect(row.net).toBe(2_000)
  })

  it("keeps net + VAT equal to gross", () => {
    // Multiplying a VAT-inclusive price up by the rate invents about 15% of
    // revenue that was never taken. This is the invariant that catches it.
    const row = sale()
    expect(row.net + row.vat).toBe(row.gross)
  })
})

describe("credit notes are negative", () => {
  const credit = creditLine({
    creditNo: "CN260731-1",
    createdAt: "2026-07-31T16:00:00Z",
    vatAmount: 150,
    total: 1_150,
    refundMethod: "cash",
    againstReference: "S260731-1",
  })

  it("reverses every figure", () => {
    expect(credit.gross).toBe(-1_150)
    expect(credit.vat).toBe(-150)
    expect(credit.net).toBe(-1_000)
  })

  it("still balances", () => {
    expect(credit.net + credit.vat).toBe(credit.gross)
  })

  it("names the invoice it reverses, which is what an auditor traces", () => {
    expect(credit.againstReference).toBe("S260731-1")
  })

  it("reduces the period's turnover rather than adding to it", () => {
    const totals = journalTotals([sale(), credit])
    expect(totals.gross).toBe(1_150)
    expect(totals.net).toBe(1_000)
    expect(totals.vat).toBe(150)
  })
})

describe("void documents appear at zero", () => {
  it("contributes nothing to any figure", () => {
    const row = sale({ saleNo: "S260731-2", status: "void", total: 999, vatAmount: 130.3 })
    expect(row.gross).toBe(0)
    expect(row.vat).toBe(0)
    expect(row.net).toBe(0)
  })

  it("is still listed, so the sequence has no hole", () => {
    // A missing number is what an auditor looks for first — it reads as a
    // deleted sale, which is worse than a void one.
    const rows = [sale(), sale({ saleNo: "S260731-2", status: "void" })]
    expect(rows.map((r) => r.reference)).toEqual(["S260731-1", "S260731-2"])
    expect(rows[1]?.status).toBe("void")
  })

  it("does not disturb the totals", () => {
    const totals = journalTotals([sale(), sale({ saleNo: "S260731-2", status: "void" })])
    expect(totals.gross).toBe(2_300)
  })
})

describe("journalTotals", () => {
  it("is zero for an empty period", () => {
    expect(journalTotals([])).toEqual({ net: 0, vat: 0, gross: 0 })
  })

  it("balances across a mixed period", () => {
    const rows: JournalRow[] = [
      sale(),
      sale({ saleNo: "S-2", total: 575, vatAmount: 75 }),
      sale({ saleNo: "S-3", status: "void" }),
      creditLine({
        creditNo: "CN-1",
        createdAt: "2026-07-31T17:00:00Z",
        vatAmount: 75,
        total: 575,
      }),
    ]
    const totals = journalTotals(rows)
    expect(totals.net + totals.vat).toBe(totals.gross)
    expect(totals.gross).toBe(2_300) // 2300 + 575 + 0 - 575
  })

  it("rounds to the cent rather than accumulating a float tail", () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      sale({ saleNo: `S-${i}`, total: 0.1, vatAmount: 0.01 }),
    )
    const totals = journalTotals(rows)
    expect(totals.gross).toBe(0.3)
    expect(totals.net).toBe(0.27)
  })
})
