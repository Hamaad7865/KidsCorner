import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { recordMovementFor } from "@/lib/pos/shift-core"

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
    return NextResponse.json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid movement.",
    })
  }

  const { shiftId, amount, direction, reason } = parsed.data

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
