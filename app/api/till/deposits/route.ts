import { NextResponse } from "next/server"

import { logAudit } from "@/lib/activity/audit"
import { apiError, requireTillSession } from "@/lib/api/till-session"
import { assertShiftOpenFor } from "@/lib/pos/shift-core"
import { verifyApproval } from "@/lib/pos/sale-core"
import { createDepositSchema } from "@/lib/deposits/core"
import { formatRs } from "@/lib/format"

/**
 * The deposit orders a till can see.
 *
 * GET  — the layaway list: live ones by default, searchable by order number,
 *        customer name or phone, so "is my cot still on hold?" takes one look
 *        rather than a paper hunt. Served from `deposit_order_summaries` so
 *        the balances here and the back office's are computed once, in SQL.
 *
 * POST — opens an order. Prices are frozen by the RPC from the catalogue,
 *        stock reserves through real movements, first money (if any) lands in
 *        the drawer's books the moment it lands in the drawer. A discounted
 *        line needs a manager's PIN verified HERE, at the only boundary that
 *        cannot be skipped — same rule as a sale's line discount.
 */

/** A positive integer, or null — anything else is treated as absent. */
function customerIdParam(raw: string | null): number | null {
  if (!/^\d+$/.test(raw ?? "")) return null
  const id = Number(raw)
  return id > 0 ? id : null
}

export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const url = new URL(request.url)
  const q = (url.searchParams.get("q") ?? "").trim()
  const customerId = customerIdParam(url.searchParams.get("customerId"))
  // A profile wants the customer's WHOLE deposit history, so browsing one
  // customer defaults to every status; the till's own list still defaults to
  // the live ones. An explicit ?status= wins in both cases.
  const status = url.searchParams.get("status") ?? (customerId !== null ? "all" : "open")

  let query = session.supabase
    .from("deposit_order_summaries")
    .select(
      `order_id, order_no, status, total, balance, unallocated_credit,
       qty_total, qty_collected, collect_by, created_at,
       customer_id, customer_name, customer_phone`,
    )
    .order("created_at", { ascending: false })
    .limit(50)

  if (customerId !== null) query = query.eq("customer_id", customerId)

  if (status === "open" || status === "collected" || status === "cancelled") {
    query = query.eq("status", status)
  }

  if (q.length > 0) {
    const escaped = q.replace(/[%,()]/g, " ")
    query = query.or(
      [
        `order_no.ilike.%${escaped}%`,
        `customer_name.ilike.%${escaped}%`,
        `customer_phone.ilike.%${escaped}%`,
      ].join(","),
    )
  }

  const { data, error } = await query
  if (error) return apiError(error.message, 500)

  const today = new Date().toISOString().slice(0, 10)
  const deposits = (data ?? []).map((row) => ({
    orderId: Number(row.order_id),
    orderNo: row.order_no as string,
    status: row.status as string,
    total: Number(row.total),
    balance: Number(row.balance),
    unitsTotal: Number(row.qty_total),
    unitsCollected: Number(row.qty_collected),
    collectBy: (row.collect_by as string | null) ?? null,
    overdue:
      row.status === "open" &&
      typeof row.collect_by === "string" &&
      row.collect_by < today,
    createdAt: row.created_at as string,
    customerId: Number(row.customer_id),
    customerName: (row.customer_name as string) ?? "",
    customerPhone: (row.customer_phone as string | null) ?? null,
  }))

  return NextResponse.json({ ok: true, deposits })
}

