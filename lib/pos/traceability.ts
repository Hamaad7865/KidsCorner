import { endOfShopDay, formatRs, startOfShopDay } from "@/lib/format"
import { methodLabel, periodFilter, resolveRange } from "@/lib/pos/cash-flow"
import { forDeviceShifts, type PosDevice } from "@/lib/pos/overview"
import { createClient } from "@/lib/supabase/server"

/**
 * Traceability — everything one till did over a period, in order.
 *
 * Ported from Carfectionist's tab of the same name. Carfectionist reads a
 * device-scoped event log; Kids Corner has no such log, and migration 016 says
 * why: an activity feed is built by reading the rows that already record what
 * happened, not by duplicating them into a log that can then disagree with the
 * thing it describes.
 *
 * So this feed is derived. Every event below is read from the ledger that
 * already holds it, and reaches this device through the same chain the money
 * does — sale to shift to device. Nothing here is written twice, and nothing
 * here can drift from the sale it describes.
 *
 * WHAT THIS CANNOT YET SHOW, and why. Carfectionist also traces terminal
 * starts, app version changes, operator sign-ins and device enable/disable.
 * Those live in `audit_events`, which records what changed but not which till
 * it was changed at — so attributing them to a device would be a guess. The
 * fix is a `device_id` column on `audit_events` fed by the till API, not a
 * heuristic here.
 */

export type TraceKind =
  | "till_open"
  | "float_in"
  | "payment"
  | "discount"
  | "receipt"
  | "refund"
  | "cash_out"
  | "till_close"

export type TraceEvent = {
  key: string
  /** ISO instant, for ordering and for the day bands. */
  at: string
  kind: TraceKind
  title: string
  detail: string | null
  /** Where the document lives, when the event concerns one. */
  href: string | null
}

/** How many events one view carries. A busy day is a few hundred. */
const TRACE_LIMIT = 400

type TraceInput = {
  shifts: {
    id: number
    /**
     * Null when the shift opened outside the window. A shift that opened on
     * Monday and closed on Tuesday belongs on Tuesday's feed for its closing
     * only — dating an "opened" line to Monday inside a Tuesday view would put
     * an event on a day the viewer did not ask about.
     */
    openedAt: string | null
    closedAt: string | null
    openingFloat: number
    openedByName: string | null
    closedByName: string | null
    variance: number
    nonCash: { method: string; amount: number }[]
  }[]
  payments: {
    id: number
    at: string
    method: string
    amount: number
    saleId: number
    saleNo: string
    cashierName: string | null
    voided: boolean
  }[]
  discounts: {
    id: number
    at: string
    saleId: number
    saleNo: string
    label: string
    amount: number
    approvedByName: string | null
  }[]
  prints: {
    id: number
    at: string
    saleId: number
    saleNo: string
    printedByName: string | null
  }[]
  refunds: {
    id: number
    at: string
    creditNo: string
    saleId: number
    total: number
    method: string
    reason: string
    cashierName: string | null
  }[]
  movements: {
    id: number
    at: string
    amount: number
    reason: string
    byName: string | null
  }[]
}

/**
 * Turns the ledgers into one ordered feed.
 *
 * Pure and exported so the ordering and the wording can be tested without a
 * database. Newest first, which is how somebody asking "what happened at that
 * till" reads it — they know roughly when, and they are scanning back.
 */
