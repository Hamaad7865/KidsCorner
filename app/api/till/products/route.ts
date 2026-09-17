import { NextResponse } from "next/server"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { listTillProducts } from "@/lib/till/products"

/** The tablet's product browser: search by name or product code. */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const params = new URL(request.url).searchParams
  const search = (params.get("search") ?? "").slice(0, 60)

  try {
    const result = await listTillProducts(session.supabase, search)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Products could not be loaded.",
      500,
    )
  }
}