export async function POST(request: Request) {
  // TEMPORARY diagnostic: today's refusals reach the till masked as "no
  // connection", so every branch writes what actually happened to a file we
  // can read. Remove once the deposit flow is proven.
  const diag = (line: unknown) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("fs").appendFileSync(
        "C:/Projects/KidsCorner/till-route-debug.log",
        JSON.stringify({ t: new Date().toISOString(), line }) + "\n",
      )
    } catch { /* diagnostics must never break the route */ }
  }
  diag({ at: "POST /api/till/deposits", hasAuth: Boolean(request.headers.get("authorization")) })

  const session = await requireTillSession(request)
  if ("response" in session) {
    diag({ at: "session rejected" })
    return session.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    diag({ at: "body not json" })
    return apiError("Malformed request.", 400)
  }

  const parsed = createDepositSchema.safeParse(body)
  if (!parsed.success) {
    diag({ at: "zod refused", issues: parsed.error.issues, body })
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid deposit." },
      // Schema failures are client bugs; business refusals stay 200 so a till
      // never mistakes "the shelf is empty" for "the request failed".
      { status: 400 },
    )
  }
  diag({ at: "validated", items: parsed.data.items.length })

  const input = parsed.data
  const hasDiscount = input.items.some((item) => item.discount > 0)

  /**
   * Money off needs a manager before anything else happens — the RPC will
   * refuse it too, but this check is what tells the till to show its PIN pad
   * rather than surface a raw refusal for a basket the cashier built.
   */
  let approvedBy: string | null = null
  if (hasDiscount) {
    const verified = await verifyApproval(session.supabase, input.approval, "discount")
    if ("error" in verified) return NextResponse.json({ ok: false, error: verified.error })
    approvedBy = verified.managerId
  }

  if (input.shiftId !== undefined && input.shiftId !== null) {
    // WHERE the order's cash would land is a claim like any sale's. Existence,
    // openness and (for staff roles) drawer ownership are checked the same way.
    const reachable = await assertShiftOpenFor(
      session.supabase,
      input.shiftId,
      { role: session.user.role, deviceId: input.deviceId ?? null },
    )
    if (!reachable.ok) return NextResponse.json({ ok: false, error: reachable.error })
  }

  const payment = input.payment
  if (payment?.method === "cash" && input.shiftId == null) {
    return NextResponse.json({
      ok: false,
      error: "Cash belongs in a drawer — open the till before taking a deposit.",
    })
  }

  const { data, error } = await session.supabase.rpc("create_deposit_order", {
    p_key: input.idempotencyKey,
    p_customer_id: input.customerId,
    p_items: input.items.map((item) => ({
      variant_id: item.variantId,
      qty: item.qty,
      discount: item.discount,
    })),
    p_payment: payment
      ? {
          method: payment.method,
          amount: payment.amount,
          tendered: payment.tendered ?? undefined,
        }
      : null,
    p_collect_by: input.collectBy ?? undefined,
    p_note: input.note ?? undefined,
    p_shift_id: input.shiftId ?? undefined,
    p_cashier_id: session.user.id,
    p_device_id: input.deviceId ?? undefined,
    p_approved_by: approvedBy ?? undefined,
  })

  if (error || !data) {
    diag({ at: "rpc refused", error: error?.message, data })
    return NextResponse.json({
      ok: false,
      error: error?.message ?? "The deposit could not be opened.",
    })
  }

  const result = data as {
    order_id?: unknown
    order_no?: unknown
    total?: unknown
    balance?: unknown
    replayed?: boolean
  }

  const orderId = Number(result.order_id ?? 0)
  const orderNo = String(result.order_no ?? "")

  if (!result.replayed) {
    // Best effort, like every audit: the order exists either way.
    await logAudit(session.supabase, {
      type: "deposit.created",
      refType: "deposit_order",
      refId: orderId,
      summary: `${orderNo} opened at the till — ${formatRs(Number(result.total ?? 0))} held for ${input.customerId}`,
      detail: {
        orderNo,
        customerId: input.customerId,
        items: input.items.length,
        downPayment: payment?.amount ?? 0,
        method: payment?.method ?? null,
        shiftId: input.shiftId ?? undefined,
        collectBy: input.collectBy ?? null,
        approvedBy,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    orderId,
    orderNo,
    total: Number(result.total ?? 0),
    balance: Number(result.balance ?? 0),
    replayed: result.replayed === true,
  })
}