export function buildTrace(input: TraceInput): TraceEvent[] {
  const events: TraceEvent[] = []
  const parts = (...bits: (string | null | undefined)[]) =>
    bits.filter(Boolean).join(" · ") || null

  for (const shift of input.shifts) {
    if (shift.openedAt) {
      events.push({
        key: `so${shift.id}`,
        at: shift.openedAt,
        kind: "till_open",
        title: "Till opened",
        detail: shift.openedByName,
        href: null,
      })
      // Its own line rather than a trailing detail on "Till opened": the float
      // is a cash movement, and every other cash movement gets a row.
      events.push({
        key: `sf${shift.id}`,
        at: shift.openedAt,
        kind: "float_in",
        title: "Float in",
        detail: parts(formatRs(shift.openingFloat), shift.openedByName),
        href: null,
      })
    }

    if (shift.closedAt) {
      const toBank = shift.nonCash
        .map((n) => `${methodLabel(n.method)} ${formatRs(n.amount)} to bank`)
        .join(" · ")
      events.push({
        key: `sc${shift.id}`,
        at: shift.closedAt,
        kind: "till_close",
        title: "Till closed",
        detail: parts(`Variance ${formatRs(shift.variance)}`, toBank || null, shift.closedByName),
        href: null,
      })
    }
  }

  for (const payment of input.payments) {
    events.push({
      key: `p${payment.id}`,
      at: payment.at,
      kind: "payment",
      title: payment.voided ? "Payment on a voided sale" : `Payment · ${methodLabel(payment.method)}`,
      detail: parts(formatRs(payment.amount), payment.saleNo, payment.cashierName),
      href: `/sales/${payment.saleId}`,
    })
  }

  for (const discount of input.discounts) {
    events.push({
      key: `d${discount.id}`,
      at: discount.at,
      kind: "discount",
      title: "Discount",
      detail: parts(
        discount.saleNo,
        `${discount.label} — ${formatRs(discount.amount)} off`,
        // Who authorised it is the point of tracing a discount at all.
        discount.approvedByName ? `approved by ${discount.approvedByName}` : null,
      ),
      href: `/sales/${discount.saleId}`,
    })
  }

  for (const print of input.prints) {
    events.push({
      key: `r${print.id}`,
      at: print.at,
      kind: "receipt",
      title: "Receipt printed",
      detail: parts(print.saleNo, print.printedByName),
      href: `/sales/${print.saleId}`,
    })
  }

  for (const refund of input.refunds) {
    const exchange = refund.method === "exchange"
    events.push({
      key: `c${refund.id}`,
      at: refund.at,
      kind: "refund",
      title: exchange ? "Exchange" : `Refund · ${methodLabel(refund.method)}`,
      detail: parts(
        refund.creditNo,
        exchange ? "goods swapped, no money moved" : formatRs(refund.total),
        // The reason is required at the source, so it is always worth showing.
        `“${refund.reason}”`,
        refund.cashierName,
      ),
      href: `/sales/${refund.saleId}`,
    })
  }

  for (const movement of input.movements) {
    const paidIn = movement.amount > 0
    events.push({
      key: `m${movement.id}`,
      at: movement.at,
      kind: paidIn ? "float_in" : "cash_out",
      title: paidIn ? "Paid in" : "Disbursement",
      detail: parts(formatRs(movement.amount), movement.reason, movement.byName),
      href: null,
    })
  }

  // Newest first, by instant — never by string, since these arrive at +00:00
  // and the shop's day is +04:00. Ties break on key so two events recorded in
  // the same millisecond keep a stable order between renders.
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key))

  return events.slice(0, TRACE_LIMIT)
}

export type DeviceTrace = {
  from: string
  to: string
  events: TraceEvent[]
}

