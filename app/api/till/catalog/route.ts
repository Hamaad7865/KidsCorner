import { NextResponse } from "next/server"

import { requireTillSession } from "@/lib/api/till-session"
import { loadCatalog } from "@/lib/pos/queries"

/**
 * The sellable catalog, whole.
 *
 * The till caches this on device and searches it locally, so a scan resolves
 * without a round trip — which is what lets the shop keep selling when the
 * line drops. Prices in here are for *display*: the sale is re-priced on the
 * server, so a stale cache shows an old price but can never charge one.
 */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const variants = await loadCatalog(session.supabase)

  return NextResponse.json({ ok: true, variants })
}
