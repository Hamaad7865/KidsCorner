import { shopToday } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * The back office's read side of layaway.
 *
 * The till writes; this page reads. Every figure comes off
 * `deposit_order_summaries` — paid, balance and collected units are computed
 * in SQL from the ledgers, so what the owner sees here can never drift from
 * what a cashier sees at the counter or what a cancellation will actually
 * refund.
 */

export const DEPOSITS_PAGE_SIZE = 100

export type DepositStatus = "open" | "collected" | "cancelled"

export type DepositRow = {
  id: number
  orderNo: string
  status: DepositStatus
  total: number
  balance: number
  /** Money handed over net of refunds — not reduced by allocations. */
  paymentsNet: number
  qtyTotal: number
  qtyCollected: number
  collectBy: string | null
  overdue: boolean
  note: string | null
  createdAt: string
  customerId: number
  customerName: string
  customerPhone: string | null
}

export type DepositsList = { rows: DepositRow[]; truncated: boolean }

export async function listDeposits(filters: {
  status?: string
  search?: string
} = {}): Promise<DepositsList> {
  const supabase = await createClient()

  let query = supabase
    .from("deposit_order_summaries")
    .select(`order_id, order_no, status, total, balance, payments_net,
             qty_total, qty_collected, collect_by, note, created_at,
             customer_id, customer_name, customer_phone`)
    .order("created_at", { ascending: false })
    .order("order_id", { ascending: false })

  if (filters.status === "open" || filters.status === "collected" || filters.status === "cancelled") {
    query = query.eq("status", filters.status)
  }

  // A phone number is the thing somebody reads out over the counter, so it
  // searches alongside the order number and the name. Escaped like listSales:
  // ilike treats % and _ as wildcards.
  const term = filters.search?.trim()
  if (term) {
    const escaped = term.replace(/[%_\\]/g, (c) => `\\${c}`)
    query = query.or(
      [
        `order_no.ilike.%${escaped}%`,
        `customer_name.ilike.%${escaped}%`,
        `customer_phone.ilike.%${escaped}%`,
      ].join(","),
    )
  }

  const { data, error } = await query.limit(DEPOSITS_PAGE_SIZE + 1)
  if (error) throw error

  const today = shopToday()
  const all = data ?? []
  const rows = all.slice(0, DEPOSITS_PAGE_SIZE).map<DepositRow>((row) => ({
    id: Number(row.order_id),
    orderNo: row.order_no ?? "",
    status: row.status as DepositStatus,
    total: Number(row.total),
    balance: Number(row.balance),
    paymentsNet: Number(row.payments_net ?? 0),
    qtyTotal: Number(row.qty_total ?? 0),
    qtyCollected: Number(row.qty_collected ?? 0),
    collectBy: row.collect_by,
    overdue:
      row.status === "open" && row.collect_by !== null && row.collect_by < today,
    note: row.note,
    createdAt: row.created_at ?? "",
    customerId: Number(row.customer_id),
    customerName: row.customer_name ?? "",
    customerPhone: row.customer_phone,
  }))

  return { rows, truncated: all.length > DEPOSITS_PAGE_SIZE }
}

/** Figures above the list: how much of the shop's shelf is promised, to whom. */
export type DepositsStats = {
  openCount: number
  openBalance: number
  overdueCount: number
  collectedThisMonth: number
}

export async function getDepositsStats(): Promise<DepositsStats> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("deposit_order_summaries")
    .select(`status, total, balance, collect_by, created_at, collected_at`)
    .limit(2000)
  if (error) throw error

  const today = shopToday()
  const monthStart = `${today.slice(0, 7)}-01`

  let openCount = 0
  let openBalance = 0
  let overdueCount = 0
  let collectedThisMonth = 0

  for (const row of data ?? []) {
    if (row.status === "open") {
      openCount += 1
      openBalance += Number(row.balance)
      if (row.collect_by !== null && row.collect_by < today) overdueCount += 1
    }
    if (
      row.status === "collected" &&
      typeof row.collected_at === "string" &&
      row.collected_at.slice(0, 10) >= monthStart
    ) {
      collectedThisMonth += Number(row.total)
    }
  }

  return { openCount, openBalance, overdueCount, collectedThisMonth }
}

