import { describe, expect, it } from "vitest"

import {
  buildJournalSections,
  creditLine,
  depositLine,
  journalTotals,
  paymentLegLine,
  saleLine,
  settlementLine,
  splitCents,
  type JournalLeg,
  type JournalRow,
} from "./sales-journal"

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
    vatEnabled: true,
    vatRate: 0.15,
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

  it("exposes the frozen registration status and effective rate", () => {
    expect(sale()).toMatchObject({
      vatEnabled: true,
      vatRate: 0.15,
      vatStatus: "VAT registered",
    })
  })

  it("labels a disabled sale without inventing a zero-rate VAT band", () => {
    expect(sale({ vatEnabled: false, vatRate: 0, vatAmount: 0 })).toMatchObject({
      net: 2_300,
      vat: 0,
      gross: 2_300,
      vatEnabled: false,
      vatRate: 0,
      vatStatus: "Not VAT registered",
    })
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
    vatEnabled: true,
    vatRate: 0.15,
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
        vatEnabled: true,
        vatRate: 0.15,
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

describe("cash basis: a tender leg carries its share of the frozen VAT", () => {
  it("splits whole cents so the legs foot exactly", () => {
    // Rs 300 of VAT across legs of 2000 and 300: 260.87 + 39.13.
    expect(splitCents(30_000, [2_000, 300])).toEqual([26_087, 3_913])
    expect(splitCents(30_000, [2_000, 300]).reduce((a, b) => a + b, 0)).toBe(30_000)
  })

  it("keeps signs on money-out legs", () => {
    expect(splitCents(3_913, [300, -40]).reduce((a, b) => a + b, 0)).toBe(3_913)
  })

  it("states the leg's date, not the sale's", () => {
    const row = paymentLegLine({
      paymentId: 7,
      saleNo: "S260731-1",
      at: "2026-08-02T10:00:00+04:00",
      method: "cash",
      amount: 300,
      vatShare: 39.13,
      vatEnabled: true,
      vatRate: 0.15,
    })
    expect(row.key).toBe("p7")
    expect(row.at).toBe("2026-08-02T10:00:00+04:00")
    expect(row.gross).toBe(300)
    expect(row.vat).toBe(39.13)
    expect(row.net).toBe(260.87)
  })
})

describe("cash basis: deposits and settlements count when the money arrives", () => {
  it("books a top-up with no VAT — nothing has left the shelf", () => {
    const row = depositLine({
      paymentId: 3,
      orderNo: "D-0001",
      at: "2026-08-25T10:00:00+04:00",
      method: "cash",
      amount: 200,
    })
    expect(row.key).toBe("d3")
    expect(row.kind).toBe("deposit")
    expect(row.gross).toBe(200)
    expect(row.vat).toBe(0)
    expect(row.net).toBe(200)
  })

  it("books a settlement as money in, although it is stored negative", () => {
    const row = settlementLine({
      entryId: 9,
      at: "2026-08-26T10:00:00+04:00",
      amount: 500,
      method: "cash",
    })
    expect(row.gross).toBe(500)
    expect(row.vat).toBe(0)
  })

  it("a mixed cash period still balances", () => {
    const totals = journalTotals([
      paymentLegLine({
        paymentId: 1,
        saleNo: "S-1",
        at: "2026-08-18T10:00:00+04:00",
        method: "cash",
        amount: 1_150,
        vatShare: 150,
        vatEnabled: true,
        vatRate: 0.15,
      }),
      depositLine({
        paymentId: 2,
        orderNo: "D-1",
        at: "2026-08-18T11:00:00+04:00",
        method: "cash",
        amount: 200,
      }),
      creditLine({
        creditNo: "CN-1",
        createdAt: "2026-08-18T12:00:00+04:00",
        vatAmount: 75,
        vatEnabled: true,
        vatRate: 0.15,
        total: 575,
      }),
    ])
    expect(totals.gross).toBe(775) // 1150 + 200 - 575
    expect(totals.net + totals.vat).toBe(totals.gross)
  })
})

describe("buildJournalSections", () => {
  const leg = (over: Partial<JournalLeg> = {}): JournalLeg => ({
    doc: "sale",
    saleNo: "S-1",
    saleId: 1,
    saleDate: "2026-09-12T10:00:00+04:00",
    at: "2026-09-12T10:00:00+04:00",
    method: "cash",
    gross: 1_150,
    net: 1_000,
    vat: 150,
    vatEnabled: true,
    vatRate: 0.15,
    discountShare: 0,
    customerName: "Marie",
    cashierName: "Priya",
    categories: [{ label: "Tops", weight: 1_150, qty: 2 }],
    ...over,
  })

  it("counts bills, takings, clients and the average ticket", () => {
    const s = buildJournalSections(
      [leg(), leg({ saleNo: "S-2", gross: 575, net: 500, vat: 75, customerName: null })],
      "2026-09-12T00:00:00+04:00",
    )
    expect(s.billsSettled).toBe(2)
    expect(s.totalReceived).toBe(1_725)
    expect(s.clients).toBe(1)
    expect(s.avgTicket).toBe(862.5)
  })

  it("puts legs on older bills under settled earlier", () => {
    const s = buildJournalSections(
      [leg(), leg({ saleNo: "S-0", saleDate: "2026-08-20T10:00:00+04:00", gross: 500, net: 500, vat: 0 })],
      "2026-09-12T00:00:00+04:00",
    )
    expect(s.settledEarlier).toEqual({ bills: 1, amount: 500 })
    expect(s.totalReceived).toBe(1_650)
  })

  it("breaks tax bands with discounts, and categories foot to the total", () => {
    const s = buildJournalSections(
      [
        leg({ discountShare: 100 }),
        leg({
          doc: "deposit",
          saleNo: "D-1",
          gross: 200,
          net: 200,
          vat: 0,
          vatEnabled: false,
          vatRate: 0,
          discountShare: 0,
          categories: [],
        }),
      ],
      "2026-09-12T00:00:00+04:00",
    )
    expect(s.taxes).toEqual([
      { label: "15%", rate: 0.15, tax: 150, discount: 100, excl: 1_000, incl: 1_150 },
      { label: "No VAT event", rate: 0, tax: 0, discount: 0, excl: 200, incl: 200 },
    ])
    // Taxes now covers everything received, not just the taxable slice.
    const taxIncl = s.taxes.reduce((sum, t) => sum + t.incl, 0)
    expect(taxIncl).toBe(s.totalReceived)
    const catTotal = s.categories.reduce((sum, c) => sum + c.incl, 0)
    expect(catTotal).toBe(s.totalReceived)
  })

  it("groups methods and users with bill counts", () => {
    const s = buildJournalSections(
      [leg(), leg({ saleNo: "S-2", method: "card", gross: 575, net: 500, vat: 75 })],
      "2026-09-12T00:00:00+04:00",
    )
    expect(s.payments).toEqual([
      { method: "cash", bills: 1, amount: 1_150 },
      { method: "card", bills: 1, amount: 575 },
    ])
    expect(s.users).toEqual([{ name: "Priya", bills: 2, excl: 1_500, incl: 1_725 }])
  })

  it("nets a cash refund out of takings without touching the average ticket", () => {
    const s = buildJournalSections(
      [
        leg(),
        leg({
          doc: "credit",
          saleNo: "CN-1",
          saleId: null,
          method: "cash",
          gross: -500,
          net: -500,
          vat: 0,
          vatEnabled: false,
          vatRate: 0,
          categories: [],
        }),
      ],
      "2026-09-12T00:00:00+04:00",
    )
    expect(s.totalReceived).toBe(650)
    const cash = s.byMethod.find((m) => m.method === "cash")!
    expect(cash.incl).toBe(650)
    expect(cash.bills).toBe(1) // the refund is not a bill
    // The refund is money out, so the day's average basket is unmoved.
    expect(s.avgTicket).toBe(1_150)
  })

  it("drills each method down to its documents, which foot to the row", () => {
    const s = buildJournalSections(
      [
        leg(),
        leg({ saleNo: "S-2", saleId: 2, gross: 575, net: 500, vat: 75, customerName: "Anil" }),
        leg({
          doc: "deposit",
          saleNo: "D-9",
          saleId: null,
          method: "card",
          gross: 200,
          net: 200,
          vat: 0,
          vatEnabled: false,
          vatRate: 0,
          categories: [],
        }),
      ],
      "2026-09-12T00:00:00+04:00",
    )
    const cash = s.byMethod.find((m) => m.method === "cash")!
    expect(cash.bills).toBe(2)
    expect(cash.breakdown).toEqual([
      { ref: "S-1", saleId: 1, customer: "Marie", excl: 1_000, incl: 1_150 },
      { ref: "S-2", saleId: 2, customer: "Anil", excl: 500, incl: 575 },
    ])
    // A deposit is money on a method but not a bill settled.
    const card = s.byMethod.find((m) => m.method === "card")!
    expect(card.bills).toBe(0)
    expect(card.breakdown).toEqual([
      { ref: "D-9", saleId: null, customer: "Marie", excl: 200, incl: 200 },
    ])
    for (const m of s.byMethod) {
      const incl = m.breakdown.reduce((sum, b) => sum + b.incl, 0)
      expect(incl).toBe(m.incl)
    }
  })

  it("settles a same-day bill stored in UTC in this period, not earlier", () => {
    // 20:01 on the 13th in UTC is 00:01 on the 14th in the shop (+04) — after
    // the period opens, though the UTC date string sorts before it.
    const s = buildJournalSections(
      [leg({ saleDate: "2026-09-13T20:01:00+00:00" })],
      "2026-09-14T00:00:00.000+04:00",
    )
    expect(s.settledEarlier).toEqual({ bills: 0, amount: 0 })
  })
})
