import { NextResponse } from "next/server"

import { logAudit } from "@/lib/activity/audit"
import { apiError, requireTillSession } from "@/lib/api/till-session"
import { assertShiftOpenFor } from "@/lib/pos/shift-core"
import { depositCollectSchema } from "@/lib/deposits/core"
import { round2 } from "@/lib/format"

/**
 * A pickup visit: the customer takes some or all of a layaway home.
 *
 * The RPC writes an ordinary sale — ordinary enough to print, return and
 * report through every path that already exists — at the order's FROZEN
 * prices, allocating money already in hand as a method='deposit' tender and
 * recording whatever is paid today as fresh payment rows. No stock movement:
 * those units left the shelf when the order opened.
 *
 * `vatPolicyId` + `checkedOutAt` arrive frozen from the till exactly like a
 * checkout freeze, so the sale stamps the policy that was in force when the
 * cashier confirmed rather than whichever row is current by then.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const orderId = Number((await params).id)
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return apiError("That is not a deposit number.", 400)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("Malformed request.", 400)
  }

  const parsed = depositCollectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid pickup." },
      { status: 400 },
    )
  }

  const input = parsed.data

  // Today's cash lands in THIS drawer via the sale's own payment rows, so
  // the shift gate runs here just as it does before complete_sale.
  const reachable = await assertShiftOpenFor(session.supabase, input.shiftId, {
    role: session.user.role,
    deviceId: input.deviceId ?? null,
  })
  if (!reachable.ok) return NextResponse.json({ ok: false, error: reachable.error })

  const { data, error } = await session.supabase.rpc("collect_deposit_order", {
    p_order_id: orderId,
    p_lines: input.lines.map((line) => ({ item_id: line.itemId, qty: line.qty })),
    p_new_payments: input.newPayments.map((payment) => ({
      method: payment.method,
      amount: payment.amount,
      tendered: payment.tendered ?? undefined,
    })),
    p_shift_id: input.shiftId,
    p_cashier_id: session.user.id,
    p_device_id: input.deviceId ?? undefined,
    p_vat_policy_id: input.vatPolicyId ?? undefined,
    p_checked_out_at: input.checkedOutAt ?? undefined,
    p_key: input.idempotencyKey,
  })

  if (error || data === null || data === undefined) {
    return NextResponse.json({
      ok: false,
      error: error?.message ?? "The collection could not be recorded.",
    })
  }

  const saleId = Number(data)

  await logAudit(session.supabase, {
    type: "deposit.collected",
    refType: "deposit_order",
    refId: orderId,
    summary: `Deposit collected at the till — sale ${saleId} written`,
    detail: {
      saleId,
      lines: input.lines.length,
      paidNow: round2(input.newPayments.reduce((sum, p) => sum + p.amount, 0)),
      methods: input.newPayments.map((p) => p.method),
      shiftId: input.shiftId,
    },
  })

  return NextResponse.json({ ok: true, saleId })
}
