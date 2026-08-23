import { NextResponse } from "next/server"

import { apiError, requireTillSession } from "@/lib/api/till-session"
import { round2 } from "@/lib/format"

/**
 * One deposit order in full, for the till's layaway screen.
 *
 * Everything a visit needs to act on: what is still held (per line, at the
 * FROZEN prices the order opened with), what has been paid and by which
 * method, and the pickup sales already written against it. The money figures
 * come from `deposit_order_summaries` — computed in SQL, never cached here.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const orderId = Number((await params).id)
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return apiError("That is not a deposit number.", 400)
  }

  const [summaryResult, itemsResult, paymentsResult, pickupsResult] = await Promise.all([
    session.supabase
      .from("deposit_order_summaries")
      .select(`order_id, order_no, status, total, balance, unallocated_credit,
               payments_net, qty_total, qty_collected, collect_by, note,
               created_at, collected_at, cancelled_at, cancelled_reason,
               customer_id, customer_name, customer_phone`)
      .eq("order_id", orderId)
      .maybeSingle(),
    session.supabase
      .from("deposit_order_items")
      .select(`id, variant_id, description, qty, collected_qty,
               unit_price, discount, discount_taken`)
      .eq("order_id", orderId)
      .order("id"),
    session.supabase
      .from("deposit_order_payments")
      .select(`id, entry_type, amount, method, created_at, reason`)
      .eq("order_id", orderId)
      .order("created_at")
      .order("id")
      .limit(200),
    session.supabase
      .from("sales")
      .select(`id, sale_no, sale_date, total, status`)
      .eq("deposit_order_id", orderId)
      .order("sale_date", { ascending: true })
      .limit(50),
  ])

  const { data: summary } = summaryResult
  if (!summary) return apiError("That deposit was not found.", 404)

  const today = new Date().toISOString().slice(0, 10)
  const collectBy = (summary.collect_by as string | null) ?? null

  return NextResponse.json({
    ok: true,
    deposit: {
      orderId: Number(summary.order_id),
      orderNo: summary.order_no as string,
      status: summary.status as string,
      total: Number(summary.total),
      balance: Number(summary.balance),
      paidNet: Number(summary.payments_net ?? 0),
      /** Money in hand not yet claimed by a pickup — what today's visit can spend. */
      unallocatedCredit: Number(summary.unallocated_credit ?? 0),
      collectBy,
      overdue:
        summary.status === "open" && collectBy !== null && collectBy < today,
      note: (summary.note as string | null) ?? null,
      createdAt: summary.created_at as string,
      collectedAt: (summary.collected_at as string | null) ?? null,
      cancelledAt: (summary.cancelled_at as string | null) ?? null,
      cancelledReason: (summary.cancelled_reason as string | null) ?? null,
      customerId: Number(summary.customer_id),
      customerName: (summary.customer_name as string) ?? "",
      customerPhone: (summary.customer_phone as string | null) ?? null,
    },
    items: (itemsResult.data ?? []).map((row) => ({
      itemId: Number(row.id),
      variantId: Number(row.variant_id),
      description: row.description as string,
      qty: Number(row.qty),
      collectedQty: Number(row.collected_qty),
      remaining: Number(row.qty) - Number(row.collected_qty),
      unitPrice: Number(row.unit_price),
      discount: Number(row.discount),
    })),
    payments: (paymentsResult.data ?? []).map((row) => ({
      id: Number(row.id),
      entryType: row.entry_type as string,
      amount: round2(Number(row.amount)),
      method: row.method as string,
      createdAt: row.created_at as string,
      reason: (row.reason as string | null) ?? null,
    })),
    pickups: (pickupsResult.data ?? []).map((row) => ({
      saleId: Number(row.id),
      saleNo: row.sale_no as string,
      saleDate: row.sale_date as string,
      total: Number(row.total),
      status: row.status as string,
    })),
  })
}
