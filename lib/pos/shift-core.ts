import { round2 } from "@/lib/format"
import type { TillClient, TillUser } from "@/lib/pos/sale-core"

/**
 * Opening, closing and reconciling the drawer — with no transport attached.
 *
 * Same split as `sale-core`, for the same reason: the web till reaches these
 * through server actions with FormData, the Android till through
 * `/api/till/shift`, and neither should own a second copy of the rules about
 * when a shift may be opened or what "expected cash" means.
 */

export type ShiftResult<T> = { ok: true; value: T } | { ok: false; error: string }

const fail = (error: string): ShiftResult<never> => ({ ok: false, error })

/**
 * Starts a shift with a counted opening float.
 *
 * Refuses if one is already open. Two parallel shifts would split the day's
 * sales across both, and neither would reconcile at close — the drawer is a
 * physical thing and there is only one of it.
 */
export async function openShiftFor(
  supabase: TillClient,
  user: TillUser,
  openingFloat: number,
  /**
   * Which till this shift runs on. Null when the caller does not know — an
   * older client, or a shift opened before the device registry existed. The
   * shift is still valid; it just cannot be attributed to a till, and the back
   * office shows a dash rather than guessing.
   */
  deviceId: number | null = null,
): Promise<ShiftResult<{ shiftId: number }>> {
  if (!Number.isFinite(openingFloat) || openingFloat < 0) {
    return fail("The float cannot be negative.")
  }
  if (openingFloat > 1_000_000) return fail("That float is unrealistically large.")

  const { data: existing } = await supabase
    .from("shifts")
    .select("id")
    .is("closed_at", null)
    .limit(1)

  if (existing && existing.length > 0) {
    return fail("A shift is already open. Refresh to join it.")
  }

  const { data, error } = await supabase
    .from("shifts")
    .insert({
      opened_by: user.id,
      opening_float: round2(openingFloat),
      device_id: deviceId,
    })
    .select("id")
    .maybeSingle()

  if (error) return fail(error.message)
  if (!data) return fail("The shift did not come back with an id. Please retry.")

  return { ok: true, value: { shiftId: data.id } }
}

/**
 * May this caller move money in, or close, THIS shift?
 *
 * Both `record_till_movement` and `close_shift_z` take a shift id and check
 * only that the shift exists and is open — neither asks who is calling. So a
 * cashier holding a valid till token could post another till's shift id and
 * take cash out of a drawer they are not standing at, or close it with an
 * invented count and freeze a Z that cannot be reopened. Those are exactly the
 * operations the back office confines to an owner or manager; pointing the
 * till-level action at another shift skipped that gate entirely.
 *
 * The rule: your own till, or a manager's say-so. `deviceId` null means the
 * caller could not say which till it is — an APK from before the registry — and
 * such a caller may only touch a shift with no device, which is what those
 * builds could ever have opened.
 */
export async function assertShiftReachable(
  supabase: TillClient,
  shiftId: number,
  deviceId: number | null,
  role: string,
): Promise<ShiftResult<null>> {
  if (role === "owner" || role === "manager") return { ok: true, value: null }

  const { data, error } = await supabase
    .from("shifts")
    .select("id, device_id, closed_at")
    .eq("id", shiftId)
    .maybeSingle()

  if (error) return fail(error.message)
  if (!data) return fail("That shift does not exist.")
  if (data.closed_at !== null) return fail("That till has already been closed.")

  if ((data.device_id ?? null) !== deviceId) {
    return fail("That drawer belongs to another till. Ask an owner or manager.")
  }

  return { ok: true, value: null }
}

/**
 * Petty cash in or out of an open drawer.
 *
 * Forwarded to `record_till_movement`, which is the only write path: it refuses
 * to overdraw the drawer and the ledger is append-only, so a mistake is
 * corrected with an opposite movement rather than an edit.
 */
export async function recordMovementFor(
  supabase: TillClient,
  shiftId: number,
  amount: number,
  reason: string,
): Promise<ShiftResult<null>> {
  if (!Number.isFinite(amount) || amount === 0) return fail("Enter an amount.")
  if (Math.abs(amount) > 1_000_000) return fail("That amount is unrealistically large.")

  const trimmed = reason.trim()
  if (trimmed.length < 3) {
    return fail("A reason is required — it is the only record of why cash left the drawer.")
  }
  if (trimmed.length > 200) return fail("Keep the reason under 200 characters.")

  const { error } = await supabase.rpc("record_till_movement", {
    p_shift_id: shiftId,
    p_amount: round2(amount),
    p_reason: trimmed,
  })

  if (error) return fail(error.message)
  return { ok: true, value: null }
}

export type ShiftCloseSummary = {
  countedCash: number
  expectedCash: number
  variance: number
  /** The Z number on the slip, e.g. "Z00007". */
  zNo: string
  zId: number
  /** The frozen figures, exactly as stored. */
  totals: ZTotals
}

/**
 * The Z report.
 *
 * Kids Corner prices are VAT-INCLUSIVE, so `incl` on a VAT block equals what
 * the customer paid and `excl` is what is left after the VAT inside it — the
 * two never add up to more than the sale.
 */
export type ZTotals = {
  shiftId: number
  openedAt: string
  asAt: string
  tickets: number
  salesTotal: number
  itemCount: number
  discountTotal: number
  avgBasket: number
  vatTotal: number
  methods: {
    method: string
    count: number
    gross: number
    change: number
    net: number
  }[]
  categories: { name: string; lines: number; qty: number; incl: number }[]
  vat: { rate: number; label: string; excl: number; vat: number; incl: number }[]
  cashiers: { cashierId: string | null; name: string; saleCount: number; total: number }[]
  hourly: { hour: number; count: number; total: number }[]
  topSellers: { name: string; qty: number; total: number }[]
  openingFloat: number
  cashTaken: number
  tillMovements: number
  movements: { amount: number; reason: string; at: string }[]
  /** Refunds handed back in cash, already netted out of `expectedCash`. */
  cashRefunded: number
  expectedCash: number
  voided: number
  refunded: number
  credited: number
}

