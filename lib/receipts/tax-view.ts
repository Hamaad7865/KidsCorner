import { round2 } from "@/lib/format"

/**
 * The frozen VAT fields any receipt-shaped view reads. Structural so both the
 * browser receipt's raw sales row and the SaleDetail model satisfy it.
 */
export type FrozenVatSale = {
  /** The status frozen on the sale — never today's shop setting. */
  vatEnabled: boolean
  /** The effective rate at sale time, as a fraction (0.15). */
  vatRate: number
  /** The registration number frozen on the sale, if any. */
  vatNumber: string | null
  /** The contained VAT amount frozen on the sale. */
  vatAmount: number
  /** The VAT-inclusive total. */
  total: number
}

/**
 * How a receipt should present the sale's VAT — derived from the sale's frozen
 * snapshot, never the current setting.
 *
 * A VAT-enabled sale is a VAT invoice: it carries the frozen registration
 * number and a contained-VAT breakdown (net + VAT = gross), because Kids Corner
 * prices include VAT. A disabled sale is a plain receipt with none of that.
 *
 * `isVatInvoice` mirrors the frozen `vatEnabled` flag exactly and is never
 * inferred from `vatAmount > 0`, so an enabled zero-total sale stays a VAT
 * invoice and a disabled sale can never sprout a VAT line.
 */
export type ReceiptTaxView = {
  isVatInvoice: boolean
  /** Upper-case thermal-style label: "VAT INVOICE" or "RECEIPT". */
  documentLabel: string
  /** Title-case label for the browser page: "VAT Invoice" or "Receipt". */
  documentTitle: string
  /** The frozen registration number to print — only on a VAT invoice. */
  vatNumber: string | null
  /** e.g. "15%". Empty string on a plain receipt. */
  rateLabel: string
  /** Contained VAT amount; zero on a plain receipt. */
  vatAmount: number
  /** Net of contained VAT (total − vat); equals total on a plain receipt. */
  netAmount: number
  /** The VAT-inclusive total. */
  gross: number
}

function percentLabel(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return ""
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`
}

export function receiptTaxView(sale: FrozenVatSale): ReceiptTaxView {
  const gross = round2(sale.total)

  if (!sale.vatEnabled) {
    return {
      isVatInvoice: false,
      documentLabel: "RECEIPT",
      documentTitle: "Receipt",
      vatNumber: null,
      rateLabel: "",
      vatAmount: 0,
      netAmount: gross,
      gross,
    }
  }

  const vatAmount = round2(sale.vatAmount)
  const vatNumber =
    typeof sale.vatNumber === "string" && sale.vatNumber.trim()
      ? sale.vatNumber.trim()
      : null

  return {
    isVatInvoice: true,
    documentLabel: "VAT INVOICE",
    documentTitle: "VAT Invoice",
    vatNumber,
    rateLabel: percentLabel(sale.vatRate),
    vatAmount,
    netAmount: round2(gross - vatAmount),
    gross,
  }
}
