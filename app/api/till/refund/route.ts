import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"

/**
 * A return against a past sale, written as a credit note.
 *
 * Everything that decides money happens in `create_credit_note`, not here: it
 * re-reads each sale line, refunds at what the customer actually paid for that
 * unit (discount included, not the list price), refuses to give back more than
 * was sold, and refuses a sale that is void. This route's whole job is to check
 * the session, shape the payload and hand it over — the same division as
 * `commitSale`, and for the same reason. A till that could name its own refund
 * total would be a till that could empty the drawer.
 *
 * `restock` is the design's "Put items back into stock" switch. Off means the
 * unit is faulty: the customer is still refunded and the credit note still
 * records the return, but the goods never rejoin the sellable count.
 */
const bodySchema = z.object({
  saleId: z.number().int().positive(),
  shiftId: z.number().int().positive().nullish().transform((v) => v ?? null),
  reason: z.string().trim().min(1, "Pick a reason for the return."),
  refundMethod: z.enum(["cash", "card", "juice", "myt_money", "exchange"]),
  restock: z.boolean().default(true),
  items: z
    .array(
      z.object({
        saleItemId: z.number().int().positive(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1, "Pick what is coming back."),
})

export async function POST(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid return.",
    })
  }

  const { saleId, shiftId, reason, refundMethod, restock, items } = parsed.data

  // Two lines naming the same sale item would each pass the RPC's
  // already-returned check on their own and together exceed what was sold, so
  // they are merged before they get there.
  const merged = new Map<number, number>()
  for (const item of items) {
    merged.set(item.saleItemId, (merged.get(item.saleItemId) ?? 0) + item.qty)
  }

  const { data, error } = await session.supabase.rpc("create_credit_note", {
    p_sale_id: saleId,
    p_shift_id: shiftId,
    // The signed-in device's own user, never a cashier id the client asserted.
    p_cashier_id: session.user.id,
    p_reason: reason,
    p_refund_method: refundMethod,
    p_items: [...merged].map(([sale_item_id, qty]) => ({ sale_item_id, qty })),
    p_restock: restock,
  } as never)

  if (error) {
    // The RPC's own RAISE messages are written for a person at a till — "Only 1
    // of line 162 can still be returned" — so they are passed through rather
    // than replaced with something vaguer.
    return NextResponse.json({ ok: false, error: error.message })
  }

  const creditNoteId = typeof data === "number" ? data : null
  if (creditNoteId === null) {
    return NextResponse.json({ ok: false, error: "The return did not complete." })
  }

  const { data: note } = await session.supabase
    .from("credit_notes")
    .select("credit_no, total, refund_method")
    .eq("id", creditNoteId)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    creditNoteId,
    creditNo: note?.credit_no ?? "",
    total: note?.total === undefined ? 0 : Number(note.total),
    refundMethod: note?.refund_method ?? refundMethod,
  })
}
