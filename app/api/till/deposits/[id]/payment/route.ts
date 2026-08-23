import { NextResponse } from "next/server"

import { logAudit } from "@/lib/activity/audit"
import { apiError, requireTillSession } from "@/lib/api/till-session"
import { assertShiftOpenFor } from "@/lib/pos/shift-core"
import { depositTopUpSchema } from "@/lib/deposits/core"
import { formatRs } from "@/lib/format"

/**
 * Money added to an open layaway between visits.
 *
 * Online only, never queued — the same rule as a settlement on account. The
 * RPC locks the order row, re-reads its balance and refuses an over-payment,
 * so a till that posted against a stale screen gets a refusal rather than a
 * second truth. Cash writes a till movement in the same transaction, which is
 * why the shift gate runs here: a drawer that is closed cannot expect money.
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

  const parsed = depositTopUpSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid payment." },
      { status: 400 },
    )
  }

  const input = parsed.data

  if (input.method === "cash" && input.shiftId == null) {
    return NextResponse.json({
      ok: false,
      error: "Open the till before taking cash.",
    })
  }

  if (input.shiftId !== undefined && input.shiftId !== null) {
    const reachable = await assertShiftOpenFor(
      session.supabase,
      input.shiftId,
      { role: session.user.role, deviceId: input.deviceId ?? null },
    )
    if (!reachable.ok) return NextResponse.json({ ok: false, error: reachable.error })
  }

  const { data, error } = await session.supabase.rpc("add_deposit_payment", {
    p_key: input.idempotencyKey,
    p_order_id: orderId,
    p_method: input.method,
    p_amount: input.amount,
    p_tendered: input.tendered ?? undefined,
    p_shift_id: input.shiftId ?? undefined,
    p_cashier_id: session.user.id,
    p_device_id: input.deviceId ?? undefined,
  })

  if (error || !data) {
    return NextResponse.json({
      ok: false,
      error: error?.message ?? "The payment could not be recorded.",
    })
  }

  const result = data as {
    payment_id?: unknown
    paid?: unknown
    balance?: unknown
    replayed?: boolean
  }
  const paymentId = Number(result.payment_id ?? 0)
  const paid = Number(result.paid ?? 0)
  const balance = Number(result.balance ?? 0)

  if (!result.replayed) {
    await logAudit(session.supabase, {
      type: "deposit.payment",
      refType: "deposit_order",
      refId: orderId,
      summary: `${formatRs(input.amount)} received on a deposit at the till`,
      detail: {
        paymentId,
        amount: input.amount,
        method: input.method,
        shiftId: input.shiftId ?? undefined,
        paid,
        balance,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    paymentId,
    paid,
    balance,
    replayed: result.replayed === true,
  })
}
