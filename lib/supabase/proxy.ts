import { createServerClient } from "@supabase/ssr"
import type { NextRequest, NextResponse } from "next/server"

import { supabaseEnv } from "@/lib/env"

import type { Database } from "./database.types"

/**
 * Supabase client for `middleware.ts`.
 *
 * The file is named `proxy` because Next 16 renamed the convention to that —
 * but the app is on `middleware.ts`, not `proxy.ts`, and deliberately: Next 16
 * runs a `proxy.ts` on the Node runtime, and the Cloudflare adapter only
 * accepts edge middleware. See the note at the top of middleware.ts.
 *
 * Token refreshes have to be written back to the browser, and the proxy is the
 * only place in a Next app that can reliably do that. Refreshed cookies are
 * buffered here and replayed onto whatever response the proxy ends up
 * returning — a pass-through *or* a redirect — via `applySession`. Forgetting
 * to apply them to redirects is the classic cause of "random logouts".
 */
export function createProxyClient(request: NextRequest) {
  const { url, anonKey } = supabaseEnv()

  const pendingCookies: { name: string; value: string; options: Record<string, unknown> }[] = []
  const pendingHeaders: Record<string, string> = {}

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          // Update the inbound request too, so the refreshed token is what the
          // downstream route handler sees on this same request.
          request.cookies.set(name, value)
          pendingCookies.push({ name, value, options: options as Record<string, unknown> })
        }
        // Auth responses must never be cached by a CDN or reverse proxy, or one
        // user's session token can be served to another.
        Object.assign(pendingHeaders, headers)
      },
    },
  })

  function applySession<T extends NextResponse>(response: T): T {
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options)
    }
    for (const [key, value] of Object.entries(pendingHeaders)) {
      response.headers.set(key, value)
    }
    return response
  }

  return { supabase, applySession }
}
