import { isSaleStatus, type SaleStatus } from "@/lib/db-enums"
import { endOfShopDay, shopToday, startOfShopDay } from "@/lib/format"
import type { TillClient } from "@/lib/pos/sale-core"
import { createClient } from "@/lib/supabase/server"

/**
 * Sales history and the dashboard figures.
 *
 * Everything is bounded by a date range or an explicit limit — an unfiltered
 * select is silently capped at max-rows, and a truncated *sales* figure would
 * be actively misleading rather than merely incomplete.
 */

export const SALES_PAGE_SIZE = 100

export type SaleRow = {
  id: number
  saleNo: string
  saleDate: string
  total: number
  status: SaleStatus
  /**
   * Units, not lines. Three of one shirt is three items — which is what the
   * customer carried out, what "items per sale" above the list already means,
   * and what "Items sold" on the dashboard means. It counted lines until
   * somebody put the three figures side by side.
   */
  itemCount: number
  cashierName: string | null
  customerName: string | null
  methods: string[]
  /**
   * Some of it has come back, but not all — the sale is still `completed`,
   * because that is only flipped once every unit returns.
   *
   * Worth a marker in the list: the way a return starts is a customer at the
   * counter with a receipt, and whether part of it was already credited
   * changes what happens next.
   */
  partReturned: boolean
}

export type SalesList = { rows: SaleRow[]; truncated: boolean }

