import { round2 } from "@/lib/format"
import { getShopName } from "@/lib/pos/queries"
import { readZ } from "@/lib/pos/shift-core"
import { createClient } from "@/lib/supabase/server"

/**
 * The back office's view of the tills.
 *
 * Ported from Carfectionist's Point of Sale module, which answers the three
 * questions an owner has about a till they are not standing at: is it open,
 * what is in the drawer, and did the last few days reconcile.
 *
 * Keyed on the DEVICE rather than on whoever opened the shift. That is the axis
 * a shop actually thinks in — "the counter till is short" is actionable in a
 * way "Priya is short" is not, and it survives two people sharing a till across
 * a day.
 */

/** A till is "online" if it has checked in within this long. */
const ONLINE_WINDOW_MS = 5 * 60_000

export type TillDrawer = {
  shiftId: number
  openedAt: string
  openedByName: string | null
  openingFloat: number
  cashCollected: number
  tillMovements: number
  cashRefunded: number
  /** Float + cash sales + movements − cash refunds. */
  expected: number
  ticketCount: number
  salesTotal: number
}

export type PosDevice = {
  id: number
  code: string
  name: string
  model: string | null
  appVersion: string | null
  isBackOffice: boolean
  isActive: boolean
  lastSeenAt: string | null
  /** Derived from `lastSeenAt`, never stored — a stored flag is wrong the
   *  moment a tablet loses power. The web till is always "on". */
  online: boolean
  /** The open shift on this till, if any. */
  drawer: TillDrawer | null
}

export type CashUp = {
  shiftId: number
  deviceName: string | null
  openedAt: string
  closedAt: string | null
  openedByName: string | null
  closedByName: string | null
  /**
   * Null when the shift closed without a recorded count — the legacy rows, and
   * anything closed outside the app. Kept null rather than coerced to zero: a
   * shift that was never counted is not a shift that balanced, and the Shifts
   * report already treats these as absent.
   */
  expected: number | null
  counted: number | null
  /** counted − expected. Negative is short. Null when never counted. */
  variance: number | null
}

export type PosOverview = {
  shopName: string
  devices: PosDevice[]
  recent: CashUp[]
  reconciliation: {
    closed: number
    exact: number
    short: number
    over: number
    /** Closed with no count recorded — neither balanced nor out. */
    uncounted: number
  }
}

