import { endOfShopDay, round2, startOfShopDay } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * Collected by method — ported from Carfectionist's Accounting & Reports.
 *
 * The report answers three different questions and keeps them apart, which is
 * the whole reason it exists there:
 *
 *   COLLECTED — money that actually arrived in the period, by rail, on the
 *   day it arrived. A deposit taken on the 25th counts on the 25th; the
 *   balance taken on the 2nd counts on the 2nd; an account settlement counts
 *   when the customer pays it. Refunds come OFF the method that paid them
 *   back, mirroring how Carfectionist nets its reversal mirrors in: "Cash
 *   Rs 19,792" must mean what the drawer saw, or the figure is decoration.
 *
 *   INVOICED — the period's revenue: sales issued minus credit notes, voids at
 *   zero. The basis for VAT and P&L, on the sale date.
 *
 *   NOT YET COLLECTED — invoiced in the period minus money that arrived in
 *   the period. Under cash basis the two legs live in different periods
 *   whenever anything is paid across visits, so this is a period mismatch to
 *   read, not pure account lending — though with no deposits or settlements
 *   in range it is exactly the account lending again.
 *
 * The two rules that keep all of this honest: a `credit` tender is NOT money
 * (a debt, filtered out and totalled into `onAccount`), and neither is a
 * `deposit` tender (an internal allocation of money that arrived as a top-up
 * and is counted there — counting both would book every deposit twice).
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

  const [salesResult, tenderResult, depositResult, settlementResult, creditResult, accountResult] =
    await Promise.all([
      // INVOICED stays on the sale date. The money legs below are filtered by
      // their own timestamps instead — see the payments query.
      supabase
        .from("sales")
        .select(`id, sale_no, sale_date, status, total`)
        .gte("sale_date", after)
        .lte("sale_date", before)
        .order("sale_date", { ascending: false })
        .limit(ROW_CAP + 1),
      // Money that arrived with a sale, on the day it arrived. `credit`
      // tenders are debts and `deposit` tenders move earlier money, so
      // neither is money in.
      supabase
        .from("sale_payments")
        .select(
          `id, method, amount, created_at,
           sales!inner ( id, sale_no, status, customers ( full_name ) )`,
        )
        .gte("created_at", after)
        .lte("created_at", before)
        .not("method", "in", "(credit,deposit)")
        .neq("sales.status", "void")
        .order("created_at", { ascending: false })
        .limit(ROW_CAP + 1),
      // Money held for a future pickup, on the day it arrived.
      supabase
        .from("deposit_order_payments")
        .select(
          `id, amount, method, created_at,
           deposit_orders ( order_no, customers ( full_name ) )`,
        )
        .eq("entry_type", "payment")
        .gt("amount", 0)
        .gte("created_at", after)
        .lte("created_at", before)
        .order("created_at", { ascending: false })
        .limit(ROW_CAP + 1),
      // Money settling bills invoiced earlier. Stored negative (debt down).
      supabase
        .from("customer_credit_entries")
        .select(`id, amount, method, created_at, customers ( full_name )`)
        .eq("entry_type", "settlement")
        .gte("created_at", after)
        .lte("created_at", before)
        .order("created_at", { ascending: false })
        .limit(ROW_CAP + 1),
      supabase
        .from("credit_notes")
        .select(
          `id, credit_no, created_at, total, refund_method,
           sales!credit_notes_sale_id_fkey ( id, sale_no, customers ( full_name ) )`,
        )
        .gte("created_at", after)
        .lte("created_at", before)
        .order("created_at", { ascending: false })
        .limit(ROW_CAP + 1),
      // Debts raised in the period: credit tenders are not money, but their
      // total is the period's account lending, counted forwards.
      supabase
        .from("sale_payments")
        .select(`amount, sales!inner ( status )`)
        .eq("method", "credit")
        .gte("created_at", after)
        .lte("created_at", before)
        .neq("sales.status", "void")
        .limit(ROW_CAP + 1),
    ])

  if (salesResult.error) throw salesResult.error
  if (tenderResult.error) throw tenderResult.error
  if (depositResult.error) throw depositResult.error
  if (settlementResult.error) throw settlementResult.error
  if (creditResult.error) throw creditResult.error
  if (accountResult.error) throw accountResult.error

  const saleRows = (salesResult.data ?? []).slice(0, ROW_CAP)
  const tenderRows = (tenderResult.data ?? []).slice(0, ROW_CAP)
  const topUpRows = (depositResult.data ?? []).slice(0, ROW_CAP)
  const settleRows = (settlementResult.data ?? []).slice(0, ROW_CAP)
  const creditRows = (creditResult.data ?? []).slice(0, ROW_CAP)
  const truncated =
    (salesResult.data?.length ?? 0) > ROW_CAP ||
    (tenderResult.data?.length ?? 0) > ROW_CAP ||
    (depositResult.data?.length ?? 0) > ROW_CAP ||
    (settlementResult.data?.length ?? 0) > ROW_CAP ||
    (creditResult.data?.length ?? 0) > ROW_CAP

  const payments: (PaymentFact & CollectedRow)[] = []
  let invoicedSales = 0
  let paidOnSales = 0
  let onAccount = 0

  for (const sale of saleRows) {
    // A voided sale took no money and invoices nothing.
    if (sale.status === "void") continue
    invoicedSales = round2(invoicedSales + Number(sale.total))
  }

  // onAccount counts the period's credit tenders, from the one query that
  // reads them — a debt raised here is the period's account lending, even
  // though it is not money and reaches neither COLLECTED nor byMethod. Left
  // in those, a Rs 5,000 sale on account added Rs 5,000 to "money received"
  // and the reports page told the owner the shop had taken thousands it was
  // still owed.
  for (const tender of accountResult.data ?? []) {
    onAccount = round2(onAccount + Number((tender as { amount: number }).amount))
  }

  for (const payment of tenderRows) {
    const amount = round2(Number(payment.amount))
    const sale = (payment as unknown as { sales: { id: number; sale_no: string; customers?: { full_name: string } | null } }).sales
    paidOnSales = round2(paidOnSales + amount)
    payments.push({
      key: `p${(payment as { id: number }).id}`,
      at: (payment as { created_at: string }).created_at,
      reference: sale.sale_no,
      saleId: sale.id,
      customerName: sale.customers?.full_name ?? null,
      method: (payment as { method: string }).method,
      amount,
      kind: "payment",
    })
  }

  for (const topUp of topUpRows) {
    const t = topUp as unknown as {
      id: number
      amount: number
      method: string
      created_at: string
      deposit_orders?: { order_no: string; customers?: { full_name: string } | null } | null
    }
    const amount = round2(Number(t.amount))
    paidOnSales = round2(paidOnSales + amount)
    payments.push({
      key: `d${t.id}`,
      at: t.created_at,
      reference: t.deposit_orders?.order_no ?? `D-${t.id}`,
      saleId: 0,
      customerName: t.deposit_orders?.customers?.full_name ?? null,
      method: t.method,
      amount,
      kind: "payment",
    })
  }

  for (const entry of settleRows) {
    const e = entry as unknown as {
      id: number
      amount: number
      method: string | null
      created_at: string
      customers?: { full_name: string } | null
    }
    // Stored negative (debt down); the report states money in.
    const amount = round2(-Number(e.amount))
    paidOnSales = round2(paidOnSales + amount)
    payments.push({
      key: `t${e.id}`,
      at: e.created_at,
      reference: `STL-${e.id}`,
      saleId: 0,
      customerName: e.customers?.full_name ?? null,
      method: e.method ?? "cash",
      amount,
      kind: "payment",
    })
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
    // Invoiced in the period minus money that arrived in the period. The two
    // legs live in different periods whenever anything is paid across visits
    // — a deposit taken before, a settlement after — so this mixes genuine
    // account lending with timing. With neither in range it is the lending
    // again, and anything above `onAccount` is ledger drift worth a look.
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
