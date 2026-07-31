import { round2 } from "@/lib/format"
import { getShopName } from "@/lib/pos/queries"
import { readZ } from "@/lib/pos/shift-core"
import { createClient } from "@/lib/supabase/server"

/**
 * The back office's view of the till.
 *
 * Ported from Carfectionist's Point of Sale module, which answers the three
 * questions an owner actually has about a till they are not standing at: is it
 * open, what is in the drawer, and did the last few days reconcile.
 *
 * WHAT IS DIFFERENT HERE, AND WHY
 *
 * Carfectionist keeps a `pos_devices` registry — model, code, app version, an
 * online dot from a heartbeat. Kids Corner has no such table, and inventing one
 * for a single shop with a single till would be a schema carrying no
 * information: every field would be a constant.
 *
 * So the unit here is the SHIFT, which Kids Corner already records properly —
 * who opened it, when, the float, and on close the counted cash and variance.
 * That is enough to answer all three questions. If the shop ever runs a second
 * till, this shape extends by grouping on a device column rather than being
 * rewritten.
 */

export type OpenTill = {
  shiftId: number
  openedAt: string
  openedByName: string | null
  openingFloat: number
  /** Cash taken through the drawer this shift. */
  cashCollected: number
  /** Signed petty cash: negative means money was taken out. */
  tillMovements: number
  /** Refunds handed back in cash — already netted out of `expected`. */
  cashRefunded: number
  /**
   * What should physically be in the drawer.
   *
   * Float + cash sales + movements − cash refunds. Shown with that arithmetic
   * spelled out, because "collected 5,158 · expected 7,158" reads like a fault
   * until you remember the float.
   */
  expected: number
  ticketCount: number
  salesTotal: number
}

export type CashUp = {
  shiftId: number
  openedAt: string
  closedAt: string | null
  openedByName: string | null
  closedByName: string | null
  expected: number
  counted: number
  /** counted − expected. Negative is short. */
  variance: number
}

export type PosOverview = {
  shopName: string
  openTill: OpenTill | null
  recent: CashUp[]
  /** Shifts closed in the last 30 days, and how many of those were off. */
  reconciliation: { closed: number; exact: number; short: number; over: number }
}

export async function getPosOverview(): Promise<PosOverview> {
  const supabase = await createClient()

  const [shopName, { data: open }, { data: closed }] = await Promise.all([
    getShopName(),
    supabase
      .from("shifts")
      .select("id, opened_at, opening_float, profiles!shifts_opened_by_fkey ( full_name )")
      .is("closed_at", null)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("shifts")
      .select(
        `id, opened_at, closed_at, expected_cash, counted_cash, variance,
         opener:profiles!shifts_opened_by_fkey ( full_name ),
         closer:profiles!shifts_closed_by_fkey ( full_name )`,
      )
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(20),
  ])

  let openTill: OpenTill | null = null

  if (open) {
    // The live drawer figures come from `z_totals`, the same function the Z
    // report is frozen from — so what an owner reads here and what the cashier
    // is counting against at close cannot drift apart.
    const z = await readZ(supabase, open.id)
    openTill = {
      shiftId: open.id,
      openedAt: open.opened_at,
      openedByName: open.profiles?.full_name ?? null,
      openingFloat: round2(Number(open.opening_float)),
      cashCollected: round2(z?.cashTaken ?? 0),
      tillMovements: round2(z?.tillMovements ?? 0),
      cashRefunded: round2(z?.cashRefunded ?? 0),
      expected: round2(z?.expectedCash ?? Number(open.opening_float)),
      ticketCount: z?.tickets ?? 0,
      salesTotal: round2(z?.salesTotal ?? 0),
    }
  }

  const recent = (closed ?? []).map<CashUp>((s) => ({
    shiftId: s.id,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    openedByName: s.opener?.full_name ?? null,
    closedByName: s.closer?.full_name ?? null,
    expected: round2(Number(s.expected_cash ?? 0)),
    counted: round2(Number(s.counted_cash ?? 0)),
    variance: round2(Number(s.variance ?? 0)),
  }))

  return {
    shopName,
    openTill,
    recent,
    reconciliation: {
      closed: recent.length,
      // Exact is the one worth counting. A drawer that balances to the cent
      // every day is the signal that the process is working; a run of small
      // variances is worth a conversation long before a big one appears.
      exact: recent.filter((r) => r.variance === 0).length,
      short: recent.filter((r) => r.variance < 0).length,
      over: recent.filter((r) => r.variance > 0).length,
    },
  }
}
