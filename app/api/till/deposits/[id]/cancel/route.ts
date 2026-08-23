import { NextResponse } from "next/server"

import { logAudit } from "@/lib/activity/audit"
import { apiError, requireTillSession } from "@/lib/api/till-session"
import { assertShiftOpenFor } from "@/lib/pos/shift-core"
import { depositCancelSchema } from "@/lib/deposits/core"
import { formatRs } from "@/lib/format"

/**
 * Cancelling a layaway: refund what has not been collected, put back what
 * has not left.
 *
 * The RPC refunds ONLY unallocated credit — money already turned into a
 * pickup sale bought real goods, and those are returned through credit notes,
 * not here. Cash goes back out of the named drawer through a till movement;
 * the RPC refuses an empty or closed one before any ledger row is written.
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

  const parsed = depositCancelSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid cancellation." },
      { status: 400 },
    )
  }

  const input = parsed.data

  if (input.shiftId !== undefined && input.shiftId !== null) {
    const reachable = await assertShiftOpenFor(
      session.supabase,
      input.shiftId,
      { role: session.user.role, deviceId: input.deviceId ?? null },
    )
    if (!reachable.ok) return NextResponse.json({ ok: false, error: reachable.error })
  }

  const { data, error } = await session.supabase.rpc("cancel_deposit_order", {
    p_key: input.idempotencyKey,
    p_order_id: orderId,
    p_reason: input.reason,
    p_shift_id: input.shiftId ?? undefined,
    p_cashier_id: session.user.id,
    p_device_id: input.deviceId ?? undefined,
  })

  if (error || !data) {
    return NextResponse.json({
      ok: false,
      error: error?.message ?? "The deposit could not be cancelled.",
    })
  }

  const result = data as {
    refunded?: unknown
    cash_refunded?: unknown
    released_units?: unknown
    already_cancelled?: boolean
  }

  if (!result.already_cancelled) {
    await logAudit(session.supabase, {
      type: "deposit.cancelled",
      refType: "deposit_order",
      refId: orderId,
      summary: `Deposit cancelled — ${formatRs(Number(result.refunded ?? 0))} refunded`,
      detail: {
        refunded: Number(result.refunded ?? 0),
        cashRefunded: Number(result.cash_refunded ?? 0),
        releasedUnits: Number(result.released_units ?? 0),
        shiftId: input.shiftId ?? undefined,
        reason: input.reason,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    refunded: Number(result.refunded ?? 0),
    cashRefunded: Number(result.cash_refunded ?? 0),
    releasedUnits: Number(result.released_units ?? 0),
    alreadyCancelled: result.already_cancelled === true,
  })
}
