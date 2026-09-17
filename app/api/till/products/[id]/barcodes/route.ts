import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateTillBarcodes, getTillProduct } from "@/lib/till/products"

const bodySchema = z.object({
  variantIds: z.array(z.number().int().positive()).min(1).max(200),
})

/**
 * Issue barcodes to variants that have none or an invalid one.
 *
 * Variants already carrying a valid code are counted back as `skippedValid`
 * and never touched — a code on a printed sticker must not move.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const raw = (await params).id
  if (!/^[1-9]\d*$/.test(raw)) return apiError("Choose a product to open.", 400)
  const productId = Number(raw)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Pick at least one variant." },
      { status: 400 },
    )
  }

  const result = await generateTillBarcodes(createAdminClient(), parsed.data.variantIds)
  if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 422 })

  try {
    const product = await getTillProduct(session.supabase, productId, session.user.role)
    return NextResponse.json({ ok: true, ...result, product })
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Product could not be reloaded.",
      500,
    )
  }
}
