import { endOfShopDay, round2, startOfShopDay } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * The sales journal — money that moved, in order.
 *
 * CASH-RECEIVED BASIS (the owner's call): every figure here is money that
 * REACHED the business inside the period, whatever it settled — not what was
 * invoiced. A deposit taken on the 25th and picked up on the 2nd is takings
 * for the 25th (as a deposit) and the 2nd (for any fresh money that day); an
 * unpaid bill is not takings at all. A bill paid across visits is split
 * across the days each leg arrived, carrying its pro-rata share of the
 * frozen VAT — the same rule Carfectionist's journal uses.
 *
 * This puts the Taxes section on a cash basis too: the MRA only accepts that
 * if the business is approved for cash accounting. The standalone VAT report
 * stays on the invoice basis, which needs no approval.
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
 *    Each tender leg carries its pro-rata share of the sale's frozen VAT, so
 *    split payments still foot to it.
 *
 * 3. VOID DOCUMENTS STILL APPEAR, at zero, on their sale date. A gap in an
 *    invoice sequence is what an auditor looks for first; a voided number
 *    that is simply absent reads as a deleted sale. It is listed, marked
 *    void, and contributes nothing. Voids never moved money, so they stay on
 *    the document date rather than a payment date they do not have.
 *
 * 4. THE SHOP'S CALENDAR DAY DECIDES THE PERIOD. Money at 9pm belongs to that
 *    day in Mauritius, not to whatever UTC thought.
 *
 * What counts as money in: sale tenders except `credit` (a debt, not a
 * receipt) and `deposit` (an internal allocation of money that arrived as a
 * top-up and is counted there); deposit top-ups of every rail; account
 * settlements. What counts as money out: credit notes on their refund date.
 */

export type JournalRow = {
  /** Stable key for the list — one sale can now appear several times. */
  key: string
  /** "sale", "deposit" and "settlement" are money in; "credit" is money out. */
  kind: "sale" | "deposit" | "settlement" | "credit"
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
  vatStatus: "VAT registered" | "Not VAT registered" | "No VAT event"
  /** Excluding VAT. Negative on a credit note. */
  net: number
  /** The VAT within the gross. Negative on a credit note. */
  vat: number
  /** What actually changed hands. Negative on a credit note. */
  gross: number
  /** "completed", "refunded", "void", "deposit", "settlement" or "credit". */
  status: string
  /** The sale a credit note was raised against. */
  againstReference?: string
}

export type SalesJournal = {
  from: string
  to: string
  rows: JournalRow[]
  totals: { net: number; vat: number; gross: number }
  /** Money events counted separately — an auditor asks for each. */
  counts: {
    payments: number
    deposits: number
    settlements: number
    credits: number
    voids: number
  }
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
    key: `s${sale.saleNo}`,
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
 * One tender leg of a sale, on the day the money arrived.
 *
 * The leg's share of the sale's frozen VAT travels with it, so a bill paid
 * across two months states the right tax in each. Shares are largest-
 * remainder whole cents, so the legs in a period foot exactly.
 */
export function paymentLegLine(leg: {
  paymentId: number
  saleNo: string
  at: string
  method: string
  amount: number
  vatShare: number
  vatEnabled: boolean
  vatRate: number
  customerName?: string | null
  cashierName?: string | null
  status?: string
}): JournalRow {
  // A negative leg is money that LEFT the shop — an exchange refund leg —
  // and reads as a mistake if printed as a plain negative figure elsewhere.
  // Here negativity is the point of the report, so it stays signed.
  const gross = leg.amount
  const vat = leg.vatShare
  return {
    key: `p${leg.paymentId}`,
    kind: "sale",
    reference: leg.saleNo,
    at: leg.at,
    customerName: leg.customerName ?? null,
    cashierName: leg.cashierName ?? null,
    methods: [leg.method],
    vatEnabled: leg.vatEnabled,
    vatRate: leg.vatRate,
    vatStatus: leg.vatEnabled ? "VAT registered" : "Not VAT registered",
    net: round2(gross - vat),
    vat: round2(vat),
    gross: round2(gross),
    status: leg.status ?? "completed",
  }
}

/**
 * A deposit top-up: money in against a future pickup. No VAT has fallen due —
 * no goods have left — so the whole leg is net, exactly as the deposit slip
 * states it.
 */
export function depositLine(topUp: {
  paymentId: number
  orderNo: string
  at: string
  method: string
  amount: number
  customerName?: string | null
  cashierName?: string | null
}): JournalRow {
  return {
    key: `d${topUp.paymentId}`,
    kind: "deposit",
    reference: topUp.orderNo,
    at: topUp.at,
    customerName: topUp.customerName ?? null,
    cashierName: topUp.cashierName ?? null,
    methods: [topUp.method],
    vatEnabled: false,
    vatRate: 0,
    vatStatus: "No VAT event",
    net: round2(topUp.amount),
    vat: 0,
    gross: round2(topUp.amount),
    status: "deposit",
  }
}

/**
 * An account settlement: money in against bills invoiced earlier. Those bills
 * counted nothing when raised; this is where they count.
 */
export function settlementLine(entry: {
  entryId: number
  at: string
  amount: number
  method?: string | null
  customerName?: string | null
}): JournalRow {
  return {
    key: `t${entry.entryId}`,
    kind: "settlement",
    reference: `STL-${entry.entryId}`,
    at: entry.at,
    customerName: entry.customerName ?? null,
    cashierName: null,
    methods: entry.method ? [entry.method] : [],
    vatEnabled: false,
    vatRate: 0,
    vatStatus: "No VAT event",
    net: round2(entry.amount),
    vat: 0,
    gross: round2(entry.amount),
    status: "settlement",
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
    key: `c${note.creditNo}`,
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

/**
 * Splits whole cents across weighted legs, largest remainder first, so the
 * shares add up exactly. Signs follow the weights: a negative (money-out)
 * leg carries a negative share.
 */
export function splitCents(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return []
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (totalWeight === 0) return weights.map(() => 0)
  const raws = weights.map((w) => (totalCents * w) / totalWeight)
  const shares = raws.map((r) => Math.trunc(r))
  let remainder = totalCents - shares.reduce((sum, s) => sum + s, 0)
  const dir = Math.sign(remainder)
  const order = raws
    .map((r, i) => ({ i, frac: (r - Math.trunc(r)) * dir }))
    .sort((a, b) => b.frac - a.frac)
    .map((o) => o.i)
  while (remainder !== 0) {
    for (const i of order) {
      if (remainder === 0) break
      shares[i] += dir
      remainder -= dir
    }
  }
  return shares
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

type RawSaleHead = {
  sale_no: string
  status: string
  vat_enabled: boolean
  vat_rate: number
  vat_amount: number
  total: number
  customers?: { full_name: string } | null
  profiles?: { full_name: string } | null
}

type RawLeg = {
  id: number
  sale_id: number
  method: string
  amount: number
  created_at: string
  sales: RawSaleHead
}

export async function getSalesJournal(
  from: string,
  to: string,
): Promise<SalesJournal> {
  const supabase = await createClient()
  const after = startOfShopDay(from)
  const before = endOfShopDay(to)

  const [
    { data: legs, error: legsError },
    { data: topUps, error: topUpsError },
    { data: settlements, error: settlementsError },
    { data: credits, error: creditError },
    { data: voids, error: voidsError },
  ] = await Promise.all([
    // Money that arrived with a sale. `credit` tenders are debts and
    // `deposit` tenders move earlier money, so neither is money in.
    supabase
      .from("sale_payments")
      .select(
        `id, sale_id, method, amount, created_at,
         sales!inner ( sale_no, status, vat_enabled, vat_rate, vat_amount, total,
           customers ( full_name ), profiles ( full_name ) )`,
      )
      .gte("created_at", after)
      .lte("created_at", before)
      .not("method", "in", "(credit,deposit)")
      .neq("sales.status", "void")
      .order("created_at", { ascending: true })
      .limit(JOURNAL_LIMIT + 1),
    // Money held for a future pickup, every rail.
    supabase
      .from("deposit_order_payments")
      .select(`id, amount, method, created_at, order_id, deposit_orders ( order_no, customer_id, cashier_id )`)
      .eq("entry_type", "payment")
      .gt("amount", 0)
      .gte("created_at", after)
      .lte("created_at", before)
      .order("created_at", { ascending: true })
      .limit(JOURNAL_LIMIT + 1),
    // Money settling bills invoiced earlier. Stored negative (debt down).
    supabase
      .from("customer_credit_entries")
      .select(`id, amount, method, created_at, customer_id, customers ( full_name )`)
      .eq("entry_type", "settlement")
      .gte("created_at", after)
      .lte("created_at", before)
      .order("created_at", { ascending: true })
      .limit(JOURNAL_LIMIT + 1),
    supabase
      .from("credit_notes")
      .select(
        `id, credit_no, created_at, vat_enabled, vat_rate, vat_amount, total, refund_method, reason,
         profiles!credit_notes_cashier_id_fkey ( full_name ),
         sales!credit_notes_sale_id_fkey ( sale_no, customers ( full_name ) )`,
      )
      .gte("created_at", after)
      .lte("created_at", before)
      .order("created_at", { ascending: true })
      .limit(JOURNAL_LIMIT + 1),
    // Voids never moved money: listed at zero on their sale date so the
    // invoice sequence has no holes.
    supabase
      .from("sales")
      .select(
        `id, sale_no, sale_date, status, vat_enabled, vat_rate, vat_amount, total,
         profiles ( full_name ),
         customers ( full_name )`,
      )
      .eq("status", "void")
      .gte("sale_date", after)
      .lte("sale_date", before)
      .order("sale_date", { ascending: true })
      .limit(JOURNAL_LIMIT + 1),
  ])

  if (legsError) throw legsError
  if (topUpsError) throw topUpsError
  if (settlementsError) throw settlementsError
  if (creditError) throw creditError
  if (voidsError) throw voidsError

  const legRows = (legs ?? []).slice(0, JOURNAL_LIMIT)
  const topUpRows = (topUps ?? []).slice(0, JOURNAL_LIMIT)
  const settlementRows = (settlements ?? []).slice(0, JOURNAL_LIMIT)
  const creditRows = (credits ?? []).slice(0, JOURNAL_LIMIT)
  const voidRows = (voids ?? []).slice(0, JOURNAL_LIMIT)

  // Names without guessing at foreign-key names: one batched lookup each.
  const customerIds = [
    ...new Set(
      topUpRows
        .map((t) => t.deposit_orders?.customer_id)
        .filter((id): id is number => typeof id === "number"),
    ),
  ]
  const cashierIds = [
    ...new Set(
      topUpRows
        .map((t) => t.deposit_orders?.cashier_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ]
  const [customerNames, cashierNames] = await Promise.all([
    customerIds.length > 0
      ? supabase.from("customers").select("id, full_name").in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
    cashierIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", cashierIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (customerNames.error) throw customerNames.error
  if (cashierNames.error) throw cashierNames.error
  const customerById = new Map(
    ((customerNames.data ?? []) as { id: number; full_name: string }[]).map((c) => [c.id, c.full_name]),
  )
  const cashierById = new Map(
    ((cashierNames.data ?? []) as { id: string; full_name: string }[]).map((c) => [c.id, c.full_name]),
  )

  const rows: JournalRow[] = []

  // Group a sale's legs so each carries its share of the frozen VAT.
  const legsBySale = new Map<number, RawLeg[]>()
  for (const raw of legRows) {
    const leg = raw as unknown as RawLeg
    if (typeof leg.sale_id !== "number" || !leg.sales) continue
    const group = legsBySale.get(leg.sale_id) ?? []
    group.push(leg)
    legsBySale.set(leg.sale_id, group)
  }

  for (const [, group] of legsBySale) {
    const head = group[0].sales
    const frozenVatCents = Math.round(Number(head.vat_amount) * 100)
    const shares = splitCents(
      frozenVatCents,
      group.map((leg) => Number(leg.amount)),
    )
    group.forEach((leg, i) => {
      rows.push(
        paymentLegLine({
          paymentId: leg.id,
          saleNo: head.sale_no,
          at: leg.created_at,
          method: leg.method,
          amount: Number(leg.amount),
          vatShare: (shares[i] ?? 0) / 100,
          vatEnabled: head.vat_enabled,
          vatRate: Number(head.vat_rate),
          customerName: head.customers?.full_name ?? null,
          cashierName: head.profiles?.full_name ?? null,
          status: head.status,
        }),
      )
    })
  }

  for (const topUp of topUpRows) {
    const t = topUp as unknown as {
      id: number
      amount: number
      method: string
      created_at: string
      order_id: number
      deposit_orders?: { order_no: string; customer_id: number; cashier_id: string } | null
    }
    rows.push(
      depositLine({
        paymentId: t.id,
        orderNo: t.deposit_orders?.order_no ?? `D-${t.order_id ?? t.id}`,
        at: t.created_at,
        method: t.method,
        amount: Number(t.amount),
        customerName: t.deposit_orders?.customer_id
          ? (customerById.get(t.deposit_orders.customer_id) ?? null)
          : null,
        cashierName: t.deposit_orders?.cashier_id
          ? (cashierById.get(t.deposit_orders.cashier_id) ?? null)
          : null,
      }),
    )
  }

  for (const entry of settlementRows) {
    const e = entry as unknown as {
      id: number
      amount: number
      method: string | null
      created_at: string
      customers?: { full_name: string } | null
    }
    rows.push(
      settlementLine({
        entryId: e.id,
        at: e.created_at,
        // Settlements are stored negative (debt down); the journal states money in.
        amount: -Number(e.amount),
        method: e.method,
        customerName: e.customers?.full_name ?? null,
      }),
    )
  }

  for (const note of creditRows.slice(0, JOURNAL_LIMIT)) {
    const n = note as unknown as {
      credit_no: string
      created_at: string
      vat_amount: number
      vat_enabled: boolean
      vat_rate: number
      total: number
      refund_method: string | null
      profiles?: { full_name: string } | null
      sales?: { sale_no: string; customers?: { full_name: string } | null } | null
    }
    rows.push(
      creditLine({
        creditNo: n.credit_no,
        createdAt: n.created_at,
        vatAmount: Number(n.vat_amount),
        vatEnabled: n.vat_enabled,
        vatRate: Number(n.vat_rate),
        total: Number(n.total),
        refundMethod: n.refund_method,
        customerName: n.sales?.customers?.full_name ?? null,
        cashierName: n.profiles?.full_name ?? null,
        againstReference: n.sales?.sale_no,
      }),
    )
  }

  for (const sale of voidRows) {
    const s = sale as unknown as {
      sale_no: string
      sale_date: string
      status: string
      vat_amount: number
      vat_enabled: boolean
      vat_rate: number
      total: number
      customers?: { full_name: string } | null
      profiles?: { full_name: string } | null
    }
    rows.push(
      saleLine({
        saleNo: s.sale_no,
        saleDate: s.sale_date,
        status: s.status,
        vatAmount: Number(s.vat_amount),
        vatEnabled: s.vat_enabled,
        vatRate: Number(s.vat_rate),
        total: Number(s.total),
        customerName: s.customers?.full_name ?? null,
        cashierName: s.profiles?.full_name ?? null,
        methods: [],
      }),
    )
  }

  // One sequence, oldest first. Same instant orders by reference so the
  // journal is stable between runs — an accountant comparing two exports of
  // the same period should see the same file.
  rows.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key))

  const totals = journalTotals(rows)

  return {
    from,
    to,
    rows,
    totals,
    counts: {
      payments: rows.filter((r) => r.kind === "sale" && r.status !== "void").length,
      deposits: rows.filter((r) => r.kind === "deposit").length,
      settlements: rows.filter((r) => r.kind === "settlement").length,
      credits: rows.filter((r) => r.kind === "credit").length,
      voids: rows.filter((r) => r.status === "void").length,
    },
    truncated:
      (legs?.length ?? 0) > JOURNAL_LIMIT ||
      (topUps?.length ?? 0) > JOURNAL_LIMIT ||
      (settlements?.length ?? 0) > JOURNAL_LIMIT ||
      creditRows.length > JOURNAL_LIMIT ||
      voidRows.length > JOURNAL_LIMIT,
  }
}
