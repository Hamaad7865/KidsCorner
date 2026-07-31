import type { Role } from "@/lib/db-enums"

/**
 * Route map shared by the proxy and the UI.
 *
 * Route groups — `(auth)`, `(pos)`, `(admin)` — do not appear in URLs, so the
 * proxy classifies requests by path prefix instead. Keep this list in step with
 * the folders under `app/`.
 */

export const LOGIN_PATH = "/login"
export const POS_PATH = "/pos"
export const ADMIN_HOME_PATH = "/dashboard"

/** The Android till's API. Authenticated, but by bearer token, not by cookie. */
export const TILL_API_PREFIX = "/api/till"

/** Paths reachable without a session. */
export const PUBLIC_PATHS = [LOGIN_PATH] as const

/** Every top-level path served by the `(admin)` group. Owner/manager only. */
export const ADMIN_PATHS = [
  "/dashboard",
  "/point-of-sale",
  "/products",
  "/import",
  "/stock",
  "/purchases",
  "/customers",
  "/sales",
  "/suppliers",
  "/reports",
  "/activity",
  "/search",
  "/settings",
] as const

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => matchesPrefix(pathname, path))
}

/**
 * The Android till's endpoints, which the proxy must not touch.
 *
 * Not public — every one of them calls `requireTillSession` first. But they
 * carry a bearer token instead of a cookie, so the proxy sees no session and
 * would answer a 307 to /login. A native client cannot follow that: it would
 * get an HTML page where it expected JSON, and the failure would look like a
 * parse bug rather than an auth one.
 */
export function isTillApiPath(pathname: string): boolean {
  return matchesPrefix(pathname, TILL_API_PREFIX)
}

/** `(pos)` routes: /pos, /pos/shift, /pos/receipt/[id] — all roles allowed. */
export function isPosPath(pathname: string): boolean {
  return matchesPrefix(pathname, POS_PATH)
}

/** `(admin)` routes — require owner or manager. */
export function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some((path) => matchesPrefix(pathname, path))
}

/** Where a role lands after login, or when it hits `/`. */
export function landingPathForRole(role: Role): string {
  return role === "cashier" ? POS_PATH : ADMIN_HOME_PATH
}

/**
 * A host that cannot exist, used as the base for resolving `?next=`. If a
 * candidate parses to any other origin, it was trying to leave the site.
 */
const REDIRECT_SENTINEL = "http://redirect.invalid"

/**
 * Sanitises a `?next=` value so an open redirect can't be smuggled in.
 *
 * Prefix checks are not sufficient. The URL parser treats `\` as `/` and strips
 * tab/newline anywhere in the input, so `/\evil.com` and `/<TAB>//evil.com` both
 * resolve to an off-site origin while passing a `startsWith("//")` test. The
 * only reliable form is to parse the candidate and confirm it did not escape.
 *
 * Takes `unknown`: Next yields `string[]` for a repeated query key, and this is
 * called with raw search params on the login page.
 */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null
  // Must be site-absolute. Rejects "https://evil.com" and bare "foo" alike.
  if (!value.startsWith("/")) return null

  let url: URL
  try {
    url = new URL(value, REDIRECT_SENTINEL)
  } catch {
    return null
  }
  if (url.origin !== REDIRECT_SENTINEL) return null

  // Rebuilt from parsed parts, so the caller gets pathname and search back
  // separately rather than a string that still needs splitting.
  return `${url.pathname}${url.search}`
}
