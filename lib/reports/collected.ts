import { isCollectedMethod } from "@/lib/db-enums"
import { endOfShopDay, round2, startOfShopDay } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * Collected by method — ported from Carfectionist's Accounting & Reports.
 *
 * The report answers three different questions and keeps them apart, which is
 * the whole reason it exists there:
 *
 *   COLLECTED — money that actually arrived, by rail. Refunds come OFF the
 *   method that paid them back, mirroring how Carfectionist nets its reversal
 *   mirrors in: "Cash Rs 19,792" must mean what the drawer saw, or the figure
 *   is decoration.
 *
 *   INVOICED — the period's revenue: sales issued minus credit notes, voids at
 *   zero. The basis for VAT and P&L, and it matches the sales journal's gross
 *   for the same range, because two reports disagreeing about revenue is how
 *   owners stop trusting both.
 *
 *   NOT YET COLLECTED — invoiced but unpaid. This used to be zero by
 *   construction, and the card said so: every ticket was paid at the till, so
 *   any other figure meant drift between the sales ledger and the payments
 *   ledger. Credit customers changed that. A sale billed to an account is
 *   invoiced in full and collects nothing, so this figure is now the period's
 *   real account lending — and `onAccount` below is the same money counted
 *   forwards, from the credit tenders themselves, so the two can be compared.
 *
 * The one rule that keeps all of this honest: a `credit` payment row is NOT
 * money. It is filtered out of COLLECTED and out of `byMethod` through
 * `isCollectedMethod`, because "Cash Rs 19,792" must mean what the drawer saw.
 */

export type CollectedRow = {
  key: string
  /** ISO instant. */
  at: string
  /** Sale number, or the credit note number on a refund. */
  reference: string
  saleId: number
  customerName: string | null
  method: string
  /** Negative on a refund. */
  amount: number
  kind: "payment" | "refund"
}

export type CollectedReport = {
  from: string
  to: string
  /** The method the view is narrowed to, if any. */
  method?: string
  collected: number
  invoiced: number
  outstanding: number
  /**
   * Sales value billed to customer accounts in this period.
   *
   * Counted from the `credit` tenders themselves rather than derived, so it
   * stands on its own next to `outstanding` — which reaches the same money by
   * subtraction, and would also absorb any genuine ledger drift.
   */
  onAccount: number
  byMethod: { method: string; amount: number }[]
  rows: CollectedRow[]
  counts: { payments: number; refunds: number }
  truncated: boolean
}

/** Plenty for a month; the report says so if it is ever exceeded. */
const ROW_CAP = 5_000
/** The on-screen list. The totals are summed over everything, never this slice. */
const DISPLAY_CAP = 300

type PaymentFact = { method: string; amount: number }
type RefundFact = { method: string; amount: number }

/**
 * Per-method takings, refunds netted off the rail that repaid them.
 *
 * Pure and exported for the tests: the rule worth locking down is that an
 * exchange — `refund_method = 'exchange'` — nets nothing anywhere, because no
 * money moved.
 */
export function collectByMethod(
  payments: PaymentFact[],
  refunds: RefundFact[],
): { method: string; amount: number }[] {
  const map = new Map<string, number>()
  for (const p of payments) {
    map.set(p.method, round2((map.get(p.method) ?? 0) + p.amount))
  }
  for (const r of refunds) {
    if (r.method === "exchange") continue
    map.set(r.method, round2((map.get(r.method) ?? 0) - r.amount))
  }
  return [...map.entries()]
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount)
}

