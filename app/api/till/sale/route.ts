import { NextResponse } from "next/server"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { commitSale, completeSaleSchema } from "@/lib/pos/sale-core"

/**
 * The Android till's one write.
 *
 * Note what is *not* here: no pricing, no discount arithmetic, no manager
 * check. All of it is in `commitSale`, which the web till reaches through a
 * server action and this reaches through HTTP. That is the point — the native
 * app posts variant ids and quantities, and the server decides what they cost.
 *
 * The alternative, letting the app call Supabase directly, was available and is
 * what the Supabase Kotlin SDK invites. It was not taken because
 * `complete_sale_keyed` accepts `unit_price` per line and trusts it: a till
 * talking straight to PostgREST could ring up anything at zero.
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

  const parsed = completeSaleSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid sale.", 400)
  }

  const result = await commitSale(session.supabase, session.user, parsed.data, {
    role: session.user.role,
    // The registry id this device was given at bootstrap; null from an older
    // build, which the gate treats as "cannot say which till" and skips only
    // the ownership half.
    deviceId: parsed.data.deviceId ?? null,
  })

  // Always 200. Every failure here is one the cashier has to act on — a manager
  // is needed, an item is out of stock, the payment is short — and the till
  // renders each differently. An HTTP status would flatten them into "request
  // failed" and, worse, invite a blind retry of a sale that may have committed.
  return NextResponse.json(result)
}
