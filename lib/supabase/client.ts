import { createBrowserClient } from "@supabase/ssr"

import { supabaseEnv } from "@/lib/env"

import type { Database } from "./database.types"

/**
 * Supabase client for client components — the POS sell screen and any
 * interactive island in the back office.
 *
 * `createBrowserClient` memoises internally, so calling this per component is
 * cheap and returns the same underlying client.
 */
export function createClient() {
  const { url, anonKey } = supabaseEnv()
  return createBrowserClient<Database>(url, anonKey)
}
