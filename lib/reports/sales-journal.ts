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
  sections: JournalSections
  /** True when the period held more documents than were read. */
  truncated: boolean
}

/**
 * The journal broken down five ways, Carfectionist-style — every figure money
 * received in the period, not invoices issued.
 */
export type JournalSections = {
  billsSettled: number
  totalReceived: number
  clients: number
  avgTicket: number
  byMethod: {
    method: string
    bills: number
    excl: number
    incl: number
    /** The documents that made up this method's takings, for the drill-down. */
    breakdown: {
      ref: string
      saleId: number | null
      customer: string | null
      excl: number
      incl: number
    }[]
  }[]
  taxes: { label: string; rate: number; tax: number; discount: number; excl: number; incl: number }[]
  payments: { method: string; bills: number; amount: number }[]
  settledEarlier: { bills: number; amount: number }
  categories: { label: string; qty: number; pct: number; excl: number; incl: number }[]
  users: { name: string; bills: number; excl: number; incl: number }[]
}

/** One money-in leg with everything the sections need. Exported for tests. */
export type JournalLeg = {
  /** "sale" legs settle bills; deposits and settlements are money without one. */
  doc: "sale" | "deposit" | "settlement"
  saleNo: string
  /** The sale's row id, for linking to it and its receipt — null off a sale. */
  saleId: number | null
  /** The sale's own date — legs on older bills are "settled earlier". */
  saleDate: string
  at: string
  method: string
  gross: number
  net: number
  vat: number
  vatEnabled: boolean
  vatRate: number
  /** This leg's share of the sale's total discount, for the tax bands. */
  discountShare: number
  customerName: string | null
  cashierName: string | null
  /** Category mix of the sale: label → weight (line totals). */
  categories: { label: string; weight: number; qty: number }[]
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

function rateLabel(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "Zero-rated"
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`
}

/**
 * Breaks money-in legs five ways. Pure, so the section arithmetic is testable
 * without a database.
 *
 * A leg counts for the sale it settles under "bills settled" once no matter
 * how many tenders it took; a leg on a bill raised before the period counts
 * under "settled earlier" instead. Category and discount shares ride each
 * leg's own weights, so every section foots to the same total.
 */
export function buildJournalSections(
  legs: JournalLeg[],
  /** ISO instant the period opens — legs on older bills settle earlier ones. */
  periodStartIso: string,
): JournalSections {
  const totalReceived = round2(legs.reduce((sum, l) => sum + l.gross, 0))
  const clients = new Set(
    legs.map((l) => l.customerName).filter((n): n is string => !!n),
  ).size

  // Bills are sales settled — deposits and settlements are money without one.
  const saleBills = (group: JournalLeg[]) =>
    new Set(group.filter((l) => l.doc === "sale").map((l) => l.saleNo)).size
  const billNos = [...new Set(legs.filter((l) => l.doc === "sale").map((l) => l.saleNo))]

  const byMethod = [...groupBy(legs, (l) => l.method)].map(([method, group]) => ({
    method,
    bills: saleBills(group),
    excl: round2(group.reduce((sum, l) => sum + l.net, 0)),
    incl: round2(group.reduce((sum, l) => sum + l.gross, 0)),
    breakdown: billBreakdown(group),
  }))

  // Every band VAT applied to, plus one that gathers the money no VAT touched,
  // so the section foots to what was received rather than to the taxable slice.
  const taxed = [...groupBy(legs.filter((l) => l.vatEnabled), (l) => String(l.vatRate))].map(
    ([rateKey, group]) => {
      const rate = Number(rateKey)
      return {
        label: rateLabel(rate),
        rate,
        tax: round2(group.reduce((sum, l) => sum + l.vat, 0)),
        discount: round2(group.reduce((sum, l) => sum + l.discountShare, 0)),
        excl: round2(group.reduce((sum, l) => sum + l.net, 0)),
        incl: round2(group.reduce((sum, l) => sum + l.gross, 0)),
      }
    },
  )
  const untaxed = legs.filter((l) => !l.vatEnabled)
  const taxes = untaxed.length
    ? [
        ...taxed,
        {
          label: "No VAT event",
          rate: 0,
          tax: 0,
          discount: round2(untaxed.reduce((sum, l) => sum + l.discountShare, 0)),
          excl: round2(untaxed.reduce((sum, l) => sum + l.net, 0)),
          incl: round2(untaxed.reduce((sum, l) => sum + l.gross, 0)),
        },
      ]
    : taxed

  const payments = [...groupBy(legs, (l) => l.method)].map(([method, group]) => ({
    method,
    bills: saleBills(group),
    amount: round2(group.reduce((sum, l) => sum + l.gross, 0)),
  }))

  // A leg on a bill raised before the period opened — money in now, invoiced
  // earlier. Compared as instants: the same wall-clock day is not the same
  // string once the stored offset (UTC) differs from the shop's (+04).
  const periodStart = new Date(periodStartIso).getTime()
  const earlier = legs.filter(
    (l) => l.doc === "sale" && new Date(l.saleDate).getTime() < periodStart,
  )
  const settledEarlier = {
    bills: new Set(earlier.map((l) => l.saleNo)).size,
    amount: round2(earlier.reduce((sum, l) => sum + l.gross, 0)),
  }

  const catGross = new Map<string, number>()
  const catNet = new Map<string, number>()
  const catQty = new Map<string, number>()
  for (const leg of legs) {
    const totalWeight = leg.categories.reduce((sum, c) => sum + c.weight, 0)
    const ratio = leg.gross === 0 ? 0 : leg.net / leg.gross
    if (totalWeight <= 0) {
      catGross.set("(uncategorised)", round2((catGross.get("(uncategorised)") ?? 0) + leg.gross))
      catNet.set("(uncategorised)", round2((catNet.get("(uncategorised)") ?? 0) + leg.net))
      catQty.set("(uncategorised)", round2((catQty.get("(uncategorised)") ?? 0) + 0))
      continue
    }
    for (const c of leg.categories) {
      const share = (leg.gross * c.weight) / totalWeight
      catGross.set(c.label, round2((catGross.get(c.label) ?? 0) + share))
      catNet.set(c.label, round2((catNet.get(c.label) ?? 0) + share * ratio))
      // The category's units, scaled by the paid share of the sale.
      catQty.set(c.label, round2((catQty.get(c.label) ?? 0) + (c.qty * leg.gross) / totalWeight))
    }
  }
  const categories = [...catGross.entries()].map(([label, incl]) => ({
    label,
    qty: catQty.get(label) ?? 0,
    pct: totalReceived === 0 ? 0 : round2((incl / totalReceived) * 100),
    excl: catNet.get(label) ?? 0,
    incl: round2(incl),
  }))

  const users = [...groupBy(legs, (l) => l.cashierName ?? "—")].map(([name, group]) => ({
    name,
    bills: saleBills(group),
    excl: round2(group.reduce((sum, l) => sum + l.net, 0)),
    incl: round2(group.reduce((sum, l) => sum + l.gross, 0)),
  }))

  return {
    billsSettled: billNos.length,
    totalReceived,
    clients,
    avgTicket: billNos.length === 0 ? 0 : round2(totalReceived / billNos.length),
    byMethod,
    taxes,
    payments,
    settledEarlier,
    categories,
    users,
  }
}

/** One method's takings split by the document each leg belongs to. */
function billBreakdown(group: JournalLeg[]): JournalSections["byMethod"][number]["breakdown"] {
  return [...groupBy(group, (l) => l.saleNo)].map(([ref, legs]) => ({
    ref,
    saleId: legs.find((l) => l.saleId != null)?.saleId ?? null,
    customer: legs.find((l) => l.customerName)?.customerName ?? null,
    excl: round2(legs.reduce((sum, l) => sum + l.net, 0)),
    incl: round2(legs.reduce((sum, l) => sum + l.gross, 0)),
  }))
}

function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of list) {
    const k = key(item)
    const group = map.get(k) ?? []
    group.push(item)
    map.set(k, group)
  }
  return map
}

type RawSaleHead = {
  sale_no: string
  sale_date: string
  discount: number
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
         sales!inner ( sale_no, sale_date, discount, status, vat_enabled, vat_rate, vat_amount, total,
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

  // Group a sale's legs so each carries its share of the frozen VAT and
  // discount, and fetch what each sale sold for the category mix.
  const legsBySale = new Map<number, RawLeg[]>()
  for (const raw of legRows) {
    const leg = raw as unknown as RawLeg
    if (typeof leg.sale_id !== "number" || !leg.sales) continue
    const group = legsBySale.get(leg.sale_id) ?? []
    group.push(leg)
    legsBySale.set(leg.sale_id, group)
  }

  const legSaleIds = [...legsBySale.keys()]
  const { data: itemRows, error: itemsError } = legSaleIds.length
    ? await supabase
        .from("sale_items")
        .select(
          `sale_id, qty, line_total, discount, variant_id,
           product_variants ( products ( id, name, category_id ) )`,
        )
        .in("sale_id", legSaleIds)
    : { data: [], error: null }
  if (itemsError) throw itemsError

  const categoryIds = [
    ...new Set(
      ((itemRows ?? []) as unknown as {
        product_variants?: { products?: { category_id: number | null } | null } | null
      }[])
        .map((it) => it.product_variants?.products?.category_id)
        .filter((id): id is number => typeof id === "number"),
    ),
  ]
  const { data: categoryRows, error: categoryError } = categoryIds.length
    ? await supabase.from("categories").select("id, name").in("id", categoryIds)
    : { data: [], error: null }
  if (categoryError) throw categoryError
  const categoryById = new Map(
    ((categoryRows ?? []) as { id: number; name: string }[]).map((c) => [c.id, c.name]),
  )

  type SaleMix = {
    head: RawSaleHead
    categories: { label: string; weight: number; qty: number }[]
    discountTotal: number
  }
  const mixBySale = new Map<number, SaleMix>()
  for (const [saleId, group] of legsBySale) {
    const head = group[0].sales
    const lines = ((itemRows ?? []) as unknown as {
      sale_id: number
      qty: number
      line_total: number
      discount: number
      variant_id: number | null
      product_variants?: { products?: { name: string; category_id: number | null } | null } | null
    }[]).filter((it) => it.sale_id === saleId)
    const catWeight = new Map<string, number>()
    const catQty = new Map<string, number>()
    for (const line of lines) {
      const label =
        line.variant_id == null
          ? "(uncategorised)"
          : (categoryById.get(line.product_variants?.products?.category_id ?? -1) ??
            "(uncategorised)")
      catWeight.set(label, round2((catWeight.get(label) ?? 0) + Number(line.line_total)))
      catQty.set(label, round2((catQty.get(label) ?? 0) + Number(line.qty)))
    }
    mixBySale.set(saleId, {
      head,
      categories: [...catWeight.entries()].map(([label, weight]) => ({
        label,
        weight,
        qty: catQty.get(label) ?? 0,
      })),
      discountTotal: round2(
        Number(head.discount ?? 0) + lines.reduce((sum, l) => sum + Number(l.discount), 0),
      ),
    })
  }

  const sectionLegs: JournalLeg[] = []

  for (const [saleId, group] of legsBySale) {
    const head = group[0].sales
    const mix = mixBySale.get(saleId)
    const frozenVatCents = Math.round(Number(head.vat_amount) * 100)
    const shares = splitCents(
      frozenVatCents,
      group.map((leg) => Number(leg.amount)),
    )
    const discountShares = splitCents(
      Math.round((mix?.discountTotal ?? 0) * 100),
      group.map((leg) => Number(leg.amount)),
    )
    group.forEach((leg, i) => {
      const vatShare = (shares[i] ?? 0) / 100
      rows.push(
        paymentLegLine({
          paymentId: leg.id,
          saleNo: head.sale_no,
          at: leg.created_at,
          method: leg.method,
          amount: Number(leg.amount),
          vatShare,
          vatEnabled: head.vat_enabled,
          vatRate: Number(head.vat_rate),
          customerName: head.customers?.full_name ?? null,
          cashierName: head.profiles?.full_name ?? null,
          status: head.status,
        }),
      )
      sectionLegs.push({
        doc: "sale",
        saleNo: head.sale_no,
        saleId,
        saleDate: head.sale_date,
        at: leg.created_at,
        method: leg.method,
        gross: round2(Number(leg.amount)),
        net: round2(Number(leg.amount) - vatShare),
        vat: round2(vatShare),
        vatEnabled: head.vat_enabled,
        vatRate: Number(head.vat_rate),
        discountShare: (discountShares[i] ?? 0) / 100,
        customerName: head.customers?.full_name ?? null,
        cashierName: head.profiles?.full_name ?? null,
        categories: mix?.categories ?? [],
      })
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
    const customerName = t.deposit_orders?.customer_id
      ? (customerById.get(t.deposit_orders.customer_id) ?? null)
      : null
    rows.push(
      depositLine({
        paymentId: t.id,
        orderNo: t.deposit_orders?.order_no ?? `D-${t.order_id ?? t.id}`,
        at: t.created_at,
        method: t.method,
        amount: Number(t.amount),
        customerName,
        cashierName: t.deposit_orders?.cashier_id
          ? (cashierById.get(t.deposit_orders.cashier_id) ?? null)
          : null,
      }),
    )
    sectionLegs.push({
      doc: "deposit",
      saleNo: t.deposit_orders?.order_no ?? `D-${t.order_id ?? t.id}`,
      saleId: null,
      saleDate: t.created_at,
      at: t.created_at,
      method: t.method,
      gross: round2(Number(t.amount)),
      net: round2(Number(t.amount)),
      vat: 0,
      vatEnabled: false,
      vatRate: 0,
      discountShare: 0,
      customerName,
      cashierName: null,
      categories: [],
    })
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
    sectionLegs.push({
      doc: "settlement",
      saleNo: `STL-${e.id}`,
      saleId: null,
      saleDate: e.created_at,
      at: e.created_at,
      method: e.method ?? "cash",
      gross: round2(-Number(e.amount)),
      net: round2(-Number(e.amount)),
      vat: 0,
      vatEnabled: false,
      vatRate: 0,
      discountShare: 0,
      customerName: e.customers?.full_name ?? null,
      cashierName: null,
      categories: [],
    })
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
    sections: buildJournalSections(sectionLegs, after),
    truncated:
      (legs?.length ?? 0) > JOURNAL_LIMIT ||
      (topUps?.length ?? 0) > JOURNAL_LIMIT ||
      (settlements?.length ?? 0) > JOURNAL_LIMIT ||
      creditRows.length > JOURNAL_LIMIT ||
      voidRows.length > JOURNAL_LIMIT,
  }
}
