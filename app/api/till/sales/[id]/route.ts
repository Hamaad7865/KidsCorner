import { NextResponse } from "next/server"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { getSaleDetail } from "@/lib/sales/queries"

/** One sale in full, for the receipt the till is about to reprint. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const saleId = Number((await params).id)
  if (!Number.isInteger(saleId) || saleId <= 0) {
    return apiError("That is not a sale number.", 400)
  }

  const sale = await getSaleDetail(saleId, session.supabase)
  if (!sale) return apiError("That sale was not found.", 404)

  return NextResponse.json({ ok: true, sale })
}
