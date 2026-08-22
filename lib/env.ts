import { z } from "zod"

/**
 * Supabase connection details.
 *
 * `NEXT_PUBLIC_*` variables are inlined at build time by Next, so they must be
 * referenced as whole literal expressions — never `process.env[someKey]`.
 *
 * The app is deliberately tolerant of a missing configuration: rather than
 * crashing the dev server, `isSupabaseConfigured` stays false, the proxy stops
 * enforcing auth, and the login page explains what to fill in. That keeps
 * `npm run dev` useful before `.env.local` has real credentials.
 */

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
// New Supabase projects hand out a "publishable" key; older ones an "anon" key.
// Both are the same public, RLS-guarded client key, so accept either.
const rawKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

/**
 * The service-role key. SERVER-ONLY: it bypasses RLS entirely, which is exactly
 * why it must never wear a NEXT_PUBLIC_ prefix — a public one would ship in the
 * browser bundle and hand the whole database to anyone who opened devtools.
 *
 * It exists for precisely one job: `auth.admin` calls. Creating a staff login
 * means creating a row in Supabase Auth itself, and no cookie session can do
 * that — the admin API answers only to the service role. Everything the shop's
 * data cares about still goes through RLS-guarded clients; this key never
 * touches a table read.
 */
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/** True when admin operations (creating staff logins) are available. */
export const isServiceRoleConfigured =
  typeof rawServiceKey === "string" && rawServiceKey.length >= 20

/** The service-role key. Call only behind `isServiceRoleConfigured`. */
export function serviceRoleKey(): string {
  if (!isServiceRoleConfigured || typeof rawServiceKey !== "string") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (or the Worker's secrets) to create staff logins.",
    )
  }
  return rawServiceKey
}

const supabaseEnvSchema = z.object({
  url: z.url("NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. https://abcdefgh.supabase.co"),
  anonKey: z
    .string()
    .min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY looks too short to be a real key"),
})

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>

const parsed = supabaseEnvSchema.safeParse({
  url: rawUrl ?? "",
  anonKey: rawKey ?? "",
})

export const isSupabaseConfigured = parsed.success

/** Human-readable reason the configuration is incomplete, or null when it's fine. */
export const supabaseEnvError: string | null = parsed.success
  ? null
  : !rawUrl && !rawKey
    ? "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not set."
    : parsed.error.issues.map((issue) => issue.message).join(" ")

/** Throws if Supabase is unconfigured — call only behind `isSupabaseConfigured`. */
export function supabaseEnv(): SupabaseEnv {
  if (!parsed.success) {
    throw new Error(
      `Supabase is not configured. ${supabaseEnvError} Add the values to .env.local and restart the dev server.`,
    )
  }
  return parsed.data
}
