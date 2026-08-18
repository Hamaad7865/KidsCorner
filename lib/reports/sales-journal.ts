import { endOfShopDay, round2, startOfShopDay } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * The sales journal — every document the shop issued, in order.
 *
 * This is the one report an accountant actually asks for, and it is a
 * different thing from the management reports beside it. Those answer "how are
 * we doing"; this one is the record: what was invoiced, what was credited back,
 * how much VAT is in it, and in a sequence with no holes.
 *
 * Four rules it exists to get right, each of which is a way people get this
 * wrong:
 *
 * 1. CREDIT NOTES ARE NEGATIVE. A return reduces turnover. Listing refunds as
 *    positive rows, or leaving them out, overstates both takings and VAT due —
 *    and VAT is remitted on the net figure.
 *
 * 2. VAT IS DERIVED BY SUBTRACTION. Kids Corner prices include VAT, so the net
 *    is `gross - vat`, never `gross * rate`. Multiplying up from a
 *    VAT-inclusive price invents about 15% of revenue that was never taken.
 *
 * 3. VOID DOCUMENTS STILL APPEAR, at zero. A gap in an invoice sequence is
 *    what an auditor looks for first; a voided number that is simply absent
 *    reads as a deleted sale. It is listed, marked void, and contributes
 *    nothing.
 *
 * 4. THE SHOP'S CALENDAR DAY DECIDES THE PERIOD. A sale at 9pm belongs to that
 *    day in Mauritius, not to whatever UTC thought.
 */

export type JournalRow = {
  /** "sale" or "credit" — what kind of document this is. */
  kind: "sale" | "credit"
  /** The document number a customer or auditor would quote. */
  reference: string
  /** ISO timestamp, for ordering and for the date column. */
  at: string
  customerName: string | null
  cashierName: string | null
  /** Payment methods, or the refund method on a credit note. */
  methods: string[]
  /** Whether VAT registration was enabled when this document was created. */
  vatEnabled: boolean
  /** The effective rate frozen on the document (0 only when disabled). */
  vatRate: number
  vatStatus: "VAT registered" | "Not VAT registered"
  /** Excluding VAT. Negative on a credit note. */
  net: number
  /** The VAT within the gross. Negative on a credit note. */
  vat: number
  /** What actually changed hands. Negative on a credit note. */
  gross: number
  /** "completed", "refunded", "void", or "credit". */
  status: string
  /** The sale a credit note was raised against. */
  againstReference?: string
}

export type SalesJournal = {
  from: string
  to: string
  rows: JournalRow[]
  totals: { net: number; vat: number; gross: number }
  /** Sales and credit notes counted separately — an auditor asks for both. */
  counts: { sales: number; credits: number; voids: number }
  /** True when the period held more documents than were read. */
  truncated: boolean
}

/** Plenty for a small shop's month; enough to notice if it is ever hit. */
const JOURNAL_LIMIT = 5_000

/**
 * A sale, as a journal line.
 *
 * Pure and exported so the two rules that matter can be tested without a
 * database: VAT comes OUT of the gross rather than being added to it, and a
 * void document is listed at zero rather than omitted.
 */
export function saleLine(sale: {
  saleNo: string
  saleDate: string
  status: string
  vatAmount: number
  vatEnabled: boolean
  vatRate: number
  total: number
  customerName?: string | null
  cashierName?: string | null
  methods?: string[]
}): JournalRow {
  const isVoid = sale.status === "void"
  const gross = isVoid ? 0 : sale.total
  const vat = isVoid ? 0 : sale.vatAmount

  return {
    kind: "sale",
    reference: sale.saleNo,
    at: sale.saleDate,
    customerName: sale.customerName ?? null,
    cashierName: sale.cashierName ?? null,
    methods: sale.methods ?? [],
    vatEnabled: sale.vatEnabled,
    vatRate: sale.vatRate,
    vatStatus: sale.vatEnabled ? "VAT registered" : "Not VAT registered",
    // Prices include VAT: the net is what is left after taking it out.
    net: round2(gross - vat),
    vat: round2(vat),
    gross: round2(gross),
    status: sale.status,
  }
}

/**
 * A credit note, as a journal line — negative on every figure.
 *
 * A return takes turnover, and the VAT inside it, back out. Listing refunds
 * positive (or not at all) overstates both takings and the VAT owed.
 */
