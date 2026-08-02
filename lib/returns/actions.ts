"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { isAdminRole } from "@/lib/auth/roles"
import { getRefundRequiresManager } from "@/lib/pos/queries"
import { verifyApproval } from "@/lib/pos/sale-core"
import { getSessionProfile } from "@/lib/auth/session"
import {
  boolOf,
  fieldErrorsOf,
  formFail as fail,
  formOk,
  idOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import type { Database, Json } from "@/lib/supabase/database.types"
import { createClient } from "@/lib/supabase/server"

/**
 * Raising a credit note.
 *
 * Everything of consequence happens inside `create_credit_note`: it validates
 * every line before writing anything, refuses to return more than was sold and
 * not yet returned, puts the stock back through `record_stock_movement`, and
 * flips the sale to 'refunded' only once every unit has come back. This action
 * validates shape and forwards — it deliberately does not re-implement any of
 * that, because two copies of an over-return rule is one too many.
 */

const REFUND_METHODS = ["cash", "card", "juice", "myt_money", "exchange"] as const

const creditNoteSchema = z.object({
  saleId: z.number().int().positive(),
  shiftId: z.number().int().positive().nullable(),
  reason: z
    .string()
    .trim()
    .min(3, "Give a reason — it is the only record of why the money went back.")
    .max(200, "Keep the reason under 200 characters."),
  refundMethod: z.enum(REFUND_METHODS),
  /**
   * Whether the goods go back on the shelf.
   *
   * `boolOf` reads an absent checkbox as false, so the form posts it
   * explicitly and the default here is only for a caller that omits it —
   * matching the RPC, which also defaults to restocking.
   */
  restock: z.boolean().default(true),
  /**
   * A manager's PIN, when the shop has asked for one and the person raising
   * the return is not one themselves. Posted as JSON because it is two fields
   * that only ever travel together.
   */
  approval: z
    .object({ managerId: z.uuid(), pin: z.string() })
    .nullish()
    .transform((v) => v ?? null),
  items: z
    .array(
      z.object({
        saleItemId: z.number().int().positive(),
        qty: z.number().int().min(1),
      }),
    )
    .min(1, "Pick at least one item to return."),
})

export async function createCreditNote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }

  const saleId = idOf(formData, "saleId")
  if (saleId === null) return fail("Couldn't tell which sale to return against.")

  // Lines arrive as JSON: a variable-length list of quantities doesn't map onto
  // flat form fields, and the RPC re-validates every one anyway.
  let rawItems: unknown = []
  try {
    rawItems = JSON.parse(textOf(formData, "items") || "[]")
  } catch {
    return fail("The return lines could not be read. Refresh and try again.")
  }

  const approvalRaw = formData.get("approval")
  let rawApproval: unknown = null
  if (typeof approvalRaw === "string" && approvalRaw.trim() !== "") {
    try {
      rawApproval = JSON.parse(approvalRaw)
    } catch {
      return fail("That approval could not be read. Try again.")
    }
  }

  const parsed = creditNoteSchema.safeParse({
    saleId,
    shiftId: idOf(formData, "shiftId"),
    reason: textOf(formData, "reason"),
    refundMethod: textOf(formData, "refundMethod"),
    restock: boolOf(formData, "restock"),
    approval: rawApproval,
    items: rawItems,
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { shiftId, reason, refundMethod, restock, approval, items } = parsed.data

  const supabase = await createClient()

  /**
   * Who authorised this, when the shop wants somebody to.
   *
   * An owner or manager raising a return authorises it by being one — they are
   * standing at the screen. A cashier is not, so when the setting is on they
   * hand the keypad over and a manager's PIN is verified here, exactly the way
   * /api/till/refund does it for the tablet. Same helper, so the two tills
   * cannot drift on who may give money back.
   *
   * Checked here as well as in the database, and the order matters: the RPC
   * would refuse anyway, but only after taking the row lock and reading every
   * line. Asking first turns that into a sentence the cashier can act on.
   * The database remains the thing that enforces it; this is the courtesy.
   */
  let approvedBy: string | null = isAdminRole(profile.role) ? profile.id : null
  if (approvedBy === null && (await getRefundRequiresManager(supabase))) {
    const verified = await verifyApproval(supabase, approval, "return")
    if ("error" in verified) {
      // Keyed so the form knows to show the keypad rather than only the text.
      return fail(verified.error, { needsApproval: "1" })
    }
    approvedBy = verified.managerId
  }

  /**
   * Same nullability gap as `complete_sale`: the generated types declare
   * `p_shift_id` and `p_cashier_id` non-nullable because `supabase gen types`
   * cannot see that the SQL parameters accept NULL. A return raised outside an
   * open shift genuinely has no shift. Cast below rather than editing
   * database.types.ts, so a regen does not undo it.
   */
  const args = {
    p_sale_id: parsed.data.saleId,
    p_shift_id: shiftId,
    p_cashier_id: profile.id,
    p_approved_by: approvedBy,
    p_reason: reason,
    p_refund_method: refundMethod,
    // The tablet till has always sent this; the back office never did, so a
    // faulty garment returned here went straight back onto the shelf as
    // sellable stock. The RPC defaults it TRUE, which is why nothing failed
    // and nobody noticed.
    p_restock: restock,
    // Merged by sale item, exactly as the till API does. The RPC's
    // already-returned check reads only COMMITTED credit notes and does not
    // accumulate within a call, so two entries naming one line each compare
    // against zero and both pass — refunding the line twice and restocking it
    // twice. The till route has always merged for this reason; this one did
    // not, and it is the route a manager uses from the back office.
    p_items: [
      ...items
        .reduce(
          (merged, i) => merged.set(i.saleItemId, (merged.get(i.saleItemId) ?? 0) + i.qty),
          new Map<number, number>(),
        )
        .entries(),
    ].map(([saleItemId, qty]) => ({ sale_item_id: saleItemId, qty })) as Json,
  } as unknown as Database["public"]["Functions"]["create_credit_note"]["Args"]

  const { data, error } = await supabase.rpc("create_credit_note", args)

  if (error) {
    // The RPC raises readable messages for the cases a cashier can actually
    // hit — over-returning, a void sale — so they are passed straight through.
    return fail(
      error.code === "42501"
        ? "You don't have permission to raise a credit note."
        : error.message,
    )
  }

  revalidatePath("/sales")
  revalidatePath(`/sales/${parsed.data.saleId}/return`)
  revalidatePath("/stock")
  revalidatePath("/pos/shift")

  return formOk(
    typeof data === "number"
      ? `Credit note raised. Stock is back on the shelf.`
      : "Credit note raised.",
  )
}
