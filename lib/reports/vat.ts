import { endOfShopDay, round2, shopDayOf, startOfShopDay } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * The VAT return position — ported from Carfectionist's "VAT report".
 *
 * The MRA return is a MONTHLY figure, so the report is a month ladder rather
 * than one total for the range: output VAT charged on sales, input VAT paid on
 * purchases, and the net the shop owes (or reclaims) for each month.
 *
 * Two translations from Carfectionist, both because of the schema:
 *
 *   OUTPUT VAT is read, not derived. `sales.vat_amount` was frozen when the
 *   sale committed, at the rate in force that day. Re-deriving it from today's
 *   rate would silently restate every sale made before a rate change.
 *
 *   INPUT VAT is read from `purchases.vat_amount`, frozen when the purchase was
 *   received. A later registration or rate change must not restate it.
 */

/** Plenty for a year; the report says so if it is ever exceeded. */
const ROW_CAP = 5_000
const OVER_CAP = ROW_CAP + 1

/**
 * The longest month ladder one view will build. A range wide enough to exceed
 * five years is a mistyped date, not a VAT return.
 */
const MAX_MONTHS = 60

export type VatMonth = {
  /** "2026-07" — the shop's calendar month, not UTC's. */
  month: string
  /** "July 2026" */
  label: string
  /** VAT charged on sales, net of credit notes. */
  output: number
  /** VAT frozen when received purchases entered the ledger. */
  input: number
  /** Positive: owed to the MRA. Negative: reclaimable. */
  net: number
}

export type VatReport = {
  from: string
  to: string
  output: number
  input: number
  net: number
  months: VatMonth[]
  counts: { sales: number; credits: number; purchases: number }
  truncated: boolean
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** "2026-07" → "July 2026". Anchored at midday so no offset can slip a month. */
export function monthLabel(month: string): string {
  const ms = Date.parse(`${month}-01T12:00:00Z`)
  return Number.isFinite(ms) ? MONTH_LABEL.format(ms) : month
}

/**
 * Every month the range touches, in order, including the empty ones.
 *
 * Gap-filled across the REQUESTED range rather than only between the months
 * that happen to hold documents. A month with no sales is a real fact — the
 * return still has to be filed — and a ladder that skips it reads as though the
 * shop were never asked.
 */
export function monthsBetween(from: string, to: string): string[] {
  const first = from.slice(0, 7)
  const last = to.slice(0, 7)
  if (last < first) return []

  const months: string[] = []
  let [year, month] = first.split("-").map(Number)
  for (let key = first; key <= last && months.length < MAX_MONTHS; ) {
    months.push(key)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
    key = `${year}-${String(month).padStart(2, "0")}`
  }
  return months
}

type Bucket = { output: number; input: number }

/** VAT belongs to a return only when that document's frozen policy was enabled. */
export function frozenVatAmount(document: {
  vatEnabled: boolean
  vatAmount: number
}): number {
  return document.vatEnabled ? round2(document.vatAmount) : 0
}

/**
 * Bucket one document into its shop month.
 *
 * Exported for the tests. The month comes from `shopDayOf`, never from slicing
 * the ISO string: Postgres hands timestamps back at +00:00, so a sale rung up
 * at 01:14 on the 1st of a month is 21:14 on the last day of the previous one
 * in UTC — and slicing files it, and its VAT, in the wrong return.
 */
export function bucketOf(
  months: Map<string, Bucket>,
  key: string,
  output: number,
  input: number,
): void {
  if (!months.has(key)) return
  const bucket = months.get(key)!
  bucket.output = round2(bucket.output + output)
  bucket.input = round2(bucket.input + input)
}

export async function getVatReport(from: string, to: string): Promise<VatReport> {
  const supabase = await createClient()

  const after = startOfShopDay(from)
  const before = endOfShopDay(to)

  const [salesResult, creditResult, purchaseResult] = await Promise.all([
    supabase
      .from("sales")
      .select("id, sale_date, vat_enabled, vat_rate, vat_amount, status")
      // A refunded sale still charged VAT on the day; the credit note that
      // reversed it takes that VAT off in its own month, which is how the MRA
      // expects a return to be corrected. Voids never charged anything.
      .in("status", ["completed", "refunded"])
      .gte("sale_date", after)
      .lte("sale_date", before)
      .order("sale_date", { ascending: true })
      .limit(OVER_CAP),
    supabase
      .from("credit_notes")
      .select("id, created_at, vat_enabled, vat_rate, vat_amount")
      .gte("created_at", after)
      .lte("created_at", before)
      .order("created_at", { ascending: true })
      .limit(OVER_CAP),
    // `purchase_date` is the supplier's invoice date and a plain date, which is
    // both the right basis for a return and free of any timezone question.
    // Draft orders have not been invoiced and cancelled ones never will be.
    supabase
      .from("purchases")
      .select("id, purchase_date, total_amount, status, vat_enabled, vat_rate, vat_amount")
      .eq("status", "received")
      .gte("purchase_date", from)
      .lte("purchase_date", to)
      .order("purchase_date", { ascending: true })
      .limit(OVER_CAP),
  ])

  if (salesResult.error) throw salesResult.error
  if (creditResult.error) throw creditResult.error
  if (purchaseResult.error) throw purchaseResult.error

  const saleRows = salesResult.data ?? []
  const creditRows = creditResult.data ?? []
  const purchaseRows = purchaseResult.data ?? []
  const truncated =
    saleRows.length > ROW_CAP ||
    creditRows.length > ROW_CAP ||
    purchaseRows.length > ROW_CAP

  const sales = saleRows.slice(0, ROW_CAP)
  const credits = creditRows.slice(0, ROW_CAP)
  const purchases = purchaseRows.slice(0, ROW_CAP)

  const months = new Map<string, Bucket>(
    monthsBetween(from, to).map((m) => [m, { output: 0, input: 0 }]),
  )

  let output = 0
  let input = 0

  for (const sale of sales) {
    const vat = frozenVatAmount({
      vatEnabled: sale.vat_enabled === true,
      vatAmount: Number(sale.vat_amount),
    })
    output = round2(output + vat)
    bucketOf(months, shopDayOf(sale.sale_date).slice(0, 7), vat, 0)
  }

  for (const note of credits) {
    const vat = frozenVatAmount({
      vatEnabled: note.vat_enabled === true,
      vatAmount: Number(note.vat_amount),
    })
    output = round2(output - vat)
    bucketOf(months, shopDayOf(note.created_at).slice(0, 7), -vat, 0)
  }

  for (const purchase of purchases) {
    const vat = frozenVatAmount({
      vatEnabled: purchase.vat_enabled === true,
      vatAmount: Number(purchase.vat_amount),
    })
    input = round2(input + vat)
    bucketOf(months, purchase.purchase_date.slice(0, 7), 0, vat)
  }

  return {
    from,
    to,
    output,
    input,
    net: round2(output - input),
    months: [...months.entries()].map(([month, bucket]) => ({
      month,
      label: monthLabel(month),
      output: bucket.output,
      input: bucket.input,
      net: round2(bucket.output - bucket.input),
    })),
    counts: {
      sales: sales.length,
      credits: credits.length,
      purchases: purchases.length,
    },
    truncated,
  }
}
