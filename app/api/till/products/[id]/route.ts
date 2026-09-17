import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { createAdminClient } from "@/lib/supabase/admin"
import { getTillProduct, updateTillProduct } from "@/lib/till/products"

function productIdOf(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

const patchSchema = z.object({
  name: z.string(),
  productCode: z.string(),
  shelfLocation: z.string().nullable(),
  isActive: z.boolean(),
})

/** One product with every variant, for the tablet's detail screen. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTillSession(_request)
  if ("response" in session) return session.response

  const id = productIdOf((await params).id)
  if (id === null) return apiError("Choose a product to open.", 400)

  try {
    const product = await getTillProduct(session.supabase, id, session.user.role)
    if (!product) return apiError("That product no longer exists.", 404)
    return NextResponse.json({ ok: true, product })
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Product could not be loaded.",
      500,
    )
  }
}

/**
 * The header fields a tablet edits at the counter.
 *
 * Writes go through the service role: the shop owner chose "anyone on the
 * till" over the web's owner/manager rule, and RLS would otherwise refuse a
 * cashier. The session still has to be an active profile, and the rename is
 * audit-logged under the actor's own name.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const id = productIdOf((await params).id)
  if (id === null) return apiError("Choose a product to open.", 400)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid product." },
      { status: 400 },
    )
  }

  const result = await updateTillProduct({
    db: createAdminClient(),
    audit: session.supabase,
    actorName: session.user.name,
    productId: id,
    patch: parsed.data,
  })
  if (!result.ok) return NextResponse.json(result, { status: 422 })

  try {
    const product = await getTillProduct(session.supabase, id, session.user.role)
    return NextResponse.json({ ok: true, product })
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Product could not be reloaded.",
      500,
    )
  }
}
