import { describe, expect, it } from "vitest"

import { receiptTaxView } from "./tax-view"

describe("receiptTaxView", () => {
  it("renders a VAT-enabled sale as a VAT invoice with a contained breakdown", () => {
    const view = receiptTaxView({
      vatEnabled: true,
      vatRate: 0.15,
      vatNumber: "VAT20123456",
      vatAmount: 30,
      total: 230,
    })
    expect(view.isVatInvoice).toBe(true)
    expect(view.documentLabel).toBe("VAT INVOICE")
    expect(view.documentTitle).toBe("VAT Invoice")
    expect(view.vatNumber).toBe("VAT20123456")
    expect(view.rateLabel).toBe("15%")
    expect(view.vatAmount).toBe(30)
    // Prices are inclusive: net + vat = gross.
    expect(view.netAmount).toBe(200)
    expect(view.gross).toBe(230)
  })

  it("renders a disabled sale as a plain receipt with no VAT anywhere", () => {
    const view = receiptTaxView({
      vatEnabled: false,
      vatRate: 0,
      vatNumber: null,
      vatAmount: 0,
      total: 230,
    })
    expect(view.isVatInvoice).toBe(false)
    expect(view.documentLabel).toBe("RECEIPT")
    expect(view.documentTitle).toBe("Receipt")
    expect(view.vatNumber).toBeNull()
    expect(view.rateLabel).toBe("")
    expect(view.vatAmount).toBe(0)
    expect(view.netAmount).toBe(230)
  })

  it("keeps a disabled sale a plain receipt even if a stray VAT number is present", () => {
    // Defensive: the snapshot should never carry a number while disabled, but if
    // it did, a disabled sale must still never present as a VAT invoice.
    const view = receiptTaxView({
      vatEnabled: false,
      vatRate: 0,
      vatNumber: "VAT20123456",
      vatAmount: 0,
      total: 100,
    })
    expect(view.isVatInvoice).toBe(false)
    expect(view.vatNumber).toBeNull()
  })

  it("stays a VAT invoice on an enabled zero-total sale", () => {
    // Explicit status, not vatAmount > 0.
    const view = receiptTaxView({
      vatEnabled: true,
      vatRate: 0.15,
      vatNumber: "VAT20123456",
      vatAmount: 0,
      total: 0,
    })
    expect(view.isVatInvoice).toBe(true)
    expect(view.documentTitle).toBe("VAT Invoice")
    expect(view.netAmount).toBe(0)
  })

  it("normalises a blank frozen VAT number to null", () => {
    const view = receiptTaxView({
      vatEnabled: true,
      vatRate: 0.15,
      vatNumber: "   ",
      vatAmount: 15,
      total: 115,
    })
    expect(view.vatNumber).toBeNull()
  })

  it("formats a non-round rate cleanly", () => {
    expect(receiptTaxView({ vatEnabled: true, vatRate: 0.125, vatNumber: "V", vatAmount: 0, total: 0 }).rateLabel).toBe("12.5%")
    expect(receiptTaxView({ vatEnabled: true, vatRate: 0.2, vatNumber: "V", vatAmount: 0, total: 0 }).rateLabel).toBe("20%")
  })
})
