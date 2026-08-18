import { createClient } from "@/lib/supabase/server"

/**
 * The wide per-day report, straight from the `daily_summary` RPC.
 *
 * KIDS CORNER PRICES INCLUDE VAT. So on every row:
 *
 *     totalIncl = what customers paid
 *     totalExcl = totalIncl - vat   (what is left inside it)
 *
 * Two views of one number, never two numbers to add. The Carfectionist report
 * this is modelled on carries the same pair of columns but builds them from a
 * VAT-exclusive base; reading one for the other here would overstate the shop's
 * turnover by the VAT rate.
 */

export type DailySummaryRow = {
  day: string
  tickets: number
  items: number
  /** Customers who gave a name. A walk-in is not counted. */
  customers: number
  totalIncl: number
  vat: number
  totalExcl: number
  avgIncl: number
  avgExcl: number
  byMethod: Record<string, { n: number; amount: number }>
  byTax: Record<string, { incl: number; excl: number; vat: number }>
  bySeller: Record<string, { n: number; amount: number }>
  byCategory: Record<string, { qty: number; amount: number }>
}

export type DailySummary = {
  from: string
  to: string
  rows: DailySummaryRow[]
  /** The column headers that actually traded in the period. */
  methods: string[]
  /** Frozen enabled VAT rates only; disabled turnover has no synthetic band. */
  taxes: string[]
  sellers: string[]
  categories: string[]
}

const num = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []

function pairs<T>(
  value: unknown,
  read: (raw: Record<string, unknown>) => T,
): Record<string, T> {
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, raw]) => [
      key,
      read((raw ?? {}) as Record<string, unknown>),
    ]),
  )
}

export async function getDailySummary(
  from: string,
  to: string,
): Promise<DailySummary> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc(
    "daily_summary" as never,
    { p_from: from, p_to: to } as never,
  )

  // The RPC raises on a backwards or over-long range. Surfaced as an empty
  // report rather than a crash: the range comes from the URL, so a bad one is a
  // mistyped link, not a broken system.
  if (error) return { from, to, rows: [], methods: [], taxes: [], sellers: [], categories: [] }

  const s = (data ?? {}) as Record<string, unknown>
  const rawRows = Array.isArray(s.rows) ? (s.rows as Record<string, unknown>[]) : []

  return {
    from,
    to,
    methods: strings(s.methods),
    taxes: strings(s.taxes),
    sellers: strings(s.sellers),
    categories: strings(s.categories),
    rows: rawRows.map((r) => ({
      day: String(r.day ?? ""),
      tickets: num(r.tickets),
      items: num(r.items),
      customers: num(r.customers),
      totalIncl: num(r.total_incl),
      vat: num(r.vat),
      totalExcl: num(r.total_excl),
      avgIncl: num(r.avg_incl),
      avgExcl: num(r.avg_excl),
      byMethod: pairs(r.by_method, (v) => ({ n: num(v.n), amount: num(v.amount) })),
      byTax: pairs(r.by_tax, (v) => ({
        incl: num(v.incl),
        excl: num(v.excl),
        vat: num(v.vat),
      })),
      bySeller: pairs(r.by_seller, (v) => ({ n: num(v.n), amount: num(v.amount) })),
      byCategory: pairs(r.by_category, (v) => ({ qty: num(v.qty), amount: num(v.amount) })),
    })),
  }
}
