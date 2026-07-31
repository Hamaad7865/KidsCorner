import { cache } from "react"
import { redirect } from "next/navigation"

import { isRole, type Role } from "@/lib/db-enums"
import { isSupabaseConfigured } from "@/lib/env"
import { LOGIN_PATH, POS_PATH } from "@/lib/routes"
import { createClient } from "@/lib/supabase/server"

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .eq("id", claims.sub)
    .maybeSingle()

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
 * the matcher.
 */
export async function requireAdminProfile(): Promise<SessionProfile> {
  const profile = await requireProfile()
  if (!isAdminRole(profile.role)) redirect(POS_PATH)
  return profile
}
