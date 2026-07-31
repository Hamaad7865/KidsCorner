import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { closeShiftFor } from "@/lib/pos/shift-core"

const bodySchema = z.object({
  shiftId: z.number().int().positive(),
  countedCash: z.number(),
  notes: z.string().trim().max(500).nullish(),
})

/**
 * End of day.
 *
 * The counted cash comes from the device; the expected cash never does — it is
 * recomputed from the sales and till-movement ledgers inside `closeShiftFor`.
 * A till that could post its own "expected" figure could close a short drawer
 * as balanced.
 */
export async function POST(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid close.", 400)
  }

  const result = await closeShiftFor(session.supabase, session.user, {
    shiftId: parsed.data.shiftId,
    countedCash: parsed.data.countedCash,
    notes: parsed.data.notes?.trim() || null,
  })

  // The frozen slip travels back with the close, so the till can print it
  // immediately without a second round trip — the one moment a cashier is
  // standing at a drawer waiting, and the one moment the connection failing
  // would leave them unable to produce the day's paperwork.
  return NextResponse.json(
    result.ok ? { ok: true, ...result.value } : { ok: false, error: result.error },
  )
}
