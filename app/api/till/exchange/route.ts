import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import type { TillClient } from "@/lib/pos/sale-core"
import { assertShiftOpenFor } from "@/lib/pos/shift-core"
import { verifyApproval } from "@/lib/pos/sale-core"

/**
 * An exchange against a past sale: goods come back AND replacements walk out,
 * in one atomic pair — a credit note for what came back (at what was paid)
 * and a new sale for what goes out (re-priced today), with one payment
 * settling the gap.
 *
 * Everything that decides money happens in `create_exchange`, not here. This
 * route's job is the same division as the refund route: check the session,
 * check the drawer, verify a manager when the sale is past the 7-day window,
 * shape the payload, hand it over.
 *
 * The 7-day window is enforced in the database regardless of what this route
 * does — but asking here first means a till that has not collected a PIN gets
 * `needsApproval` (a sentence it can act on) instead of a refusal after a
 * round-trip through every line.
 */
const bodySchema = z.object({
  saleId: z.number().int().positive(),
  shiftId: z.number().int().positive().nullish().transform((v) => v ?? null),
  deviceId: z.number().int().positive().nullish(),
  paymentMethod: z.enum(["cash", "card", "juice", "myt_money", "bank"]),
  /** Cash handed over for the gap; change given from it. Cash only. */
  tendered: z.number().nonnegative().nullish().transform((v) => v ?? null),
  /** Names this attempt so a retry replays instead of settling twice. */
  idempotencyKey: z.string().trim().min(1).nullish().transform((v) => v ?? null),
  approval: z
    .object({ managerId: z.uuid(), pin: z.string() })
    .nullish()
    .transform((v) => v ?? null),
  returnItems: z
    .array(
      z.object({
        saleItemId: z.number().int().positive(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1, "Pick what is coming back."),
  newItems: z
    .array(
      z.object({
        variantId: z.number().int().positive(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1, "Pick what is going out."),
})

/** The original sale's age decides whether a manager must approve. */
async function saleAgeDays(supabase: TillClient, saleId: number) {
  const { data } = await supabase
    .from("sales")
    .select("sale_date")
    .eq("id", saleId)
    .maybeSingle()
  if (!data?.sale_date) return null
  return (Date.now() - new Date(data.sale_date).getTime()) / 86_400_000
}

export async function POST(request: Request) {
  const sessionResult = await requireTillSession(request)
  if ("response" in sessionResult) return sessionResult.response
  const session = sessionResult

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid exchange." },
      { status: 400 },
    )
  }

  const { saleId, shiftId, deviceId, paymentMethod, tendered, approval, returnItems, newItems, idempotencyKey } =
    parsed.data

  /**
   * The drawer, checked before anything else — same reason as refunds: the
   * RPC inserts whatever shift id it is handed with no openness check of its
   * own, and both documents land in THIS drawer's shift.
   */
  if (shiftId !== null) {
    const reachable = await assertShiftOpenFor(session.supabase, shiftId, {
      role: session.user.role,
      deviceId: deviceId ?? null,
    })
    if (!reachable.ok) return apiError(reachable.error, 403)
  }

  /** Past the window, a manager's PIN — verified exactly as refunds verify one. */
  let approvedBy: string | null = null
  const ageDays = await saleAgeDays(session.supabase, saleId)
  if (ageDays !== null && ageDays > 7) {
    const verified = await verifyApproval(session.supabase, approval, "exchange" as "return")
    if ("error" in verified) {
      return NextResponse.json({ ok: false, error: verified.error, needsApproval: true })
    }
    approvedBy = verified.managerId
  }

  // Two lines naming the same sale item would each pass the RPC's guard on
  // their own and together exceed what was sold — merged first, as refunds do.
  const mergedReturns = new Map<number, number>()
  for (const item of returnItems) {
    mergedReturns.set(item.saleItemId, (mergedReturns.get(item.saleItemId) ?? 0) + item.qty)
  }

  // The migration ships in the same deploy that carries this route (the
  // pipeline applies migrations first), but the generated types only know
  // functions from their last regeneration — so the name is widened here.
  const { data, error } = await session.supabase.rpc("create_exchange_keyed" as Parameters<
    typeof session.supabase.rpc
  >[0], {
    p_key: idempotencyKey,
    p_sale_id: saleId,
    p_shift_id: shiftId,
    p_cashier_id: session.user.id,
    p_return_items: [...mergedReturns].map(([sale_item_id, qty]) => ({ sale_item_id, qty })),
    p_new_items: newItems.map(({ variantId, qty }) => ({ variant_id: variantId, qty })),
    p_payment_method: paymentMethod,
    p_tendered: paymentMethod === "cash" ? tendered : null,
    p_approved_by: approvedBy,
  } as never)

  if (error) {
    // The RPC's RAISE messages are written for a person at a till — pass them
    // through untouched, exactly as the refund route does.
    return NextResponse.json({ ok: false, error: error.message })
  }

  const newSaleId = typeof data === "number" ? data : null
  if (newSaleId === null) {
    return NextResponse.json({ ok: false, error: "The exchange did not complete." })
  }

  // The gap this exchange actually settled — signed, so the till can tell a
  // trade-up ("Rs X taken") from a trade-down ("Rs X given back") apart. One
  // settlement row is always written for it, whichever direction it ran.
  const { data: settlement } = await session.supabase
    .from("sale_payments")
    .select("amount")
    .eq("sale_id", newSaleId)

  const gap = (settlement ?? []).reduce((sum, row) => sum + Number(row.amount), 0)

  return NextResponse.json({ ok: true, saleId: newSaleId, gap })
}
