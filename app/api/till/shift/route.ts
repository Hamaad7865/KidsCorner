import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { getOpenShift, getShiftTotals } from "@/lib/pos/queries"
import { openShiftFor } from "@/lib/pos/shift-core"

/** The open shift and what it has taken, for the close screen and the X-read. */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const shift = await getOpenShift(session.supabase)
  if (!shift) return NextResponse.json({ ok: true, shift: null, totals: null })

  return NextResponse.json({
    ok: true,
    shift,
    totals: await getShiftTotals(shift.id, session.supabase),
  })
}

const openSchema = z.object({ openingFloat: z.number() })

/**
 * Opens the drawer for the day.
 *
 * The float is what the cashier physically counted into the till, so it is the
 * baseline every later figure is measured against — get it wrong and the whole
 * shift reconciles wrong.
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

  const parsed = openSchema.safeParse(body)
  if (!parsed.success) return apiError("Enter the opening float.", 400)

  const result = await openShiftFor(session.supabase, session.user, parsed.data.openingFloat)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error })

  const shift = await getOpenShift(session.supabase)
  return NextResponse.json({ ok: true, shift })
}
