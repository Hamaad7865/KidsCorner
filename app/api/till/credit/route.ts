import { NextResponse } from "next/server"
import { z } from "zod"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { logAudit } from "@/lib/activity/audit"
import { formatRs, round2 } from "@/lib/format"

/**
 * A customer walking in to pay their tab.
 *
 * Open to cashiers, unlike the back office's own settle action, because this is
 * a counter job: somebody hands over notes across the till and expects the debt
 * to go down. The back-office route is owner/manager only for the opposite
 * reason — `/customers` is a screen a cashier cannot reach.
 *
 * `shiftId` is what makes the cash side correct. `settle_customer_credit` writes
 * a matching `till_movements` row for a cash payment taken against a shift, so
 * the drawer expects the money at close; without it the cashier would count more
 * cash than the shift's sales can explain and be recorded as over.
 *
 * Nothing about the amount is decided here. The function locks the customer,
 * re-reads the balance from the ledger, and refuses an over-payment — so a till
 * that posted a stale balance gets a refusal rather than a wrong entry.
 */

const settleSchema = z.object({
  customerId: z.number().int().positive(),
  amount: z.number().positive(),
  method: z.enum(["cash", "card", "juice", "myt_money", "bank"]),
  /**
   * Nullable, and it must be: a till with no shift open cannot take money into
   * a drawer that is not there. The RPC treats null as "not in any drawer".
   */
  shiftId: z.number().int().positive().nullish(),
  reason: z.string().trim().max(200).nullish(),
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

  const parsed = settleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid payment.",
    })
  }

  const { customerId, amount, method, shiftId, reason } = parsed.data

  const { data, error } = await session.supabase.rpc("settle_customer_credit", {
    p_customer_id: customerId,
    p_amount: round2(amount),
    p_method: method,
    p_shift_id: shiftId ?? undefined,
    p_reason: reason ?? undefined,
  })

  if (error) {
    /**
     * Always 200, like `/api/till/sale`.
     *
     * Every failure here is one the cashier has to act on and the till renders
     * differently — "they only owe Rs 350", "that shift is closed" — and an HTTP
     * status would flatten them into "request failed" and invite a blind retry
     * of a payment that may have been recorded.
     */
    return NextResponse.json({ ok: false, error: error.message })
  }

  const result = (data ?? {}) as { balance?: unknown; entry_id?: unknown }
  const balance = round2(Number(result.balance ?? 0))

  await logAudit(session.supabase, {
    type: "customer.credit_settled",
    refType: "customer",
    refId: customerId,
    summary: `${formatRs(amount)} received on account at the till`,
    detail: { amount, method, shiftId: shiftId ?? null, reason, balance },
  })

  return NextResponse.json({
    ok: true,
    entryId: Number(result.entry_id ?? 0),
    balance,
    settled: round2(amount),
  })
}