export type DepositDetail = {
  id: number
  orderNo: string
  status: DepositStatus
  total: number
  balance: number
  paymentsNet: number
  unallocatedCredit: number
  collectBy: string | null
  overdue: boolean
  note: string | null
  createdAt: string
  collectedAt: string | null
  cancelledAt: string | null
  cancelledReason: string | null
  customerId: number
  customerName: string
  customerPhone: string | null
  items: {
    id: number
    description: string
    variantId: number
    qty: number
    collectedQty: number
    unitPrice: number
    discount: number
    lineTotal: number
  }[]
  payments: {
    id: number
    entryType: string
    amount: number
    method: string
    createdAt: string
    reason: string | null
  }[]
  pickups: {
    saleId: number
    saleNo: string
    saleDate: string
    total: number
    status: string
  }[]
}

export async function getDepositDetail(orderId: number): Promise<DepositDetail | null> {
  const supabase = await createClient()

  const [summaryResult, itemsResult, paymentsResult, pickupsResult] = await Promise.all([
    supabase
      .from("deposit_order_summaries")
      .select(`order_id, order_no, status, total, balance, payments_net,
               unallocated_credit, collect_by, note, created_at, collected_at,
               cancelled_at, cancelled_reason, customer_id, customer_name,
               customer_phone`)
      .eq("order_id", orderId)
      .maybeSingle(),
    supabase
      .from("deposit_order_items")
      .select(`id, variant_id, description, qty, collected_qty,
               unit_price, discount, line_total`)
      .eq("order_id", orderId)
      .order("id"),
    supabase
      .from("deposit_order_payments")
      .select(`id, entry_type, amount, method, created_at, reason`)
      .eq("order_id", orderId)
      .order("created_at")
      .order("id")
      .limit(400),
    supabase
      .from("sales")
      .select(`id, sale_no, sale_date, total, status`)
      .eq("deposit_order_id", orderId)
      .order("sale_date", { ascending: true })
      .limit(50),
  ])

  if (summaryResult.error) throw summaryResult.error
  const s = summaryResult.data
  if (!s) return null

  const today = shopToday()

  return {
    id: Number(s.order_id),
    orderNo: s.order_no ?? "",
    status: s.status as DepositStatus,
    total: Number(s.total),
    balance: Number(s.balance),
    paymentsNet: Number(s.payments_net ?? 0),
    unallocatedCredit: Number(s.unallocated_credit ?? 0),
    collectBy: s.collect_by,
    overdue: s.status === "open" && s.collect_by !== null && s.collect_by < today,
    note: s.note,
    createdAt: s.created_at ?? "",
    collectedAt: s.collected_at,
    cancelledAt: s.cancelled_at,
    cancelledReason: s.cancelled_reason,
    customerId: Number(s.customer_id),
    customerName: s.customer_name ?? "",
    customerPhone: s.customer_phone,
    items: (itemsResult.data ?? []).map((row) => ({
      id: row.id,
      description: row.description,
      variantId: Number(row.variant_id),
      qty: row.qty,
      collectedQty: row.collected_qty,
      unitPrice: Number(row.unit_price),
      discount: Number(row.discount),
      lineTotal: Number(row.line_total),
    })),
    payments: (paymentsResult.data ?? []).map((row) => ({
      id: row.id,
      entryType: row.entry_type,
      amount: Number(row.amount),
      method: row.method,
      createdAt: row.created_at,
      reason: row.reason,
    })),
    pickups: (pickupsResult.data ?? []).map((row) => ({
      saleId: row.id,
      saleNo: row.sale_no,
      saleDate: row.sale_date,
      total: Number(row.total),
      status: row.status,
    })),
  }
}
