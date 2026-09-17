import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTillProduct, updateTillVariant } from "@/lib/till/products"

const patchSchema = z.object({
  variantId: z.number().int().positive(),
  sellingPrice: z.number(),
  costPrice: z.number().nullish(),
  reorderLevel: z.number().int(),
  /**
   * Null clears the barcode — so "leave it alone" rides on `barcodeTouched`,
   * because the till's serialiser always sends the null.
   */
  barcode: z.string().nullable().nullish(),
  barcodeTouched: z.boolean().nullish(),
  isActive: z.boolean(),
})

/**
 * One variant's price, cost, reorder level, barcode and flag.
 *
 * Same elevated-write shape as the product PATCH above: any active till
 * profile may call it, the mutation runs service-side, and price/cost moves
 * land in the audit trail under the actor's name. Cost itself stays gated —
 * a cashier's attempt is refused, not silently dropped.
 */
export async function PATCH(
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
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid variant." },
      { status: 400 },
    )
  }

  const result = await updateTillVariant({
    db: createAdminClient(),
    audit: session.supabase,
    actorName: session.user.name,
    actorRole: session.user.role,
    variantId: parsed.data.variantId,
    patch: {
      sellingPrice: parsed.data.sellingPrice,
      costPrice: parsed.data.costPrice ?? undefined,
      reorderLevel: parsed.data.reorderLevel,
      barcode: parsed.data.barcodeTouched ? (parsed.data.barcode ?? null) : undefined,
      isActive: parsed.data.isActive,
    },
  })
  if (!result.ok) return NextResponse.json(result, { status: 422 })

  try {
    const product = await getTillProduct(session.supabase, productId, session.user.role)
    return NextResponse.json({ ok: true, product })
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Product could not be reloaded.",
      500,
    )
  }
}
