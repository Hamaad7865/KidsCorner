import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { assertShiftReachable, recordMovementFor } from "@/lib/pos/shift-core"

/**
 * A positive figure plus a direction, never a signed amount.
 *
 * Asking someone at a till to type a minus sign to take money out is how a
 * pay-out gets recorded as a pay-in, and the drawer then reconciles wrong by
 * twice the amount. The sign is applied here from `direction`.
 */
const bodySchema = z.object({
  shiftId: z.number().int().positive(),
  amount: z.number().positive("Enter an amount."),
  direction: z.enum(["in", "out"]),
  reason: z.string(),
  /** Which till is asking, so a drawer can only be reached from its own. */
  deviceId: z.number().int().positive().nullish(),
})

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
    // 400 rather than a bare ok:false: a schema failure is a client bug, not
    // a counter outcome the cashier has to read off the screen.
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid movement.",
      },
      { status: 400 },
    )
  }

  const { shiftId, amount, direction, reason } = parsed.data

  // A till may only reach its own drawer. Without this a cashier's token
  // could post another device's shift id and take cash out of a drawer they
  // are not standing at — the very act the back office confines to a manager.
  const reachable = await assertShiftReachable(
    session.supabase,
    parsed.data.shiftId,
    parsed.data.deviceId ?? null,
    session.user.role,
  )
  if (!reachable.ok) return apiError(reachable.error, 403)

  const result = await recordMovementFor(
    session.supabase,
    shiftId,
    direction === "in" ? amount : -amount,
    reason,
  )

  return NextResponse.json(
    result.ok ? { ok: true } : { ok: false, error: result.error },
  )
}
