import { NextResponse } from "next/server"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { loadProductStock } from "@/lib/pos/stock-check"

/** Live stock split by active location for one catalogue product. */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const rawProductId = new URL(request.url).searchParams.get("productId") ?? ""
  if (!/^[1-9]\d*$/.test(rawProductId)) {
    return apiError("Choose a product to check.", 400)
  }

  const productId = Number(rawProductId)
  if (!Number.isSafeInteger(productId)) {
    return apiError("Choose a product to check.", 400)
  }

  try {
    const locations = await loadProductStock(session.supabase, productId)
    return NextResponse.json({ ok: true, productId, locations })
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Stock could not be loaded.",
      500,
    )
  }
}
