import type { SupabaseClient } from "@supabase/supabase-js"

import { endOfShopDay, startOfShopDay } from "@/lib/format"
import { readZTotals, type ZTotals } from "@/lib/pos/shift-core"
import { createClient } from "@/lib/supabase/server"

/**
 * The frozen end-of-day slips.
 *
 * Read from `z_reports.totals`, never recomputed. A Z is the paper the shop put
 * in a file at closing time, and a report that recalculated it would answer
 * with today's world — a refund processed next week would silently restate last
 * Tuesday's takings and the reprint would no longer match the original.
 *
 * `z_reports` is newer than the generated types and `supabase gen types` cannot
 * reach this project through the pooler, so the client is widened here. Cast at
 * the call site rather than by editing database.types.ts, which the next
 * successful regeneration would overwrite.
 */

export type ZReportRow = {
  id: number
  shiftId: number
  zNo: string
  closedAt: string
  closedBy: string | null
  countedCash: number
  expectedCash: number
  variance: number
  totals: ZTotals
  /**
   * Money in the shift that the frozen slip does not account for.
   *
   * Should be 0.00 on every row. Anything else means sales landed after the Z
   * was frozen — almost always a till closed while its offline queue still had
   * something in it. See migration 015.
   */
  unreported: number
  lateCount: number
}

type RawZ = {
  id: number
  shift_id: number
  z_no: string
  closed_at: string
  counted_cash: string | number
  expected_cash: string | number
  variance: string | number
  totals: unknown
  closer?: { full_name: string } | null
}

type RawVariance = {
  shift_id: number
  unreported: string | number
  late_count: number
}

const num = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function listZReports(
  from: string,
  to: string,
): Promise<ZReportRow[]> {
  const supabase = (await createClient()) as unknown as SupabaseClient

  const { data, error } = await supabase
    .from("z_reports")
    .select(
      `id, shift_id, z_no, closed_at, counted_cash, expected_cash, variance, totals,
       closer:profiles!z_reports_closed_by_fkey ( full_name )`,
    )
    .gte("closed_at", startOfShopDay(from))
    .lte("closed_at", endOfShopDay(to))
    .order("closed_at", { ascending: false })
    .limit(400)
    .returns<RawZ[]>()

  if (error) return []

  // Fetched separately rather than joined: `shift_z_variance` is a view over
  // the same rows, and PostgREST cannot embed a view that has no foreign key
  // back to the table.
  const { data: variances } = await supabase
    .from("shift_z_variance")
    .select("shift_id, unreported, late_count")
    .in("shift_id", (data ?? []).map((z) => z.shift_id))
    .returns<RawVariance[]>()

  const byShift = new Map(
    (variances ?? []).map((v) => [
      v.shift_id,
      { unreported: num(v.unreported), lateCount: v.late_count },
    ]),
  )

  return (data ?? []).map((row) => ({
    id: row.id,
    shiftId: row.shift_id,
    zNo: row.z_no,
    closedAt: row.closed_at,
    closedBy: row.closer?.full_name ?? null,
    countedCash: num(row.counted_cash),
    expectedCash: num(row.expected_cash),
    variance: num(row.variance),
    totals: readZTotals(row.totals),
    unreported: byShift.get(row.shift_id)?.unreported ?? 0,
    lateCount: byShift.get(row.shift_id)?.lateCount ?? 0,
  }))
}

/** One slip, for the detail view and the reprint. */
export async function getZReport(id: number): Promise<ZReportRow | null> {
  const supabase = (await createClient()) as unknown as SupabaseClient

  const { data, error } = await supabase
    .from("z_reports")
    .select(
      `id, shift_id, z_no, closed_at, counted_cash, expected_cash, variance, totals,
       closer:profiles!z_reports_closed_by_fkey ( full_name )`,
    )
    .eq("id", id)
    .maybeSingle<RawZ>()

  if (error || !data) return null

  const { data: variance } = await supabase
    .from("shift_z_variance")
    .select("shift_id, unreported, late_count")
    .eq("shift_id", data.shift_id)
    .maybeSingle<RawVariance>()

  return {
    id: data.id,
    shiftId: data.shift_id,
    zNo: data.z_no,
    closedAt: data.closed_at,
    closedBy: data.closer?.full_name ?? null,
    countedCash: num(data.counted_cash),
    expectedCash: num(data.expected_cash),
    variance: num(data.variance),
    totals: readZTotals(data.totals),
    unreported: num(variance?.unreported),
    lateCount: variance?.late_count ?? 0,
  }
}
