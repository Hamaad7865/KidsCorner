import type { SupabaseClient } from "@supabase/supabase-js"

import { endOfShopDay, startOfShopDay } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * Back-office reporting over a date range.
 *
 * Shaped after the Carfectionist report module — a date range, a report picker,
 * CSV export per report — with its list adapted for retail: "revenue by
 * technician" becomes "by cashier", and receivables/customer statements are
 * dropped because Kids Corner has no credit sales to age.
 *
 * Every query is bounded by the range and an explicit limit. All dates are shop
 * calendar days converted to instants, so a 9pm sale counts on the day it was
 * rung up rather than the next UTC one.
 */

const ROW_CAP = 5000

export type SalesSummary = {
  saleCount: number
  grossTotal: number
  discountTotal: number
  vatTotal: number
  itemCount: number
  refundTotal: number
  refundCount: number
  netTotal: number
  averageBasket: number
  byMethod: { method: string; amount: number }[]
  byCashier: { name: string; saleCount: number; total: number }[]
  byDay: { date: string; total: number; saleCount: number }[]
}

const SHOP_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Indian/Mauritius",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export async function getSalesSummary(
  from: string,
  to: string,
): Promise<SalesSummary> {
  const supabase = await createClient()

  const [salesResult, creditResult] = await Promise.all([
    supabase
      .from("sales")
      .select(
        `id, sale_date, total, discount, vat_amount, status,
         profiles ( full_name ),
         sale_items ( qty ),
         sale_payments ( method, amount )`,
      )
      .gte("sale_date", startOfShopDay(from))
      .lte("sale_date", endOfShopDay(to))
      // Refunded sales still happened: excluding them would understate the day
      // and make the payment breakdown disagree with the drawer.
      .in("status", ["completed", "refunded"])
      .limit(ROW_CAP),
    supabase
      .from("credit_notes")
      .select("id, total, created_at")
      .gte("created_at", startOfShopDay(from))
      .lte("created_at", endOfShopDay(to))
      .limit(ROW_CAP),
  ])

  if (salesResult.error) throw salesResult.error

  const sales = salesResult.data ?? []
  const credits = creditResult.data ?? []

  const methods = new Map<string, number>()
  const cashiers = new Map<string, { saleCount: number; total: number }>()
  const days = new Map<string, { total: number; saleCount: number }>()

  let gross = 0
  let discount = 0
  let vat = 0
  let items = 0

  for (const sale of sales) {
    const total = Number(sale.total)
    gross += total
    discount += Number(sale.discount)
    // Frozen per sale, never re-derived — the rate in force at the time.
    vat += Number(sale.vat_amount)
    items += (sale.sale_items ?? []).reduce((sum, i) => sum + i.qty, 0)

    for (const p of sale.sale_payments ?? []) {
      methods.set(p.method, (methods.get(p.method) ?? 0) + Number(p.amount))
    }

    const who = sale.profiles?.full_name ?? "Unknown"
    const c = cashiers.get(who) ?? { saleCount: 0, total: 0 }
    cashiers.set(who, { saleCount: c.saleCount + 1, total: c.total + total })

    const day = SHOP_DAY.format(new Date(sale.sale_date))
    const d = days.get(day) ?? { total: 0, saleCount: 0 }
    days.set(day, { total: d.total + total, saleCount: d.saleCount + 1 })
  }

  const refundTotal = credits.reduce((sum, c) => sum + Number(c.total), 0)

  return {
    saleCount: sales.length,
    grossTotal: gross,
    discountTotal: discount,
    vatTotal: vat,
    itemCount: items,
    refundTotal,
    refundCount: credits.length,
    netTotal: gross - refundTotal,
    averageBasket: sales.length > 0 ? gross / sales.length : 0,
    byMethod: [...methods.entries()]
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    byCashier: [...cashiers.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total),
    byDay: [...days.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }
}

export type BestSeller = {
  productName: string
  variant: string
  qty: number
  revenue: number
}

export async function getBestSellers(
  from: string,
  to: string,
  limit = 25,
): Promise<BestSeller[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("sale_items")
    .select(
      `qty, line_total,
       sales!inner ( sale_date, status ),
       product_variants ( products ( name ), sizes ( label ), colours ( name ) )`,
    )
    .gte("sales.sale_date", startOfShopDay(from))
    .lte("sales.sale_date", endOfShopDay(to))
    .eq("sales.status", "completed")
    .limit(ROW_CAP)

  if (error) throw error

  const tally = new Map<string, BestSeller>()
  for (const row of data ?? []) {
    const v = row.product_variants
    const productName = v?.products?.name ?? "Unknown"
    const variant = [v?.sizes?.label, v?.colours?.name].filter(Boolean).join(" / ")
    const key = `${productName}|${variant}`
    const existing = tally.get(key) ?? { productName, variant, qty: 0, revenue: 0 }
    existing.qty += row.qty
    existing.revenue += Number(row.line_total)
    tally.set(key, existing)
  }

  return [...tally.values()].sort((a, b) => b.qty - a.qty).slice(0, limit)
}

export type ShiftReport = {
  id: number
  openedAt: string
  closedAt: string | null
  openedBy: string | null
  closedBy: string | null
  openingFloat: number
  expectedCash: number | null
  countedCash: number | null
  variance: number | null
  notes: string | null
  /**
   * The frozen slip, where one exists.
   *
   * Null for every shift closed before migration 013 added Z reports. Shown as
   * an absence rather than reconstructed: `z_totals` could rebuild what the
   * slip would have said, but no paper ever came out of a printer for those
   * shifts, and presenting a reconstruction as a fiscal document would be worse
   * than a visible gap.
   */
  zNo: string | null
  zId: number | null
  /**
   * Money in the shift the frozen slip does not account for. 0 on a healthy
   * close; anything else means sales landed after the Z was frozen.
   */
  unreported: number
  lateCount: number
}

/** Closed shifts in the range — the Z-report list. */
export async function getShiftReports(
  from: string,
  to: string,
): Promise<ShiftReport[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("shifts")
    .select(
      `id, opened_at, closed_at, opening_float, expected_cash, counted_cash,
       variance, notes,
       opener:profiles!shifts_opened_by_fkey ( full_name ),
       closer:profiles!shifts_closed_by_fkey ( full_name )`,
    )
    .gte("opened_at", startOfShopDay(from))
    .lte("opened_at", endOfShopDay(to))
    .order("opened_at", { ascending: false })
    .limit(500)

  if (error) throw error

  const shiftIds = (data ?? []).map((row) => row.id)

  // Fetched separately rather than embedded. `shift_z_variance` is a view with
  // no foreign key back to `shifts`, and PostgREST cannot embed one without a
  // relationship to follow.
  const zByShift = new Map<
    number,
    { zNo: string; zId: number; unreported: number; lateCount: number }
  >()

  if (shiftIds.length > 0) {
    const loose = supabase as unknown as SupabaseClient
    const { data: zs } = await loose
      .from("z_reports")
      .select("id, shift_id, z_no")
      .in("shift_id", shiftIds)
      .returns<{ id: number; shift_id: number; z_no: string }[]>()

    const { data: variances } = await loose
      .from("shift_z_variance")
      .select("shift_id, unreported, late_count")
      .in("shift_id", shiftIds)
      .returns<{ shift_id: number; unreported: string | number; late_count: number }[]>()

    const varByShift = new Map(
      (variances ?? []).map((v) => [v.shift_id, v]),
    )

    for (const z of zs ?? []) {
      const v = varByShift.get(z.shift_id)
      zByShift.set(z.shift_id, {
        zNo: z.z_no,
        zId: z.id,
        unreported: Number(v?.unreported ?? 0),
        lateCount: v?.late_count ?? 0,
      })
    }
  }

  return (data ?? []).map((row) => {
    const z = zByShift.get(row.id)
    return {
      id: row.id,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      openedBy: row.opener?.full_name ?? null,
      closedBy: row.closer?.full_name ?? null,
      openingFloat: Number(row.opening_float),
      expectedCash: row.expected_cash === null ? null : Number(row.expected_cash),
      countedCash: row.counted_cash === null ? null : Number(row.counted_cash),
      variance: row.variance === null ? null : Number(row.variance),
      notes: row.notes,
      zNo: z?.zNo ?? null,
      zId: z?.zId ?? null,
      unreported: z?.unreported ?? 0,
      lateCount: z?.lateCount ?? 0,
    }
  })
}

/**
 * Gross margin over the range.
 *
 * Honest caveat, stated here because it changes how the number should be read:
 * `sale_items` records what was charged but not what the item cost at the time,
 * so cost is taken from the variant's CURRENT `cost_price`. If a supplier price
 * has changed since, historical margin shifts with it. Storing cost-at-sale
 * would need a column on `sale_items`, which means touching 001.
 */
export type MarginRow = {
  productName: string
  qty: number
  revenue: number
  cost: number
  margin: number
  marginPct: number
}

export async function getMarginReport(
  from: string,
  to: string,
  limit = 50,
): Promise<MarginRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("sale_items")
    .select(
      `qty, line_total,
       sales!inner ( sale_date, status ),
       product_variants ( cost_price, products ( name ) )`,
    )
    .gte("sales.sale_date", startOfShopDay(from))
    .lte("sales.sale_date", endOfShopDay(to))
    .eq("sales.status", "completed")
    .limit(ROW_CAP)

  if (error) throw error

  const tally = new Map<string, MarginRow>()
  for (const row of data ?? []) {
    const name = row.product_variants?.products?.name ?? "Unknown"
    const cost = Number(row.product_variants?.cost_price ?? 0) * row.qty
    const revenue = Number(row.line_total)
    const existing =
      tally.get(name) ??
      { productName: name, qty: 0, revenue: 0, cost: 0, margin: 0, marginPct: 0 }
    existing.qty += row.qty
    existing.revenue += revenue
    existing.cost += cost
    tally.set(name, existing)
  }

  return [...tally.values()]
    .map((r) => ({
      ...r,
      margin: r.revenue - r.cost,
      marginPct: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0,
    }))
    .sort((a, b) => b.margin - a.margin)
    .slice(0, limit)
}
