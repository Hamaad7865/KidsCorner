import { isCollectedMethod, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/db-enums"
import { endOfShopDay, round2, shopToday, startOfShopDay } from "@/lib/format"
import { forDeviceShifts, type PosDevice } from "@/lib/pos/overview"
import { createClient } from "@/lib/supabase/server"

/**
 * Cash flow for one till — ported from Carfectionist's Point of Sale module.
 *
 * Two sections, each driven by its own date control, exactly as the owner knows
 * them there:
 *
 *   HISTORY, on a single reference date. The closure snapshot saved when a till
 *   was cashed up that day: what it opened with, what went in and out, what was
 *   counted, and what the variance was.
 *
 *   CASH MOVEMENTS, over a from–to period. Every payment into this till and
 *   every payment out of it, listed row by row with a running total on each.
 *
 * The shape of Kids Corner's ledger differs from Carfectionist's in one way
 * that matters here, and the translation is the whole job of this file.
 * Carfectionist reverses a payment by writing a mirrored negative payment row,
 * so its outflows are simply the negative rows. Kids Corner never writes a
 * negative payment: a return is a `credit_notes` row carrying its own
 * `refund_method`. So the outflow side is assembled from three different
 * ledgers rather than read from one, and the rules for each are below.
 *
 * What is NOT hidden, because a ledger that hides a movement stops
 * reconciling: a voided sale's payments and an exchange credit note both still
 * appear. They are struck through and left out of the totals — the row is the
 * evidence, the total is the money.
 */

/** How far back the shift window reaches. Roughly a year at two shifts a day. */
const SHIFT_WINDOW = 400

/**
 * How many shifts may feed one view. A range wide enough to exceed this is
 * reported as truncated rather than quietly clipped — a cash-flow page that
 * drops rows without saying so is worse than one that admits its limit.
 */
const MAX_FLOW_SHIFTS = 200

/**
 * How many rows one ledger read returns, fetched one over so a full page is
 * distinguishable from an exact fit.
 *
 * These reads carried no limit at all, which does NOT mean unlimited: PostgREST
 * applies its own max-rows cap and returns the clipped set with no indication
 * it did so. A wide period silently lost its oldest payments, the inflow total
 * came out short, and `truncated` stayed false because it only ever counted
 * shifts.
 */
const FLOW_ROW_CAP = 2000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type OutflowType = "Refund" | "Exchange" | "Disbursement" | "Bank deposit"

type FlowRow = {
  key: string
  /** ISO instant, for ordering. */
  at: string
  byName: string | null
  method: string
  /** Positive on an inflow, negative on an outflow. */
  amount: number
  /**
   * Recorded, but no money survived it — a voided sale, or an exchange where
   * goods swapped and nothing moved. Shown struck rather than dropped, and
   * excluded from the period total.
   */
  struck: boolean
}

export type Inflow = FlowRow & {
  /** The sale number, or a till movement's reason. */
  reference: string | null
  saleId: number | null
}

export type Outflow = FlowRow & {
  type: OutflowType
  comment: string
  saleId: number | null
}

/** The snapshot a till closure leaves behind. */
export type Closure = {
  shiftId: number
  closedAt: string
  closedByName: string | null
  openingFloat: number
  /** Cash payments taken, plus anything paid into the drawer. */
  cashIn: number
  /** Cash refunds and disbursements. Negative. */
  cashOut: number
  counted: number
  variance: number
  /** Takings that never reached the drawer — card, Juice, bank. */
  nonCash: { method: string; amount: number }[]
  /**
   * Sales value billed to customer accounts during this shift.
   *
   * Kept apart from `nonCash` because it is not takings at all: nothing
   * arrived, by any rail. It is here so a closure that rang up Rs 12,000 and
   * counted Rs 4,000 can say where the other Rs 8,000 went, instead of leaving
   * the owner to conclude the drawer is short.
   */
  onAccount: number
  /** Of `cashOut`, the part that was a refund. Negative. */
  refunded: number
  /** Of `cashOut`, the part that was a pay-out. Negative. */
  disbursed: number
}

export type CashFlow = {
  refDate: string
  closures: Closure[]
  from: string
  to: string
  inflows: Inflow[]
  outflows: Outflow[]
  /** The period held more shifts than one view will read. */
  truncated: boolean
}

export function methodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method
}

/**
 * The reference date and the period, from whatever arrived in the URL.
 *
 * Pure and exported so the awkward cases are testable: a missing date falls
 * back to today, a half-given range borrows its other end, and a range typed
 * backwards is swapped rather than returning nothing. A picker that silently
 * shows an empty period because the dates were the wrong way round is the kind
 * of thing that gets read as "no takings that week".
 */
