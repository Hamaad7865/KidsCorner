import { cache } from "react"
import { redirect } from "next/navigation"

import { isRole, type Role } from "@/lib/db-enums"
import { isSupabaseConfigured } from "@/lib/env"
import { LOGIN_PATH } from "@/lib/routes"
import { createClient } from "@/lib/supabase/server"
import { readPastClockSkew } from "@/lib/supabase/timing"

import { isAdminRole } from "./roles"

/**
 * The signed-in device/user. Note this is the *Supabase* identity (owner,
 * manager, or a shared till account) — not the cashier selected by PIN on the
 * POS, which is app-level state layered on top of this session.
 */
export type SessionProfile = {
  id: string
  email: string | null
  fullName: string
  role: Role
  isActive: boolean
}

/**
 * Reads the verified session and its profile row.
 *
 * `cache()` dedupes this across a single render pass, so a layout and its pages
 * can each ask for the profile without repeating the query.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  if (!isSupabaseConfigured) return null

  const supabase = await createClient()

  // getClaims() verifies the JWT signature rather than trusting the cookie.
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub) return null

  // Retry past the post-refresh auth/db clock skew (PGRST303). Without it a
  // skew here read as "no profile" and signed the user out mid-session — the
  // error was discarded, so a transient rejection looked exactly like a missing
  // row. See lib/supabase/timing.ts.
  const { data: profile } = await readPastClockSkew(() =>
    supabase
      .from("profiles")
      .select("id, full_name, role, is_active")
      .eq("id", claims.sub)
      .maybeSingle(),
  )

  // An auth user with no profile row (or an unrecognised role) has no place in
  // the app — treat it as signed out rather than guessing a role.
  if (!profile || !isRole(profile.role)) return null

  return {
    id: profile.id,
    email: typeof claims.email === "string" ? claims.email : null,
    fullName: profile.full_name,
    role: profile.role,
    isActive: profile.is_active,
  }
})

/** For any page behind a session. Redirects to /login when there isn't one. */
export async function requireProfile(): Promise<SessionProfile> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) redirect(LOGIN_PATH)
  return profile
}

/**
 * For `(admin)` pages. The proxy already blocks cashiers, but layouts assert it
 * again so a page is never rendered on a wrong-role request that slipped past
 * the matcher. A non-admin lands on the sign-in screen, which explains why —
 * the web till they used to be sent to no longer exists.
 */
export async function requireAdminProfile(): Promise<SessionProfile> {
  const profile = await requireProfile()
  if (!isAdminRole(profile.role)) redirect(`${LOGIN_PATH}?error=till_moved`)
  return profile
}
