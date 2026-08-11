/**
 * Riding out the clock skew between Supabase's auth server and its Postgres.
 *
 * A freshly refreshed token carries an `iat` (and sometimes `nbf`) stamped on
 * the auth server. When that server's clock runs a hair ahead of the database's,
 * PostgREST — which validates the token's timing on every request — rejects it
 * with `PGRST303 "JWT issued at future"` for the fraction of a second until the
 * two clocks agree. `getClaims()` verifies the token locally and never sees it;
 * only the per-request table reads do, right after a refresh.
 *
 * Left unhandled it did real harm: the proxy's role read fell open (guard
 * bypassed for that request), and a page's `getSessionProfile` read treated the
 * rejection as "no account" and signed the user out. A short retry clears it,
 * because the skew is transient and small.
 */

/** The shape both PostgREST and GoTrue errors share for our purposes. */
type QueryError = { code?: string | null; message?: string | null }

/**
 * True only for the transient clock-skew rejection above — never for a real
 * auth failure (an expired or forged token), which must not be retried.
 */
export function isJwtClockSkew(error: QueryError | null | undefined): boolean {
  if (!error) return false
  // The authoritative signal; the message check is a belt-and-braces fallback
  // in case a proxy layer forwards the text without the code.
  if (error.code === "PGRST303") return true
  const message = (error.message ?? "").toLowerCase()
  return (
    message.includes("jwt issued at future") ||
    message.includes("jwt not yet valid")
  )
}

/**
 * Runs a PostgREST read, retrying ONLY the clock-skew rejection. Success or any
 * other error returns at once, so the normal path pays nothing; the rare skew
 * case costs at most `(attempts - 1) * delayMs`. The read thunk is re-invoked
 * each attempt so it sends afresh.
 */
export async function readPastClockSkew<R extends { error: QueryError | null }>(
  read: () => PromiseLike<R>,
  { attempts = 3, delayMs = 150 }: { attempts?: number; delayMs?: number } = {},
): Promise<R> {
  let result = await read()
  for (
    let attempt = 1;
    attempt < attempts && isJwtClockSkew(result.error);
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    result = await read()
  }
  return result
}