export function resolveRange(
  opts: { ref?: string; from?: string; to?: string },
  today: string = shopToday(),
): { refDate: string; from: string; to: string } {
  const valid = (value?: string) => (value && DATE_RE.test(value) ? value : undefined)

  const refDate = valid(opts.ref) ?? today
  let from = valid(opts.from) ?? valid(opts.to) ?? today
  let to = valid(opts.to) ?? from
  if (to < from) [from, to] = [to, from]

  return { refDate, from, to }
}

/**
 * Is this instant inside the shop's `from`–`to` days?
 *
 * Compares instants, never strings. Postgres hands timestamps back at +00:00
 * and the shop's day boundaries are written at +04:00, so `"...T21:14+00:00"`
 * sorts BEFORE `"2026-07-30T00:00+04:00"` as text while being four hours
 * *after* it in real time. Comparing the strings silently drops every sale
 * rung up between midnight and 4am — including the close of a till that
 * cashed up at 01:15.
 */
export function periodFilter(from: string, to: string): (at: string | null) => boolean {
  const fromMs = Date.parse(startOfShopDay(from))
  const toMs = Date.parse(endOfShopDay(to))

  return (at) => {
    if (!at) return false
    const ms = Date.parse(at)
    return Number.isFinite(ms) && ms >= fromMs && ms <= toMs
  }
}

/**
 * What the period actually moved.
 *
 * Struck rows are skipped. They are on screen because they happened; they are
 * out of this figure because the money did not.
 */
export function flowTotal(rows: FlowRow[]): number {
  return round2(rows.reduce((sum, row) => (row.struck ? sum : sum + row.amount), 0))
}

/**
 * The non-cash takings of a shift, booked out of the register at close.
 *
 * Carfectionist calls these automatic bank deposits, and they are what make the
 * two columns agree: card and Juice money arrives as an inflow during the day
 * but is never in the drawer at night, so without a matching outflow the period
 * appears to hold cash it does not have.
 *
 * A sale on account is excluded, and the distinction is the reason
 * `isCollectedMethod` exists. Card money is real money that went somewhere
 * else; account money has not been paid at all, so "deposit" is the wrong verb
 * twice over. Left in, every credit sale invented an outflow of money the shop
 * never received — the period showed a payment in and a deposit out for the
 * same nonexistent cash, which nets to zero and is exactly the kind of
 * cancelling error nobody notices until the bank statement disagrees.
 *
 * Only positive net methods produce a row. A method that nets to nothing has
 * nothing to deposit, and "Card Rs 0.00 straight to the bank" is noise.
 */
export function bankDeposits(
  shift: { shiftId: number; closedAt: string; closedByName: string | null },
  payments: { method: string; amount: number; struck: boolean }[],
): Outflow[] {
  const net = new Map<string, number>()
  for (const payment of payments) {
    if (payment.method === "cash" || payment.struck) continue
    if (!isCollectedMethod(payment.method)) continue
    net.set(payment.method, round2((net.get(payment.method) ?? 0) + payment.amount))
  }

  return [...net.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([method, amount]) => ({
      key: `d${shift.shiftId}:${method}`,
      at: shift.closedAt,
      byName: shift.closedByName,
      method,
      amount: round2(-amount),
      struck: false,
      type: "Bank deposit" as const,
      comment: "Automatic bank deposit",
      saleId: null,
    }))
}

type ShiftRow = {
  id: number
  opened_at: string
  closed_at: string | null
  opening_float: number | string
  counted_cash: number | string | null
  variance: number | string | null
  closer: { full_name: string } | null
}

