import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import { serviceRoleKey, supabaseEnv } from "@/lib/env"

/**
 * The one client that talks to Supabase Auth's admin API.
 *
 * Every other client in this app carries a user's cookie or a till's bearer
 * token and sees exactly what RLS lets them see. This one carries the
 * service-role key and sees everything — which is why it exists in exactly one
 * shape: server-side, no session persistence, created per call, and only for
 * operations no user could be allowed to do (creating an auth user so a new
 * staff member can sign in). Table reads and writes stay on the ordinary
 * clients, where RLS keeps its job.
 */
export function createAdminClient() {
  const env = supabaseEnv()
  return createSupabaseClient(env.url, serviceRoleKey(), {
    auth: {
      // A server process has no browser to persist a session in, and the key
      // itself is the credential — there is nothing to refresh.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