export async function listSales(filters: {
  from?: string
  to?: string
  search?: string
} = {}): Promise<SalesList> {
  const supabase = await createClient()

  let query = supabase
    .from("sales")
    .select(
      `id, sale_no, sale_date, total, status,
       profiles ( full_name ),
       customers ( full_name ),
       sale_items ( qty ),
       sale_payments ( method ),
       credit_notes!credit_notes_sale_id_fkey ( id )`,
    )
    .order("sale_date", { ascending: false })
    .order("id", { ascending: false })

  // Local calendar dates converted to instants — see lib/format.
  if (filters.from) query = query.gte("sale_date", startOfShopDay(filters.from))
  if (filters.to) query = query.lte("sale_date", endOfShopDay(filters.to))

  // A customer at the counter holds a receipt, so the number is what gets
  // typed. Escaped because ilike treats % and _ as wildcards, and a sale_no
  // pasted with stray punctuation should still match itself and nothing else.
  const term = filters.search?.trim()
  if (term) {
    query = query.ilike("sale_no", `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
  }

  const { data, error } = await query.limit(SALES_PAGE_SIZE + 1)
  if (error) throw error

  const all = data ?? []
  const rows = all.slice(0, SALES_PAGE_SIZE).map<SaleRow>((row) => ({
    id: row.id,
    saleNo: row.sale_no,
    saleDate: row.sale_date,
    total: Number(row.total),
    status: isSaleStatus(row.status) ? row.status : "completed",
    itemCount: (row.sale_items ?? []).reduce((sum, i) => sum + i.qty, 0),
    cashierName: row.profiles?.full_name ?? null,
    customerName: row.customers?.full_name ?? null,
    methods: [...new Set((row.sale_payments ?? []).map((p) => p.method))],
    partReturned:
      row.status === "completed" && (row.credit_notes ?? []).length > 0,
  }))

  return { rows, truncated: all.length > SALES_PAGE_SIZE }
}

export type SaleDetail = {
  id: number
  saleNo: string
  saleDate: string
  status: SaleStatus
  subtotal: number
  discount: number
  vatAmount: number
  total: number
  /**
   * The VAT policy this sale was frozen under — the whole point of the toggle.
   *
   * A receipt reads `vatEnabled` to decide whether it is a VAT Invoice (with the
   * frozen number, rate and breakdown) or a plain Receipt, never today's shop
   * setting. `vatEnabled` is explicit rather than inferred from `vatAmount > 0`,
   * so an enabled zero-total sale is still a VAT invoice. Nullable because a
   * pre-migration legacy row may carry no policy id.
   */
  vatPolicyId: number | null
  vatEnabled: boolean
  vatRate: number
  vatNumber: string | null
  cashierName: string | null
  customerName: string | null
  customerId: number | null
  lines: {
    id: number
    productName: string
    sizeLabel: string
    colourName: string
    colourHex: string | null
    sku: string
    barcode: string | null
    qty: number
    unitPrice: number
    discount: number
    lineTotal: number
    /**
     * How many of this line have already come back on a credit note.
     *
     * Carried on the sale itself so a till can show what is still returnable
     * without a second round trip — and so it cannot offer to give back a unit
     * that has already been refunded. The RPC refuses that anyway; this is so
     * the cashier never gets that far.
     */
    returnedQty: number
  }[]
  payments: { id: number; method: string; amount: number; tendered: number | null }[]
  discounts: {
    label: string
    kind: string
    value: number
    amount: number
    /** Null unless a manager actually had to authorise it. */
    approvedByName: string | null
  }[]
  creditNotes: {
    id: number
    creditNo: string
    createdAt: string
    total: number
    reason: string
    refundMethod: string
  }[]
  /**
   * Every time this receipt went to a printer, newest first.
   *
   * `by` is the signed-in account, which on a shared till is the device rather
   * than the person — the PIN-selected cashier is app state the receipt tab
   * never sees. The count and the timestamps are the signal worth acting on.
   */
  prints: { id: number; printedAt: string; by: string | null }[]
}

/**
 * One sale, in full, for the back office.
 *
 * Distinct from `getSaleForReturn`, which loads what is still *returnable*.
 * This is the record as it stands: what was sold, what was paid, what was
 * discounted and who approved it, and what has since been credited back.
 *
 * The approver's name comes from a second query rather than a nested join.
 * `sales` and `sale_discounts` both point at `profiles`, and disambiguating
 * two foreign keys in one PostgREST select means naming the constraint — which
 * would then break silently if the constraint were ever renamed.
 */
export async function getSaleDetail(
  saleId: number,
  /** The Android till's bearer client. Omitted, this reads the cookie session. */
  client?: TillClient,
): Promise<SaleDetail | null> {
  const supabase = client ?? (await createClient())

  const [{ data, error }, { data: returnedRows }] = await Promise.all([
    supabase
    .from("sales")
    .select(
      `id, sale_no, sale_date, status, subtotal, discount, vat_amount, total,
       vat_policy_id, vat_enabled, vat_rate, vat_number,
       customer_id,
       profiles ( full_name ),
       customers ( full_name ),
       sale_items ( id, qty, unit_price, discount, line_total, description,
         product_variants ( sku, barcode,
           products ( name ), sizes ( label, sort_order ),
           colours ( name, hex_code ) ) ),
       sale_payments ( id, method, amount, tendered ),
       sale_discounts ( label, kind, value, amount, approved_by ),
       credit_notes!credit_notes_sale_id_fkey
         ( id, credit_no, created_at, total, reason, refund_method ),
       receipt_prints ( id, printed_at, printed_by )`,
    )
    .eq("id", saleId)
    .maybeSingle(),
    // What has already come back, summed per sale line. Joined through
    // `credit_notes` rather than filtered on the items, because a credit note
    // is what knows which sale it belongs to.
    supabase
      .from("credit_note_items")
      .select("sale_item_id, qty, credit_notes!inner ( sale_id )")
      .eq("credit_notes.sale_id", saleId),
  ])

  if (error) throw error
  if (!data) return null

  const returnedByLine = new Map<number, number>()
  for (const row of returnedRows ?? []) {
    returnedByLine.set(
      row.sale_item_id,
      (returnedByLine.get(row.sale_item_id) ?? 0) + row.qty,
    )
  }

  // Both the discount approver and the printer are profiles, resolved together
  // in one lookup rather than two.
  const approverIds = [
    ...new Set(
      [
        ...(data.sale_discounts ?? []).map((d) => d.approved_by),
        ...(data.receipt_prints ?? []).map((p) => p.printed_by),
      ].filter((id): id is string => Boolean(id)),
    ),
  ]

  const approvers = new Map<string, string>()
  if (approverIds.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", approverIds)
    for (const p of people ?? []) approvers.set(p.id, p.full_name)
  }

  // Sorted on the raw rows so `sort_order` never has to be carried on the
  // result just to be dropped again — it is a sort key, not part of a line.
  const items = [...(data.sale_items ?? [])].sort((a, b) => {
    const nameA = a.product_variants?.products?.name ?? a.description ?? ""
    const nameB = b.product_variants?.products?.name ?? b.description ?? ""
    return (
      nameA.localeCompare(nameB) ||
      (a.product_variants?.sizes?.sort_order ?? 0) -
        (b.product_variants?.sizes?.sort_order ?? 0)
    )
  })

  const lines = items.map((item) => ({
    id: item.id,
    // A custom line has no variant, so its description IS its name — on the
    // screen and on the receipt a customer walks out with. Falling through to
    // the em dash would print a charge with nothing beside it.
    productName: item.product_variants?.products?.name ?? item.description ?? "—",
    sizeLabel: item.product_variants?.sizes?.label ?? "—",
    colourName: item.product_variants?.colours?.name ?? "—",
    colourHex: item.product_variants?.colours?.hex_code ?? null,
    sku: item.product_variants?.sku ?? "—",
    barcode: item.product_variants?.barcode ?? null,
    qty: item.qty,
    unitPrice: Number(item.unit_price),
    discount: Number(item.discount),
    lineTotal: Number(item.line_total),
    returnedQty: returnedByLine.get(item.id) ?? 0,
  }))

  return {
    id: data.id,
    saleNo: data.sale_no,
    saleDate: data.sale_date,
    status: isSaleStatus(data.status) ? data.status : "completed",
    subtotal: Number(data.subtotal),
    discount: Number(data.discount),
    vatAmount: Number(data.vat_amount),
    total: Number(data.total),
    vatPolicyId: data.vat_policy_id,
    // Explicit, not inferred: an enabled zero-total sale is still a VAT invoice.
    vatEnabled: data.vat_enabled,
    vatRate: Number(data.vat_rate),
    vatNumber:
      typeof data.vat_number === "string" && data.vat_number.trim()
        ? data.vat_number.trim()
        : null,
    cashierName: data.profiles?.full_name ?? null,
    customerName: data.customers?.full_name ?? null,
    customerId: data.customer_id,
    lines,
    payments: (data.sale_payments ?? []).map((p) => ({
      id: p.id,
      method: p.method,
      amount: Number(p.amount),
      tendered: p.tendered === null ? null : Number(p.tendered),
    })),
    discounts: (data.sale_discounts ?? []).map((d) => ({
      label: d.label,
      kind: d.kind,
      value: Number(d.value),
      amount: Number(d.amount),
      approvedByName: d.approved_by ? (approvers.get(d.approved_by) ?? "a manager") : null,
    })),
    creditNotes: (data.credit_notes ?? []).map((c) => ({
      id: c.id,
      creditNo: c.credit_no,
      createdAt: c.created_at,
      total: Number(c.total),
      reason: c.reason,
      refundMethod: c.refund_method,
    })),
    prints: (data.receipt_prints ?? [])
      .map((p) => ({
        id: p.id,
        printedAt: p.printed_at,
        by: p.printed_by ? (approvers.get(p.printed_by) ?? null) : null,
      }))
      .sort((a, b) => b.printedAt.localeCompare(a.printedAt)),
  }
}

export type TopSeller = {
  /** Variant id, or the product name when the variant has been deleted. */
  key: string
  name: string
  sizeLabel: string | null
  colourName: string | null
  colourHex: string | null
  qty: number
  revenue: number
}

export type AwaitingDelivery = {
  /** Purchases still in draft — ordered, not yet received. */
  count: number
  nextSupplier: string | null
  nextDate: string | null
}

export type DashboardStats = {
  todayTotal: number
  todayCount: number
  todayItems: number
  weekTotal: number
  /**
   * Today against the same weekday a week ago, AT THE SAME TIME OF DAY.
   *
   * Same weekday, not yesterday: a shop's takings swing hard by day, and a
   * Saturday against a Friday says nothing useful.
   *
   * Same time of day because otherwise this is a partial day measured against
   * a complete one. At 10am the shop has taken a fraction of what it will, so
   * a naive comparison shows about -85% and reads as a collapse — on the most
   * prominent figure on the dashboard, every morning. Last week's day is
   * therefore truncated at the current clock time; by closing the two are
   * whole days again and it converges on the true comparison.
   *
   * Null when that window took nothing: a percentage against zero is not a
   * comparison.
   */
  todayVsLastWeek: { percent: number; weekdayName: string } | null
  lowStockCount: number
  topSellers: TopSeller[]
  awaiting: AwaitingDelivery
  /**
   * Last seven shop-days, oldest first, for the chart's Week view.
   *
   * `prev` is what the same weekday took a week earlier, drawn behind the
   * curve as the comparison line. Same weekday rather than the day before,
   * for the reason given on `todayVsLastWeek`: takings swing hard by day, and
   * a Saturday against a Friday compares nothing.
   */
  daily: { date: string; total: number; prev: number }[]
  /**
   * The last five shop-weeks, oldest first, for the chart's Month view.
   *
   * Weeks rather than thirty daily points: a month of days squeezed into this
   * panel is unreadable, and a week is the unit a shop actually compares —
   * "last week was better than this one". `prev` is the week before this one,
   * which is why the query reaches back six weeks to fill the oldest.
   */
  weekly: { start: string; end: string; total: number; prev: number }[]
}

/** "14:32" on the shop's clock, for the like-for-like time-of-day cut. */
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Indian/Mauritius",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** "Sunday" — the design compares today with the same weekday last week. */
const WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Indian/Mauritius",
  weekday: "long",
})

/** Bucket key for a sale: the shop's calendar day, not UTC's. */
const SHOP_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Indian/Mauritius",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/**
 * The last `count` shop-calendar dates, oldest first.
 *
 * Anchored at UTC *noon* deliberately. Subtracting days from the instant of
 * local midnight and then reading it back with `toISOString()` lands on the
 * previous UTC day (local midnight is 20:00Z), which shifted every label a day
 * earlier than the buckets it had to match — so the chart read zero for
 * everything. Noon is far from any offset boundary, so whole-day arithmetic on
 * it always yields the intended calendar date.
 */
function recentShopDays(today: string, count: number): string[] {
  const anchor = Date.parse(`${today}T12:00:00Z`)
  return Array.from({ length: count }, (_, i) =>
    new Date(anchor - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  )
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient()
  const today = shopToday()

  // Forty-two days back: the Month view shows five weeks, the Week view the
  // last seven of them, and the comparison figure the same weekday a week ago.
  //
  // Six weeks rather than five because the chart ghosts every period against
  // the one before it. The oldest week is never drawn — it exists only to be
  // the `prev` of the second, so the first plotted week has something to be
  // compared against instead of a gap.
  const days = recentShopDays(today, 42)
  const rangeStart = days[0]
  const chartDays = days.slice(-7)
  const weekAgo = days[days.length - 8]

  const [salesResult, lowStockResult, awaitingResult] = await Promise.all([
    supabase
      .from("sales")
      .select(
        `id, sale_date, total, status,
         sale_items ( qty, line_total,
           product_variants (
             id,
             products ( name ),
             sizes ( label ),
             colours ( name, hex_code )
           ) )`,
      )
      .gte("sale_date", startOfShopDay(rangeStart))
      .lte("sale_date", endOfShopDay(today))
      .eq("status", "completed")
      // Six weeks rather than one, so the ceiling rises with it. At the
      // shop's ~21 sales a day this is roughly a 5x margin; a truncated scan
      // would understate the chart rather than fail loudly, so it is set high.
      // Raised from 6000 with the range, to keep that margin where it was.
      .limit(7200),
    supabase
      .from("low_stock_variants")
      .select("variant_id", { count: "exact", head: true }),
    // Draft purchases are goods ordered but not yet booked in. Ordered by the
    // date the supplier actually gave, with nulls last: a purchase with no
    // promised date should not jump ahead of one that has one. Migration 024
    // added the column — before it, the order date stood in, which was wrong
    // by exactly the lead time.
    supabase
      .from("purchases")
      .select("id, purchase_date, expected_date, suppliers ( name )", { count: "exact" })
      .eq("status", "draft")
      .order("expected_date", { ascending: true, nullsFirst: false })
      .order("purchase_date", { ascending: true })
      .limit(1),
  ])

  const sales = salesResult.data ?? []

  // Bucket by the shop's calendar day, not UTC — a 9pm sale belongs to today.
  // The formatter is hoisted: rebuilding it per sale is needlessly expensive
  // across five weeks of rows.
  const dayOf = (iso: string) => SHOP_DAY.format(new Date(iso))

  // The scan covers five weeks so the chart can offer a Month view, but the
  // top-sellers card says "this week" and must mean it. Membership rather than
  // a date comparison, because these are shop-calendar strings.
  const thisWeek = new Set(days.slice(-7))

  const byDay = new Map<string, number>()
  // The same buckets, but counting only what had been taken by this time of
  // day — so today-so-far can be compared with like.
  const byDayUpToNow = new Map<string, number>()
  const nowClock = CLOCK.format(new Date())
  // Keyed by variant rather than product: which *size and colour* is selling is
  // what a reorder decision turns on, and it is what makes the swatch mean
  // something. Falls back to the name when a variant row has been deleted.
  const byVariant = new Map<string, TopSeller>()
  let todayTotal = 0
  let todayCount = 0
  let todayItems = 0

  for (const sale of sales) {
    const day = dayOf(sale.sale_date)
    const total = Number(sale.total)
    byDay.set(day, (byDay.get(day) ?? 0) + total)
    // "14:32" <= "14:32" — zero-padded 24-hour, so string order is time order.
    if (CLOCK.format(new Date(sale.sale_date)) <= nowClock) {
      byDayUpToNow.set(day, (byDayUpToNow.get(day) ?? 0) + total)
    }

    const items = sale.sale_items ?? []
    if (day === today) {
      todayTotal += total
      todayCount += 1
      todayItems += items.reduce((sum, i) => sum + i.qty, 0)
    }

    if (!thisWeek.has(day)) continue

    for (const item of items) {
      const variant = item.product_variants
      const name = variant?.products?.name
      if (!name) continue

      const key = variant?.id ? String(variant.id) : `name:${name}`
      const seen = byVariant.get(key)
      if (seen) {
        seen.qty += item.qty
        seen.revenue += Number(item.line_total)
        continue
      }
      byVariant.set(key, {
        key,
        name,
        sizeLabel: variant?.sizes?.label ?? null,
        colourName: variant?.colours?.name ?? null,
        colourHex: variant?.colours?.hex_code ?? null,
        qty: item.qty,
        revenue: Number(item.line_total),
      })
    }
  }

  // Same helper as the range above, so labels and buckets cannot drift apart.
  // `days` runs oldest-first and ends today, so the day a week before
  // `chartDays[i]` is always fourteen back from the end plus i.
  const daily = chartDays.map((date, i) => ({
    date,
    total: byDay.get(date) ?? 0,
    prev: byDay.get(days[days.length - 14 + i]!) ?? 0,
  }))

  // Six buckets of seven, newest-aligned so the last one always ends today.
  const buckets = Array.from({ length: 6 }, (_, block) => {
    const slice = days.slice(block * 7, block * 7 + 7)
    return {
      start: slice[0]!,
      end: slice[slice.length - 1]!,
      total: slice.reduce((sum, date) => sum + (byDay.get(date) ?? 0), 0),
    }
  })

  // Drop the oldest and hand each surviving week the one before it. Five weeks
  // are plotted; the sixth was fetched only to fill this column.
  const weekly = buckets
    .slice(1)
    .map((week, i) => ({ ...week, prev: buckets[i]!.total }))

  const weekTotal = daily.reduce((sum, d) => sum + d.total, 0)

  const lastWeekSameDay = byDayUpToNow.get(weekAgo) ?? 0
  const todayVsLastWeek = lastWeekSameDay > 0
    ? {
        percent: Math.round(((todayTotal - lastWeekSameDay) / lastWeekSameDay) * 100),
        weekdayName: WEEKDAY.format(new Date(`${weekAgo}T12:00:00Z`)),
      }
    : null

  const nextDelivery = awaitingResult.data?.[0]

  return {
    todayTotal,
    todayCount,
    todayItems,
    weekTotal,
    todayVsLastWeek,
    lowStockCount: lowStockResult.count ?? 0,
    topSellers: [...byVariant.values()]
      // Units first, revenue as the tie-break, so two variants that sold the
      // same number are ordered by what they actually brought in.
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
      .slice(0, 5),
    awaiting: {
      count: awaitingResult.count ?? 0,
      nextSupplier: nextDelivery?.suppliers?.name ?? null,
      // The promised date where there is one; otherwise say nothing rather
      // than quote the order date as if it were a delivery date.
      nextDate: nextDelivery?.expected_date ?? null,
    },
    daily,
    weekly,
  }
}

export type SalesWeekStats = {
  takings: number
  receipts: number
  averageBasket: number
  itemsPerSale: number
  busiestDay: { weekday: string; total: number; receipts: number } | null
  /**
   * Margin on this week's sales, or null when the viewer may not see cost.
   *
   * APPROXIMATE, and deliberately so. `sale_items` records what the customer
   * paid but not what the goods cost, so this values them at the variant's
   * cost price *as it stands now*. A purchase received since the sale moves
   * that figure — `receive_purchase` writes the latest unit cost back onto the
   * variant. It is the right shape of answer for "how are we doing this week";
   * it is not an accounting figure, and a real one needs cost captured on the
   * sale line at the time of sale.
   */
  margin: { percent: number; amount: number } | null
}

/**
 * The four figures above the sales list.
 *
 * Every ticket at Kids Corner is paid at the till — there are no account
 * sales — so takings divided by receipts is a true average basket rather than
 * a figure distorted by unpaid invoices sitting in the denominator.
 */
export async function getSalesWeekStats(canSeeCost: boolean): Promise<SalesWeekStats> {
  const supabase = await createClient()
  const today = shopToday()
  const days = recentShopDays(today, 7)

  const { data, error } = await supabase
    .from("sales")
    .select(
      `sale_date, total,
       sale_items ( qty, line_total, product_variants ( cost_price ) )`,
    )
    .gte("sale_date", startOfShopDay(days[0]!))
    .lte("sale_date", endOfShopDay(today))
    .eq("status", "completed")
    .limit(4000)

  if (error) throw error
  const sales = data ?? []

  const dayOf = (iso: string) => SHOP_DAY.format(new Date(iso))
  const byDay = new Map<string, { total: number; receipts: number }>()

  let takings = 0
  let units = 0
  let cost = 0

  for (const sale of sales) {
    const total = Number(sale.total)
    takings += total

    const day = dayOf(sale.sale_date)
    const bucket = byDay.get(day) ?? { total: 0, receipts: 0 }
    bucket.total += total
    bucket.receipts += 1
    byDay.set(day, bucket)

    for (const item of sale.sale_items ?? []) {
      units += item.qty
      cost += item.qty * Number(item.product_variants?.cost_price ?? 0)
    }
  }

  const receipts = sales.length

  let busiestDay: SalesWeekStats["busiestDay"] = null
  for (const [date, bucket] of byDay) {
    if (!busiestDay || bucket.total > busiestDay.total) {
      busiestDay = {
        weekday: WEEKDAY.format(new Date(`${date}T12:00:00Z`)),
        total: bucket.total,
        receipts: bucket.receipts,
      }
    }
  }

  return {
    takings,
    receipts,
    averageBasket: receipts > 0 ? takings / receipts : 0,
    itemsPerSale: receipts > 0 ? units / receipts : 0,
    busiestDay,
    margin:
      canSeeCost && takings > 0
        ? {
            amount: takings - cost,
            percent: Math.round(((takings - cost) / takings) * 100),
          }
        : null,
  }
}
