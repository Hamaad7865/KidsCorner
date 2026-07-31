import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"

import { supabaseEnv } from "@/lib/env"

import type { Database } from "./database.types"

/**
 * Supabase client for server components, route handlers and server actions.
 *
 * A fresh client per request — never module-level, or one request's session
 * would leak into another's.
 */
export async function createClient() {
  const cookieStore = await cookies()
  const { url, anonKey } = supabaseEnv()

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components are not allowed to write cookies. That is fine:
          // middleware.ts calls getClaims() on every request, so refreshed tokens
          // are persisted there instead. Swallowing this is the documented
          // @supabase/ssr pattern, not a silenced bug.
        }
      },
    },
  })
}
