import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { getRefundRequiresManager } from "@/lib/pos/queries"
import { assertShiftOpenFor } from "@/lib/pos/shift-core"
import { verifyApproval } from "@/lib/pos/sale-core"

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
  refundMethod: z.enum(["cash", "card", "juice", "myt_money", "bank", "exchange"]),
  restock: z.boolean().default(true),
  /**
   * Which till is asking, so a return can only be booked into its own open
   * drawer. Optional for the same reason as on the sale path: an older build
   * that omits it still gets the closed-shift refusal, just not ownership.
   */
  deviceId: z.number().int().positive().nullish(),
  /**
   * A manager's PIN, when the shop has asked for one. Ignored otherwise, so a
   * till running an older build against a shop that has not turned the setting
   * on behaves exactly as it always did.
   */
  approval: z
    .object({ managerId: z.uuid(), pin: z.string() })
    .nullish()
    .transform((v) => v ?? null),
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
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid return.",
      },
      // A schema failure is a client bug, not a counter outcome — say so on
      // the status line as well as the body, like the malformed-JSON branch.
      { status: 400 },
    )
  }

  const { saleId, shiftId, reason, refundMethod, restock, items, approval } = parsed.data

  /**
   * The drawer, checked before anything is verified or written.
   *
   * `create_credit_note` inserts whatever shift id it is handed with no
   * openness check of its own, so without this a till could book its refunds
   * into another drawer's shift — or one already counted and closed — and that
   * drawer's Z would come out wrong for no visible reason.
   */
  if (shiftId !== null) {
    const reachable = await assertShiftOpenFor(session.supabase, shiftId, {
      role: session.user.role,
      deviceId: parsed.data.deviceId ?? null,
    })
    if (!reachable.ok) return apiError(reachable.error, 403)
  }

  /**
   * The manager, when this shop wants one (migration 036).
   *
   * Checked here as well as in the database, and the order matters: the RPC
   * would refuse an unapproved return anyway, but only after taking the row
   * lock and reading every line. Asking first means a till that has not
   * collected a PIN gets a sentence it can act on — "a manager needs to
   * approve this return" — instead of a lock contended for nothing.
   *
   * The database remains the thing that actually enforces it. This is the
   * courtesy; that is the rule.
   */
  let approvedBy: string | null = null
  if (await getRefundRequiresManager(session.supabase)) {
    const verified = await verifyApproval(session.supabase, approval, "return")
    if ("error" in verified) {
      return NextResponse.json({ ok: false, error: verified.error, needsApproval: true })
    }
    approvedBy = verified.managerId
  }

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
    // Never a value the client asserted: this is the id `verifyApproval` just
    // proved holds the PIN that was typed.
    p_approved_by: approvedBy,
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

  const { data: note, error: noteError } = await session.supabase
    .from("credit_notes")
    .select(
      "credit_no, total, refund_method, vat_policy_id, vat_enabled, vat_rate, vat_number, vat_amount",
    )
    .eq("id", creditNoteId)
    .maybeSingle()

  const committedReadFailure = () =>
    NextResponse.json({
      ok: false,
      creditNoteId,
      refundCommitted: true,
      readFailed: true,
      error:
        "The return was recorded, but its details could not be loaded. Refresh sale history; do not submit it again.",
    })

  if (noteError) return committedReadFailure()
  if (!note) return committedReadFailure()

  return NextResponse.json({
    ok: true,
    creditNoteId,
    creditNo: note.credit_no,
    total: Number(note.total),
    refundMethod: note.refund_method,
    vatPolicyId: note.vat_policy_id,
    vatEnabled: note.vat_enabled,
    vatRate: Number(note.vat_rate),
    vatNumber: note.vat_number,
    vatAmount: Number(note.vat_amount),
  })
}
