import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { getOpenShift } from "@/lib/pos/queries"
import { readZ, readZTotals } from "@/lib/pos/shift-core"

/** Numerics arrive from PostgREST as strings; coerced at the boundary. */
type ZReportRow = {
  id: number
  z_no: string
  closed_at: string
  counted_cash: string | number
  expected_cash: string | number
  variance: string | number
  totals: unknown
}

/**
 * The Z report — live for the open shift, or a stored one by id.
 *
 * The two are genuinely different documents and the difference matters:
 *
 *   • `?shift=` (or no parameter) is an X-READ. Live figures for a drawer that
 *     is still trading, so they change every time it is asked. Useful for a
 *     mid-day check; not a fiscal record.
 *
 *   • `?z=` is a Z REPORT. Read from `z_reports.totals`, frozen at the instant
 *     the till was closed. Never recomputed — recomputing would answer with
 *     today's world, and a reprint next month would no longer match the paper
 *     in the shop's file.
 */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const params = new URL(request.url).searchParams
  const zId = Number(params.get("z"))

  if (Number.isInteger(zId) && zId > 0) {
    /**
     * `z_reports` is newer than the generated types and `supabase gen types`
     * cannot reach this project through the pooler, so the client is widened
     * for this one read.
     *
     * Cast here rather than by hand-editing database.types.ts — the same choice
     * `commitSale` makes for `complete_sale_keyed`, and for the same reason: an
     * edit to the generated file is wiped by the next successful regeneration,
     * and a cast at the call site is not.
     */
    const db = session.supabase as unknown as SupabaseClient

    const { data, error } = await db
      .from("z_reports")
      .select("id, z_no, closed_at, counted_cash, expected_cash, variance, totals")
      .eq("id", zId)
      .maybeSingle<ZReportRow>()

    if (error) return apiError(error.message, 500)
    if (!data) return apiError("That Z report was not found.", 404)

    return NextResponse.json({
      ok: true,
      kind: "z",
      zNo: data.z_no,
      closedAt: data.closed_at,
      countedCash: Number(data.counted_cash),
      expectedCash: Number(data.expected_cash),
      variance: Number(data.variance),
      totals: readZTotals(data.totals),
    })
  }

  const shiftId = Number(params.get("shift")) || (await getOpenShift(session.supabase))?.id
  if (!shiftId) {
    return NextResponse.json({ ok: true, kind: "x", totals: null })
  }

  const totals = await readZ(session.supabase, shiftId)
  if (!totals) return apiError("Could not read the till totals.", 500)

  return NextResponse.json({ ok: true, kind: "x", totals })
}