export async function getDeviceCashFlow(
  device: PosDevice,
  opts: { ref?: string; from?: string; to?: string } = {},
): Promise<CashFlow> {
  const supabase = await createClient()
  const { refDate, from, to } = resolveRange(opts)

  const inPeriod = periodFilter(from, to)
  const onRefDate = periodFilter(refDate, refDate)
  const periodEndMs = Date.parse(endOfShopDay(to))
  const periodStartMs = Date.parse(startOfShopDay(from))

  // Every shift this till has run. Filtered in memory rather than in SQL
  // because two different windows are wanted from the same set — the period
  // and the reference day — and a shop runs one or two shifts a day.
  const shiftQuery = supabase
    .from("shifts")
    .select(
      `id, opened_at, closed_at, opening_float, counted_cash, variance,
       closer:profiles!shifts_closed_by_fkey ( full_name )`,
    )
    .order("opened_at", { ascending: false })
    .limit(SHIFT_WINDOW)

  const { data: shiftRows } = await forDeviceShifts(shiftQuery, device)

  const shifts = (shiftRows ?? []) as unknown as ShiftRow[]

  // A shift is in play if it was open at any point during the period: opened
  // before the period ended, and not already closed before it began.
  const overlapsPeriod = (shift: ShiftRow) =>
    Date.parse(shift.opened_at) <= periodEndMs &&
    (shift.closed_at === null || Date.parse(shift.closed_at) >= periodStartMs)
  const closedOnRefDate = (shift: ShiftRow) => onRefDate(shift.closed_at)

  const periodShifts = shifts.filter(overlapsPeriod)
  const refShifts = shifts.filter(closedOnRefDate)

  const flowShiftIds = [...new Set([...periodShifts, ...refShifts].map((s) => s.id))]
  const truncated = flowShiftIds.length > MAX_FLOW_SHIFTS
  const shiftIds = flowShiftIds.slice(0, MAX_FLOW_SHIFTS)

  if (shiftIds.length === 0) {
    return { refDate, closures: [], from, to, inflows: [], outflows: [], truncated }
  }

  // Deliberately not date-filtered. A closure's bank deposit is the whole
  // shift's non-cash takings, and a shift that opened yesterday and closed
  // inside the period would otherwise deposit only the part of itself the
  // window happened to cover.
  const [{ data: saleRows }, { data: movementRows }, { data: creditRows }] =
    await Promise.all([
      supabase
        .from("sales")
        .select(
          `id, sale_no, sale_date, status, shift_id,
           profiles ( full_name ),
           sale_payments ( id, method, amount, created_at )`,
        )
        .in("shift_id", shiftIds)
        .order("sale_date", { ascending: false })
        .limit(FLOW_ROW_CAP + 1),
      supabase
        .from("till_movements")
        .select("id, shift_id, amount, reason, created_at, profiles ( full_name )")
        .in("shift_id", shiftIds)
        .order("created_at", { ascending: false })
        .limit(FLOW_ROW_CAP + 1),
      // Attributed by the credit note's OWN shift, not the originating sale's.
      // The drawer that pays a refund out is the drawer that is short at close,
      // which may not be the one that took the money days earlier — the same
      // rule migration 022 fixed on the Z report.
      supabase
        .from("credit_notes")
        .select(
          `id, credit_no, sale_id, shift_id, created_at, total, refund_method, reason,
           profiles!credit_notes_cashier_id_fkey ( full_name ),
           sales!credit_notes_sale_id_fkey ( sale_no )`,
        )
        .in("shift_id", shiftIds)
        .order("created_at", { ascending: false })
        .limit(FLOW_ROW_CAP + 1),
    ])

  type PaymentFact = {
    key: string
    at: string
    method: string
    amount: number
    struck: boolean
    shiftId: number
    saleId: number
    saleNo: string
    cashierName: string | null
  }

  // Any ledger hitting the cap makes the period's totals partial, so the
  // notice on screen has to cover all three, not just the shift count.
  const clipped =
    (saleRows?.length ?? 0) > FLOW_ROW_CAP ||
    (movementRows?.length ?? 0) > FLOW_ROW_CAP ||
    (creditRows?.length ?? 0) > FLOW_ROW_CAP

  const payments: PaymentFact[] = []
  for (const sale of saleRows ?? []) {
    // `sales.shift_id` is nullable in the schema, and the filter above already
    // excludes nulls. Guarded rather than asserted so a future query change
    // cannot quietly file a shiftless sale under whichever shift sorts first.
    if (sale.shift_id === null) continue
    for (const payment of sale.sale_payments ?? []) {
      payments.push({
        key: `p${payment.id}`,
        // A payment row carries its own timestamp; the sale's date is the
        // fallback for any written before that column existed.
        at: payment.created_at ?? sale.sale_date,
        method: payment.method,
        amount: round2(Number(payment.amount)),
        struck: sale.status === "void",
        shiftId: sale.shift_id,
        saleId: sale.id,
        saleNo: sale.sale_no,
        cashierName: sale.profiles?.full_name ?? null,
      })
    }
  }

  // ---------------------------------------------------------------- inflows

  /**
   * A sale on account is not an inflow.
   *
   * It is left out of this list rather than shown struck, which is the
   * treatment a voided sale gets: `struck` renders a "Void" badge, and labelling
   * a perfectly good account sale as void would be worse than omitting it. The
   * money is chased through the receivables report instead, and the closure
   * below carries the shift's on-account total so a day still explains itself.
   */
  const inflows: Inflow[] = payments
    .filter((payment) => isCollectedMethod(payment.method) && inPeriod(payment.at))
    .map((payment) => ({
      key: payment.key,
      at: payment.at,
      byName: payment.cashierName,
      method: payment.method,
      amount: payment.amount,
      struck: payment.struck,
      reference: payment.saleNo,
      saleId: payment.saleId,
    }))

  // A positive till movement is money put INTO the drawer — a top-up float, or
  // change brought from the safe. It belongs on the inflow side; only the
  // negative ones are pay-outs.
  for (const movement of movementRows ?? []) {
    const amount = round2(Number(movement.amount))
    if (amount <= 0 || !inPeriod(movement.created_at)) continue
    inflows.push({
      key: `mi${movement.id}`,
      at: movement.created_at,
      byName: movement.profiles?.full_name ?? null,
      method: "cash",
      amount,
      struck: false,
      reference: movement.reason,
      saleId: null,
    })
  }

  // Newest first, by instant. Ordering the ISO strings would work only while
  // every row came back at the same UTC offset — a fragile thing to rely on.
  inflows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  // --------------------------------------------------------------- outflows

  const outflows: Outflow[] = []

  for (const note of creditRows ?? []) {
    if (!inPeriod(note.created_at)) continue
    // An exchange swaps goods and moves no money. It is a real document and it
    // stays on the ledger, struck, so the refunds report and this page cannot
    // disagree about how many returns happened.
    const isExchange = note.refund_method === "exchange"
    outflows.push({
      key: `c${note.id}`,
      at: note.created_at,
      byName: note.profiles?.full_name ?? null,
      method: isExchange ? "cash" : note.refund_method,
      amount: round2(-Number(note.total)),
      struck: isExchange,
      type: isExchange ? "Exchange" : "Refund",
      comment: [note.credit_no, note.sales?.sale_no, note.reason]
        .filter(Boolean)
        .join(" · "),
      saleId: note.sale_id,
    })
  }

  for (const movement of movementRows ?? []) {
    const amount = round2(Number(movement.amount))
    if (amount >= 0 || !inPeriod(movement.created_at)) continue
    outflows.push({
      key: `mo${movement.id}`,
      at: movement.created_at,
      byName: movement.profiles?.full_name ?? null,
      method: "cash",
      amount,
      struck: false,
      type: "Disbursement",
      comment: movement.reason,
      saleId: null,
    })
  }

  const paymentsByShift = new Map<number, PaymentFact[]>()
  for (const payment of payments) {
    const list = paymentsByShift.get(payment.shiftId) ?? []
    list.push(payment)
    paymentsByShift.set(payment.shiftId, list)
  }

  for (const shift of periodShifts) {
    if (shift.closed_at === null || !inPeriod(shift.closed_at)) continue
    outflows.push(
      ...bankDeposits(
        {
          shiftId: shift.id,
          closedAt: shift.closed_at,
          closedByName: shift.closer?.full_name ?? null,
        },
        paymentsByShift.get(shift.id) ?? [],
      ),
    )
  }

  outflows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  // --------------------------------------------------------------- closures

  const closures: Closure[] = refShifts.map((shift) => {
    const shiftPayments = paymentsByShift.get(shift.id) ?? []
    const movements = (movementRows ?? []).filter((m) => m.shift_id === shift.id)
    const credits = (creditRows ?? []).filter((c) => c.shift_id === shift.id)

    let cashIn = 0
    let onAccount = 0
    const nonCash = new Map<string, number>()
    for (const payment of shiftPayments) {
      if (payment.struck) continue
      // Billed, not taken. Totalled separately so it can be shown as the
      // explanation for a shift whose sales exceed everything it collected,
      // and kept out of `nonCash` so it is never read as takings.
      if (!isCollectedMethod(payment.method)) {
        onAccount = round2(onAccount + payment.amount)
        continue
      }
      if (payment.method === "cash") cashIn = round2(cashIn + payment.amount)
      else nonCash.set(payment.method, round2((nonCash.get(payment.method) ?? 0) + payment.amount))
    }

    let disbursed = 0
    for (const movement of movements) {
      const amount = round2(Number(movement.amount))
      if (amount > 0) cashIn = round2(cashIn + amount)
      else disbursed = round2(disbursed + amount)
    }

    // Only cash refunds leave the drawer. A card refund goes back down the card
    // rail and an exchange moves nothing, so neither belongs in the cash-out
    // figure the count is reconciled against.
    const refunded = round2(
      -credits
        .filter((c) => c.refund_method === "cash")
        .reduce((sum, c) => sum + Number(c.total), 0),
    )

    return {
      shiftId: shift.id,
      closedAt: shift.closed_at!,
      closedByName: shift.closer?.full_name ?? null,
      openingFloat: round2(Number(shift.opening_float)),
      cashIn,
      cashOut: round2(disbursed + refunded),
      counted: round2(Number(shift.counted_cash ?? 0)),
      variance: round2(Number(shift.variance ?? 0)),
      nonCash: [...nonCash.entries()]
        .filter(([, amount]) => amount > 0)
        .map(([method, amount]) => ({ method, amount })),
      onAccount,
      refunded,
      disbursed,
    }
  })

  return { refDate, closures, from, to, inflows, outflows, truncated: truncated || clipped }
}