const num = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : []

/**
 * Reshapes the RPC's snake_case JSON into the app's camelCase.
 *
 * Done here rather than in the database so the stored `z_reports.totals` stays
 * exactly what the aggregator produced — the frozen slip must be the
 * aggregator's own output, not a presentation layer's idea of it.
 */
export function readZTotals(raw: unknown): ZTotals {
  const t = (raw ?? {}) as Record<string, unknown>
  return {
    shiftId: num(t.shift_id),
    openedAt: String(t.opened_at ?? ""),
    asAt: String(t.as_at ?? ""),
    tickets: num(t.tickets),
    salesTotal: num(t.sales_total),
    itemCount: num(t.item_count),
    discountTotal: num(t.discount_total),
    avgBasket: num(t.avg_basket),
    vatTotal: num(t.vat_total),
    methods: list(t.methods).map((m) => ({
      method: String(m.method ?? ""),
      count: num(m.count),
      gross: num(m.gross),
      change: num(m.change),
      net: num(m.net),
    })),
    categories: list(t.categories).map((c) => ({
      name: String(c.name ?? "(uncategorised)"),
      lines: num(c.lines),
      qty: num(c.qty),
      incl: num(c.incl),
    })),
    vat: list(t.vat).map((v) => ({
      rate: num(v.rate),
      label: String(v.label ?? ""),
      excl: num(v.excl),
      vat: num(v.vat),
      incl: num(v.incl),
    })),
    cashiers: list(t.cashiers).map((c) => ({
      cashierId: typeof c.cashier_id === "string" ? c.cashier_id : null,
      name: String(c.name ?? "Unknown"),
      saleCount: num(c.sale_count),
      total: num(c.total),
    })),
    hourly: list(t.hourly).map((h) => ({
      hour: num(h.hour),
      count: num(h.count),
      total: num(h.total),
    })),
    topSellers: list(t.top_sellers).map((s) => ({
      name: String(s.name ?? "Unknown"),
      qty: num(s.qty),
      total: num(s.total),
    })),
    openingFloat: num(t.opening_float),
    cashTaken: num(t.cash_taken),
    tillMovements: num(t.till_movements),
    movements: list(t.movements).map((m) => ({
      amount: num(m.amount),
      reason: String(m.reason ?? ""),
      at: String(m.at ?? ""),
    })),
    cashRefunded: num(t.cash_refunded),
    expectedCash: num(t.expected_cash),
    voided: num(t.voided),
    refunded: num(t.refunded),
    credited: num(t.credited),
  }
}

/** The live figures for an open shift — an X-read, which changes as it trades. */
export async function readZ(
  supabase: TillClient,
  shiftId: number,
): Promise<ZTotals | null> {
  const { data, error } = await supabase.rpc(
    "z_totals" as never,
    { p_shift_id: shiftId } as never,
  )
  if (error) return null
  return readZTotals(data)
}

/**
 * Closes the shift and records the cash variance.
 *
 * `expected_cash` is recomputed here rather than trusted from the client — it
 * is the number the day reconciles against, so it must come from the sales
 * ledger and the till-movement ledger, not from whatever the device posted.
 */
export async function closeShiftFor(
  supabase: TillClient,
  user: TillUser,
  input: { shiftId: number; countedCash: number; notes: string | null },
): Promise<ShiftResult<ShiftCloseSummary>> {
  const { shiftId, notes } = input

  if (!Number.isFinite(input.countedCash) || input.countedCash < 0) {
    return fail("The counted cash cannot be negative.")
  }
  if (input.countedCash > 10_000_000) return fail("That figure is unrealistically large.")
  if (notes !== null && notes.length > 500) return fail("That note is too long.")

  // Delegated to `close_shift_z` (migration 013) rather than done here.
  //
  // The close and the Z slip have to be one transaction: a close that wrote the
  // shift row and then failed to freeze the Z would leave a shift nobody can
  // produce a slip for. The RPC also takes `FOR UPDATE` on the shift, which is
  // what stops two tills closing the same drawer at once — the guard this used
  // to do with `.is("closed_at", null)` on the update.
  //
  // `expected_cash` still never comes from the client. It is computed inside
  // the RPC from the sales and till-movement ledgers, at the same instant the
  // slip is frozen, so the paper and the shift row can never disagree.
  const { data, error } = await supabase.rpc(
    "close_shift_z" as never,
    {
      p_shift_id: shiftId,
      p_counted_cash: round2(input.countedCash),
      p_notes: notes,
    } as never,
  )

  if (error) {
    // The RPC raises for an already-closed shift; surfaced in the shop's words
    // rather than as a Postgres message.
    return fail(
      /already closed|does not exist/i.test(error.message)
        ? "That shift has already been closed."
        : error.message,
    )
  }

  const result = (data ?? {}) as Record<string, unknown>

  return {
    ok: true,
    value: {
      countedCash: round2(Number(result.counted_cash)),
      expectedCash: round2(Number(result.expected_cash)),
      variance: round2(Number(result.variance)),
      zNo: String(result.z_no ?? ""),
      zId: Number(result.z_id ?? 0),
      totals: readZTotals(result.totals),
    },
  }
}