export function creditLine(note: {
  creditNo: string
  createdAt: string
  vatAmount: number
  vatEnabled: boolean
  vatRate: number
  total: number
  refundMethod?: string | null
  customerName?: string | null
  cashierName?: string | null
  againstReference?: string
}): JournalRow {
  return {
    kind: "credit",
    reference: note.creditNo,
    at: note.createdAt,
    customerName: note.customerName ?? null,
    cashierName: note.cashierName ?? null,
    methods: note.refundMethod ? [note.refundMethod] : [],
    vatEnabled: note.vatEnabled,
    vatRate: note.vatRate,
    vatStatus: note.vatEnabled ? "VAT registered" : "Not VAT registered",
    net: round2(-(note.total - note.vatAmount)),
    vat: round2(-note.vatAmount),
    gross: round2(-note.total),
    status: "credit",
    againstReference: note.againstReference,
  }
}

/** Period totals. Kept here so the screen and the CSV cannot disagree. */
export function journalTotals(rows: JournalRow[]): {
  net: number
  vat: number
  gross: number
} {
  return rows.reduce(
    (sum, r) => ({
      net: round2(sum.net + r.net),
      vat: round2(sum.vat + r.vat),
      gross: round2(sum.gross + r.gross),
    }),
    { net: 0, vat: 0, gross: 0 },
  )
}

export async function getSalesJournal(
  from: string,
  to: string,
): Promise<SalesJournal> {
  const supabase = await createClient()
  const after = startOfShopDay(from)
  const before = endOfShopDay(to)

  const [{ data: sales, error: salesError }, { data: credits, error: creditError }] =
    await Promise.all([
      supabase
        .from("sales")
        .select(
          `id, sale_no, sale_date, status, vat_enabled, vat_rate, vat_amount, total,
           profiles ( full_name ),
           customers ( full_name ),
           sale_payments ( method )`,
        )
        .gte("sale_date", after)
        .lte("sale_date", before)
        .order("sale_date", { ascending: true })
        .limit(JOURNAL_LIMIT + 1),
      supabase
        .from("credit_notes")
        .select(
          `id, credit_no, created_at, vat_enabled, vat_rate, vat_amount, total, refund_method, reason,
           profiles ( full_name ),
           sales ( sale_no, customers ( full_name ) )`,
        )
        .gte("created_at", after)
        .lte("created_at", before)
        .order("created_at", { ascending: true })
        .limit(JOURNAL_LIMIT + 1),
    ])

  if (salesError) throw salesError
  if (creditError) throw creditError

  const saleRows = sales ?? []
  const creditRows = credits ?? []

  const rows: JournalRow[] = []

  for (const sale of saleRows.slice(0, JOURNAL_LIMIT)) {
    rows.push(
      saleLine({
        saleNo: sale.sale_no,
        saleDate: sale.sale_date,
        status: sale.status,
        vatAmount: Number(sale.vat_amount),
        vatEnabled: sale.vat_enabled,
        vatRate: Number(sale.vat_rate),
        total: Number(sale.total),
        customerName: sale.customers?.full_name ?? null,
        cashierName: sale.profiles?.full_name ?? null,
        methods: [...new Set((sale.sale_payments ?? []).map((p) => p.method))],
      }),
    )
  }

  for (const note of creditRows.slice(0, JOURNAL_LIMIT)) {
    rows.push(
      creditLine({
        creditNo: note.credit_no,
        createdAt: note.created_at,
        vatAmount: Number(note.vat_amount),
        vatEnabled: note.vat_enabled,
        vatRate: Number(note.vat_rate),
        total: Number(note.total),
        refundMethod: note.refund_method,
        customerName: note.sales?.customers?.full_name ?? null,
        cashierName: note.profiles?.full_name ?? null,
        againstReference: note.sales?.sale_no,
      }),
    )
  }

  // One sequence, oldest first. Documents issued in the same second are
  // ordered by reference so the journal is stable between runs — an accountant
  // comparing two exports of the same period should see the same file.
  rows.sort((a, b) => a.at.localeCompare(b.at) || a.reference.localeCompare(b.reference))

  const totals = journalTotals(rows)

  return {
    from,
    to,
    rows,
    totals,
    counts: {
      sales: rows.filter((r) => r.kind === "sale" && r.status !== "void").length,
      credits: rows.filter((r) => r.kind === "credit").length,
      voids: rows.filter((r) => r.status === "void").length,
    },
    truncated:
      saleRows.length > JOURNAL_LIMIT || creditRows.length > JOURNAL_LIMIT,
  }
}