export async function getCollectedReport(
  from: string,
  to: string,
  method?: string,
): Promise<CollectedReport> {
  const supabase = await createClient()
  const after = startOfShopDay(from)
  const before = endOfShopDay(to)

  const [salesResult, creditResult] = await Promise.all([
    // The period is the SALE's date. In this shop a payment happens at the
    // moment of sale, so filtering payments by their own timestamps would give
    // the same answer slower — and the journal already keys on sale_date, so
    // this report reconciles against it by construction.
    supabase
      .from("sales")
      .select(
        `id, sale_no, sale_date, status, total,
         customers ( full_name ),
         sale_payments ( id, method, amount, created_at )`,
      )
      .gte("sale_date", after)
      .lte("sale_date", before)
      .order("sale_date", { ascending: false })
      .limit(ROW_CAP + 1),
    supabase
      .from("credit_notes")
      .select(
        `id, credit_no, created_at, total, refund_method,
         sales ( id, sale_no, customers ( full_name ) )`,
      )
      .gte("created_at", after)
      .lte("created_at", before)
      .order("created_at", { ascending: false })
      .limit(ROW_CAP + 1),
  ])

  if (salesResult.error) throw salesResult.error
  if (creditResult.error) throw creditResult.error

  const saleRows = (salesResult.data ?? []).slice(0, ROW_CAP)
  const creditRows = (creditResult.data ?? []).slice(0, ROW_CAP)
  const truncated =
    (salesResult.data?.length ?? 0) > ROW_CAP ||
    (creditResult.data?.length ?? 0) > ROW_CAP

  const payments: (PaymentFact & CollectedRow)[] = []
  let invoicedSales = 0
  let paidOnSales = 0
  let onAccount = 0

  for (const sale of saleRows) {
    // A voided sale took no money and invoices nothing. Its payment rows stay
    // in the database as evidence, but a money report that counted them would
    // overstate the period by the value of a sale that was undone.
    if (sale.status === "void") continue

    invoicedSales = round2(invoicedSales + Number(sale.total))

    for (const payment of sale.sale_payments ?? []) {
      const amount = round2(Number(payment.amount))

      /**
       * A credit tender is a debt, not a receipt.
       *
       * It is totalled into `onAccount` and then dropped, so it reaches neither
       * `paidOnSales` — which is what makes `outstanding` the period's real
       * lending instead of a permanent zero — nor the row list that feeds
       * `byMethod` and COLLECTED. Left in, a Rs 5,000 sale on account added
       * Rs 5,000 to "money received" and the reports page told the owner the
       * shop had taken thousands it was still owed.
       */
      if (!isCollectedMethod(payment.method)) {
        onAccount = round2(onAccount + amount)
        continue
      }

      paidOnSales = round2(paidOnSales + amount)
      payments.push({
        key: `p${payment.id}`,
        at: payment.created_at ?? sale.sale_date,
        reference: sale.sale_no,
        saleId: sale.id,
        customerName: sale.customers?.full_name ?? null,
        method: payment.method,
        amount,
        kind: "payment",
      })
    }
  }

  const refunds: (RefundFact & CollectedRow)[] = creditRows.map((note) => ({
    key: `c${note.id}`,
    at: note.created_at,
    reference: note.credit_no,
    saleId: note.sales?.id ?? 0,
    customerName: note.sales?.customers?.full_name ?? null,
    method: note.refund_method,
    amount: round2(Number(note.total)),
    kind: "refund" as const,
  }))

  const creditTotal = round2(refunds.reduce((sum, r) => sum + r.amount, 0))

  // The method chips narrow what is counted as collected and what is listed —
  // the document figures stay whole-period, as in Carfectionist, because
  // "revenue invoiced" filtered to cash is not a number anyone reconciles.
  const wanted = <T extends { method: string }>(list: T[]) =>
    method ? list.filter((row) => row.method === method) : list

  const byMethod = collectByMethod(wanted(payments), wanted(refunds))
  const collected = round2(byMethod.reduce((sum, m) => sum + m.amount, 0))

  const rows: CollectedRow[] = [
    ...wanted(payments),
    // An exchange moved no money, so the money list has no row for it — the
    // journal and the till page carry exchanges.
    ...wanted(refunds)
      .filter((r) => r.method !== "exchange")
      .map((r) => ({ ...r, amount: round2(-r.amount) })),
  ]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key))
    .slice(0, DISPLAY_CAP)

  return {
    from,
    to,
    method,
    collected,
    invoiced: round2(invoicedSales - creditTotal),
    // Sales issued minus money received against them. With credit customers
    // this is the period's account lending; it was zero by construction before
    // they existed, and anything above `onAccount` is ledger drift worth a look.
    outstanding: round2(invoicedSales - paidOnSales),
    onAccount,
    byMethod,
    rows,
    counts: {
      payments: wanted(payments).length,
      refunds: wanted(refunds).filter((r) => r.method !== "exchange").length,
    },
    truncated,
  }
}
