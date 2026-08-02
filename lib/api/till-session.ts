import { NextResponse } from "next/server"

import { isRole, type Role } from "@/lib/db-enums"
import { isSupabaseConfigured } from "@/lib/env"
import { createBearerClient } from "@/lib/supabase/bearer"
import type { TillClient } from "@/lib/pos/sale-core"

/**
 * The door the Android till comes through.
 *
 * The browser authenticates with a cookie the proxy refreshes on every request.
 * A native client has no such thing, so it holds a Supabase access token and
 * sends it here. `getClaims` verifies the signature against the project's JWKS
 * rather than decoding and trusting the payload — a forged token with
 * `role: "owner"` in it has to survive that check, and it does not.
 */

export type TillSession = {
  supabase: TillClient
  user: { id: string; name: string; role: Role }
}

/** A JSON error shaped like every other reply, so the client parses one thing. */
export function apiError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status })
}

function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (!header) return null
  const [scheme, token] = header.split(" ")
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null
  return token.trim() || null
}

/**
 * Resolves the caller, or returns the response to send back.
 *
 * Every role may use the till, cashiers included, so this asserts an active
 * profile rather than a back-office role. A route that needs more than that
 * checks `session.user.role` itself.
 */
export async function requireTillSession(
  request: Request,
): Promise<TillSession | { response: NextResponse }> {
  if (!isSupabaseConfigured) {
    return { response: apiError("The server is not configured for Supabase.", 503) }
  }

  const token = bearerFrom(request)
  if (!token) {
    return { response: apiError("Sign in on this device first.", 401) }
  }

  const supabase = createBearerClient(token)

  const { data, error } = await supabase.auth.getClaims(token)
  const claims = data?.claims
  if (error || !claims?.sub) {
    // 401 rather than 403: the token is missing or stale, and the right move
    // for the till is to refresh it and try again, not to give up.
    return { response: apiError("That session has expired. Sign in again.", 401) }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", claims.sub)
    .maybeSingle()

  // An auth user with no profile row (or an unrecognised role) has no place in
  // the app — treated as signed out rather than guessing a role.
  if (!profile || !isRole(profile.role)) {
    // `sessionEnded` rather than a bare 403. The till receives 403 for two
    // different kinds of thing — this, and "that shift is not reachable" from
    // shift/close and shift/movement — and only one of them means the person
    // holding the tablet should be signed out. Blanket-treating 403 as fatal
    // would log a cashier out for a stale shift.
    return {
      response: apiError("This account has no till access.", 403, { sessionEnded: true }),
    }
  }
  if (!profile.is_active) {
    return {
      response: apiError("This account has been deactivated.", 403, { sessionEnded: true }),
    }
  }

  return {
    supabase,
    user: { id: profile.id, name: profile.full_name, role: profile.role },
  }
}
