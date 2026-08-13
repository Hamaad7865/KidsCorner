import { NextResponse, type NextRequest } from "next/server"

import { moduleForPath } from "@/lib/access/modules"
import { isAdminRole } from "@/lib/auth/roles"
import { isRole } from "@/lib/db-enums"
import { isSupabaseConfigured } from "@/lib/env"
import {
  ADMIN_HOME_PATH,
  LOGIN_PATH,
  isAdminPath,
  isPublicPath,
  isTillApiPath,
  landingPathForRole,
  safeRedirectPath,
} from "@/lib/routes"
import { createProxyClient } from "@/lib/supabase/proxy"
import { readPastClockSkew } from "@/lib/supabase/timing"

/**
 * Role-based routing, per the spec's Auth model.
 *
 * WHY THIS IS `middleware.ts` AND NOT `proxy.ts`
 *
 * Next 16 renamed the convention to `proxy` and runs it on the Node runtime.
 * The Cloudflare adapter refuses that — "Node.js middleware is not currently
 * supported" — because it looks for an edge entry in the middleware manifest
 * and a proxy compiles to a Node function instead. Next also refuses to put a
 * `proxy.ts` on the edge runtime, so the two cannot be reconciled under the new
 * name. The deprecated `middleware.ts` convention still accepts
 * `runtime: "experimental-edge"`, which is what the adapter needs.
 *
 * The deprecation warning on every build is the cost of deploying to Workers.
 * When the adapter supports Node middleware this can move back to `proxy.ts`
 * and the runtime line can go.
 *
 *   - no session            -> /login (remembering where they were headed)
 *   - `(pos)` routes        -> every role, including cashiers
 *   - `(admin)` routes      -> owner and manager only
 *   - `/` and `/login`      -> bounced to the role's landing page
 *
 * This file used to be called `middleware.ts`. Next 16 renamed the convention
 * to `proxy.ts` and deprecated the old name; the exported function must be
 * called `proxy`, and it always runs on the Node.js runtime (so no `runtime`
 * segment config is allowed here).
 *
 * This is a routing convenience, not the security boundary. RLS in migration
 * 001 is what actually protects the data, and each layout re-checks the role
 * before rendering.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // The Android till's API authenticates itself, per request, from an
  // Authorization header. Everything below this line is about cookies, so it
  // would find no session and answer a redirect to /login — which a native
  // client receives as an HTML page where it expected JSON. Handed straight
  // through instead; `requireTillSession` is the check that matters, and it
  // rejects an absent or forged token with a 401 the till can act on.
  if (isTillApiPath(pathname)) {
    return NextResponse.next()
  }

  // Without credentials there is no session to reason about. Let everything
  // through so `npm run dev` still renders and the login page can explain what
  // is missing, rather than redirect-looping on a broken client.
  if (!isSupabaseConfigured) {
    return NextResponse.next()
  }

  const { supabase, applySession } = createProxyClient(request)

  // Declared before the try so the catch below can reach it: every exit from
  // this function must flush buffered session cookies, including the error path.
  const proceed = () => applySession(NextResponse.next({ request }))

  const redirectTo = (destination: string, searchParams?: Record<string, string>) => {
    // `destination` can carry a query string — `next` is built below as
    // `${pathname}${search}`. Assigning that straight to `url.pathname` would
    // percent-encode the "?" into the path ("/products%3Fpage=2") and 404, so
    // parse it first. Resolving against the request origin also re-anchors any
    // off-site value, making this a second line of defence after
    // safeRedirectPath.
    const target = new URL(destination, request.nextUrl.origin)
    const url = request.nextUrl.clone()
    url.pathname = target.pathname
    url.search = target.search
    // Applied after url.search, so these win over the destination's own query.
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      url.searchParams.set(key, value)
    }
    return applySession(NextResponse.redirect(url))
  }

  // Must run before any response is generated: this is where a refreshed token
  // gets written back to the browser.
  let userId: string | null
  try {
    const { data, error } = await supabase.auth.getClaims()
    if (error) {
      // getClaims() converts every AuthError into a return value instead of
      // throwing, so this branch — not the catch — is where a Supabase outage
      // or network blip surfaces. Unlogged it is indistinguishable from
      // "nobody is signed in". The bounce to /login is still the right
      // outcome: it preserves ?next=, keeps the auth cookies, and
      // requireProfile() would land the user in the same place anyway.
      console.error("[proxy] getClaims failed:", error)
    }
    userId = data?.claims?.sub ?? null
  } catch (error) {
    // Only non-AuthError throws reach here — a WebCrypto DOMException on a
    // malformed JWK, a SyntaxError on a corrupted token cookie. Go through
    // proceed() rather than a bare NextResponse.next(): getClaims() loads the
    // session before it verifies, so a rotation may already be buffered, and
    // dropping it is the classic cause of random logouts.
    console.error("[proxy] could not resolve session:", error)
    return proceed()
  }

  if (!userId) {
    if (isPublicPath(pathname)) return proceed()
    const next = `${pathname}${search}`
    return redirectTo(LOGIN_PATH, next === "/" ? undefined : { next })
  }

  // Role lives in `profiles`, not in the JWT, so it costs one query per request.
  // Fine at shop scale; if it ever matters, move `role` into a custom claim via
  // a Supabase auth hook and read it straight off `data.claims`.
  let profile: { role: string; is_active: boolean } | null
  try {
    // Retry past the sub-second auth/db clock skew that follows a token
    // refresh — without it this read failed with PGRST303 and the guard below
    // fell open for that request. See lib/supabase/timing.ts.
    const result = await readPastClockSkew(() =>
      supabase
        .from("profiles")
        .select("role, is_active")
        .eq("id", userId)
        .maybeSingle(),
    )
    if (result.error) throw result.error
    profile = result.data
  } catch (error) {
    console.error("[proxy] could not read profile:", error)
    return proceed()
  }

  // Signed in, but not usable staff. Send them to /login, which explains why and
  // offers a way out — and let /login itself render so there is no loop.
  if (!profile || !isRole(profile.role)) {
    return isPublicPath(pathname)
      ? proceed()
      : redirectTo(LOGIN_PATH, { error: "no_profile" })
  }

  if (!profile.is_active) {
    return isPublicPath(pathname)
      ? proceed()
      : redirectTo(LOGIN_PATH, { error: "inactive" })
  }

  // The till runs on the tablet; the web app is back office only. A cashier has
  // no page here, so send any cashier session to the sign-in screen with a note
  // rather than a dead redirect. On the (public) login page they pass through,
  // where it shows the notice and a way out — so there is no loop.
  if (profile.role === "cashier") {
    return isPublicPath(pathname)
      ? proceed()
      : redirectTo(LOGIN_PATH, { error: "till_moved" })
  }

  const home = landingPathForRole(profile.role)

  if (isPublicPath(pathname)) {
    const next = safeRedirectPath(request.nextUrl.searchParams.get("next"))
    return redirectTo(next ?? home)
  }

  if (pathname === "/") {
    return redirectTo(home)
  }

  // Defensive: cashiers are already intercepted above and only owner/manager
  // reach here, so this never fires — but it keeps the admin gate honest if a
  // fourth role is ever added.
  if (isAdminPath(pathname) && !isAdminRole(profile.role)) {
    return redirectTo(LOGIN_PATH, { error: "forbidden" })
  }

  // Module visibility, applied AFTER the role rule above so it can only ever
  // restrict further — granting a module here can never let a cashier into the
  // back office. RLS remains the actual boundary; this stops a hidden page
  // being reached by typing its URL.
  const moduleKey = moduleForPath(pathname)
  if (moduleKey && moduleKey !== "pos") {
    const { data: access } = await supabase
      .from("module_access")
      .select("can_view")
      .eq("role", profile.role)
      .eq("module", moduleKey)
      .maybeSingle()

    // Only an explicit `false` blocks. A missing row, or a database that has
    // not had migration 006 applied, leaves behaviour exactly as it was.
    if (access?.can_view === false) {
      // An export is not a page: bouncing a fetch to the till would download
      // the till's HTML as a .csv rather than refusing it.
      if (pathname.startsWith("/api/")) {
        return new NextResponse("Not authorised", { status: 403 })
      }
      // The role's home terminates this — unless the home is itself the blocked
      // module (a manager with the dashboard hidden), in which case the public,
      // ungated sign-in page does. This used to send them to the till, which is
      // gone from the web now.
      return redirectTo(
        pathname.startsWith(ADMIN_HOME_PATH) ? LOGIN_PATH : ADMIN_HOME_PATH,
      )
    }
  }

  return proceed()
}

export const config = {
  runtime: "experimental-edge",
  matcher: [
    /*
     * Everything except Next internals and static files. Auth cookies must be
     * refreshed on real page requests, not on every image fetch.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf)$).*)",
  ],
}