export async function getPosOverview(): Promise<PosOverview> {
  const supabase = await createClient()

  const [shopName, { data: deviceRows }, { data: openRows }, { data: closedRows }] =
    await Promise.all([
      getShopName(),
      supabase
        .from("pos_devices")
        .select("id, code, name, model, app_version, is_back_office, is_active, last_seen_at")
        .order("is_back_office", { ascending: true })
        .order("name"),
      supabase
        .from("shifts")
        .select(
          "id, device_id, opened_at, opening_float, profiles!shifts_opened_by_fkey ( full_name )",
        )
        .is("closed_at", null)
        .order("opened_at", { ascending: false }),
      supabase
        .from("shifts")
        .select(
          `id, opened_at, closed_at, expected_cash, counted_cash, variance,
           pos_devices ( name ),
           opener:profiles!shifts_opened_by_fkey ( full_name ),
           closer:profiles!shifts_closed_by_fkey ( full_name )`,
        )
        .not("closed_at", "is", null)
        .order("closed_at", { ascending: false })
        .limit(20),
    ])

  // The live drawer figures come from `z_totals`, the same function the Z is
  // frozen from — so what an owner reads here and what a cashier counts against
  // at close cannot drift apart. One call per open till, and there are never
  // many.
  const drawers = new Map<number, TillDrawer>()
  for (const shift of openRows ?? []) {
    const z = await readZ(supabase, shift.id)
    const drawer: TillDrawer = {
      shiftId: shift.id,
      openedAt: shift.opened_at,
      openedByName: shift.profiles?.full_name ?? null,
      openingFloat: round2(Number(shift.opening_float)),
      cashCollected: round2(z?.cashTaken ?? 0),
      tillMovements: round2(z?.tillMovements ?? 0),
      cashRefunded: round2(z?.cashRefunded ?? 0),
      expected: round2(z?.expectedCash ?? Number(shift.opening_float)),
      ticketCount: z?.tickets ?? 0,
      salesTotal: round2(z?.salesTotal ?? 0),
    }
    // A shift opened before the registry has no device. It still belongs to
    // somebody's drawer, so it is attached to the web till rather than lost.
    drawers.set(shift.device_id ?? -1, drawer)
  }

  const now = Date.now()
  const devices = (deviceRows ?? []).map<PosDevice>((d) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    model: d.model,
    appVersion: d.app_version,
    isBackOffice: d.is_back_office,
    isActive: d.is_active,
    lastSeenAt: d.last_seen_at,
    online:
      d.is_back_office ||
      (d.last_seen_at !== null &&
        now - new Date(d.last_seen_at).getTime() < ONLINE_WINDOW_MS),
    drawer: drawers.get(d.id) ?? (d.is_back_office ? (drawers.get(-1) ?? null) : null),
  }))

  const recent = (closedRows ?? []).map<CashUp>((s) => ({
    shiftId: s.id,
    deviceName: s.pos_devices?.name ?? null,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    openedByName: s.opener?.full_name ?? null,
    closedByName: s.closer?.full_name ?? null,
    expected: s.expected_cash === null ? null : round2(Number(s.expected_cash)),
    counted: s.counted_cash === null ? null : round2(Number(s.counted_cash)),
    variance: s.variance === null ? null : round2(Number(s.variance)),
  }))

  return {
    shopName,
    devices,
    recent,
    reconciliation: {
      closed: recent.length,
      // Exact is the figure worth counting. A drawer that balances to the cent
      // is the signal the process works; a run of small variances is worth a
      // conversation long before a big one appears.
      //
      // Which is exactly why an uncounted shift must not land here. Coercing a
      // null count to zero made every legacy shift read as balanced to the
      // cent, inflating the one number this strip exists to report.
      exact: recent.filter((r) => r.variance === 0).length,
      short: recent.filter((r) => r.variance !== null && r.variance < 0).length,
      over: recent.filter((r) => r.variance !== null && r.variance > 0).length,
      uncounted: recent.filter((r) => r.variance === null).length,
    },
  }
}

/** One till, for its own page. */
export async function getDevice(code: string): Promise<PosDevice | null> {
  const overview = await getPosOverview()
  return overview.devices.find((d) => d.code === code) ?? null
}

/**
 * Narrows a `shifts` query to one till.
 *
 * The web till also answers for shifts with no device at all — every shift
 * opened before the registry existed carries `device_id NULL`, and the overview
 * already shows their drawer on the back-office card. Shared rather than
 * repeated because three screens now ask this question, and a copy that drifts
 * would make one tab show history another swears does not exist.
 */
export function forDeviceShifts<
  Q extends { or(filter: string): Q; eq(column: string, value: number): Q },
>(query: Q, device: { id: number; isBackOffice: boolean }): Q {
  return device.isBackOffice
    ? query.or(`device_id.eq.${device.id},device_id.is.null`)
    : query.eq("device_id", device.id)
}

/**
 * Every shift this till has run, newest first.
 *
 * The web till also answers for shifts with no device at all. Every shift
 * opened before the registry existed carries `device_id NULL`, and the overview
 * above already shows their drawer on the back-office card — so listing them
 * here is what stops that card reading "Rs 3,000 in the drawer" above a table
 * that says the till has never opened a shift.
 */
export async function getDeviceSessions(device: {
  id: number
  isBackOffice: boolean
}): Promise<CashUp[]> {
  const supabase = await createClient()
  const query = supabase
    .from("shifts")
    .select(
      `id, opened_at, closed_at, expected_cash, counted_cash, variance,
       pos_devices ( name ),
       opener:profiles!shifts_opened_by_fkey ( full_name ),
       closer:profiles!shifts_closed_by_fkey ( full_name )`,
    )
    .order("opened_at", { ascending: false })
    .limit(50)

  const { data } = await forDeviceShifts(query, device)

  return (data ?? []).map<CashUp>((s) => ({
    shiftId: s.id,
    deviceName: s.pos_devices?.name ?? null,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    openedByName: s.opener?.full_name ?? null,
    closedByName: s.closer?.full_name ?? null,
    expected: s.expected_cash === null ? null : round2(Number(s.expected_cash)),
    counted: s.counted_cash === null ? null : round2(Number(s.counted_cash)),
    variance: s.variance === null ? null : round2(Number(s.variance)),
  }))
}
