import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { authenticateCashier, pinLockSeconds } from "@/lib/pos/sale-core"

const bodySchema = z.object({
  profileId: z.uuid(),
  pin: z.string(),
  /** The till's registry id from bootstrap, so the sign-in lands on the right
   *  device in the audit trail. Optional: an old APK simply doesn't send it. */
  deviceId: z.number().int().positive().optional(),
})

/**
 * The till's lock screen.
 *
 * The PIN is checked here and never on the device. That is the whole reason
 * this endpoint exists: `profiles.pin_code` is a PBKDF2 hash of four digits, so
 * anything holding it can exhaust all 10,000 values in well under a second. The
 * device is given a yes or no, and migration 010's counter — which lives in the
 * database, where reinstalling the app cannot reset it — makes guessing at this
 * endpoint cost real time.
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
    return apiError("A staff member and a 4-digit PIN are required.", 400)
  }

  const result = await authenticateCashier(
    session.supabase,
    parsed.data.profileId,
    parsed.data.pin,
    parsed.data.deviceId ?? null,
  )

  if (!result.ok) {
    // 200 with ok:false, not 4xx. A wrong PIN is an ordinary outcome of the
    // lock screen, and the till has to render the message and the remaining
    // wait — not treat it as a transport failure and retry.
    return NextResponse.json({
      ok: false,
      error: result.error,
      lockedFor: result.lockedFor ?? 0,
    })
  }

  return NextResponse.json({ ok: true, cashier: result.cashier })
}

/** How long a given cashier still has to wait, so the keypad can stay disabled. */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const profileId = new URL(request.url).searchParams.get("profileId")
  if (!profileId) return apiError("Which staff member?", 400)

  return NextResponse.json({
    ok: true,
    lockedFor: await pinLockSeconds(session.supabase, profileId),
  })
}
