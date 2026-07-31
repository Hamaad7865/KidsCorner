import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import { supabaseEnv } from "@/lib/env"

import type { Database } from "./database.types"

/**
 * Supabase client for a request that authenticates with a bearer token rather
 * than a cookie — which is every request from the Android till.
 *
 * The token is forwarded on the PostgREST calls, so RLS sees the real user and
 * a native client gets exactly the same row-level treatment the browser does.
 * Nothing is persisted: this is built per request and thrown away, so one
 * till's token can never be picked up by the next request to arrive.
 */
export function createBearerClient(accessToken: string) {
  const { url, anonKey } = supabaseEnv()

  return createSupabaseClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