export async function getDeviceTrace(
  device: PosDevice,
  opts: { from?: string; to?: string } = {},
): Promise<DeviceTrace> {
  const supabase = await createClient()
  const { from, to } = resolveRange(opts)
  const inPeriod = periodFilter(from, to)

  const { data: shiftRows } = await forDeviceShifts(
    supabase
      .from("shifts")
      .select(
        `id, opened_at, closed_at, opening_float, variance,
         opener:profiles!shifts_opened_by_fkey ( full_name ),
         closer:profiles!shifts_closed_by_fkey ( full_name )`,
      )
      .order("opened_at", { ascending: false })
      .limit(400),
    device,
  )

  // Any shift that was open at some point in the window, so a sale rung up
  // inside it is reachable even when the shift itself opened days earlier.
  const startMs = Date.parse(startOfShopDay(from))
  const endMs = Date.parse(endOfShopDay(to))
  const shifts = (shiftRows ?? []).filter(
    (s) =>
      Date.parse(s.opened_at) <= endMs &&
      (s.closed_at === null || Date.parse(s.closed_at) >= startMs),
  )

  if (shifts.length === 0) return { from, to, events: [] }

  const shiftIds = shifts.map((s) => s.id)

  const [{ data: saleRows }, { data: movementRows }, { data: creditRows }] =
    await Promise.all([
      supabase
        .from("sales")
        .select(
          `id, sale_no, sale_date, status, shift_id,
           profiles ( full_name ),
           sale_payments ( id, method, amount, created_at ),
           sale_discounts ( id, label, amount, approver:profiles ( full_name ) ),
           receipt_prints ( id, printed_at, printer:profiles ( full_name ) )`,
        )
        .in("shift_id", shiftIds)
        .order("sale_date", { ascending: false })
        .limit(1_000),
      supabase
        .from("till_movements")
        .select("id, shift_id, amount, reason, created_at, profiles ( full_name )")
        .in("shift_id", shiftIds),
      supabase
        .from("credit_notes")
        .select(
          `id, credit_no, sale_id, created_at, total, refund_method, reason,
           profiles ( full_name )`,
        )
        .in("shift_id", shiftIds),
    ])

  const payments: TraceInput["payments"] = []
  const discounts: TraceInput["discounts"] = []
  const prints: TraceInput["prints"] = []

  for (const sale of saleRows ?? []) {
    const cashierName = sale.profiles?.full_name ?? null

    for (const payment of sale.sale_payments ?? []) {
      const at = payment.created_at ?? sale.sale_date
      if (!inPeriod(at)) continue
      payments.push({
        id: payment.id,
        at,
        method: payment.method,
        amount: Number(payment.amount),
        saleId: sale.id,
        saleNo: sale.sale_no,
        cashierName,
        voided: sale.status === "void",
      })
    }

    // A discount and a print carry no timestamp of their own on the discount
    // side, so the sale's stands in — they happened as it was rung up.
    for (const discount of sale.sale_discounts ?? []) {
      if (!inPeriod(sale.sale_date)) continue
      discounts.push({
        id: discount.id,
        at: sale.sale_date,
        saleId: sale.id,
        saleNo: sale.sale_no,
        label: discount.label,
        amount: Number(discount.amount),
        approvedByName: discount.approver?.full_name ?? null,
      })
    }

    for (const print of sale.receipt_prints ?? []) {
      if (!inPeriod(print.printed_at)) continue
      prints.push({
        id: print.id,
        at: print.printed_at,
        saleId: sale.id,
        saleNo: sale.sale_no,
        printedByName: print.printer?.full_name ?? null,
      })
    }
  }

  // The non-cash split a closing line reports, per shift.
  const nonCashByShift = new Map<number, Map<string, number>>()
  for (const sale of saleRows ?? []) {
    if (sale.status === "void" || sale.shift_id === null) continue
    for (const payment of sale.sale_payments ?? []) {
      if (payment.method === "cash") continue
      const bank = nonCashByShift.get(sale.shift_id) ?? new Map<string, number>()
      bank.set(payment.method, (bank.get(payment.method) ?? 0) + Number(payment.amount))
      nonCashByShift.set(sale.shift_id, bank)
    }
  }

  return {
    from,
    to,
    events: buildTrace({
      // Only the ends that fall inside the window produce an event. A shift
      // that merely spans the period opened and closed on other days, and its
      // sales are what belong here, not its bookends.
      shifts: shifts.map((s) => ({
        id: s.id,
        openedAt: inPeriod(s.opened_at) ? s.opened_at : null,
        closedAt: inPeriod(s.closed_at) ? s.closed_at : null,
        openingFloat: Number(s.opening_float),
        openedByName: s.opener?.full_name ?? null,
        closedByName: s.closer?.full_name ?? null,
        variance: Number(s.variance ?? 0),
        nonCash: [...(nonCashByShift.get(s.id) ?? new Map<string, number>())]
          .filter(([, amount]) => amount > 0)
          .map(([method, amount]) => ({ method, amount })),
      })),
      payments,
      discounts,
      prints,
      refunds: (creditRows ?? [])
        .filter((c) => inPeriod(c.created_at))
        .map((c) => ({
          id: c.id,
          at: c.created_at,
          creditNo: c.credit_no,
          saleId: c.sale_id,
          total: Number(c.total),
          method: c.refund_method,
          reason: c.reason,
          cashierName: c.profiles?.full_name ?? null,
        })),
      movements: (movementRows ?? [])
        .filter((m) => inPeriod(m.created_at))
        .map((m) => ({
          id: m.id,
          at: m.created_at,
          amount: Number(m.amount),
          reason: m.reason,
          byName: m.profiles?.full_name ?? null,
        })),
    }),
  }
}
