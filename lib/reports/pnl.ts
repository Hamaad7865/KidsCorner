import { endOfShopDay, round2, startOfShopDay } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * Simple P&L — ported from Carfectionist's "Simple P&L".
 *
 * Revenue less what the goods cost is the gross profit; less what went out of
 * the drawer is the net. Four lines, same as there.
 *
 * Two things this report is honest about rather than quietly wrong about, both
 * consequences of the schema and both stated on screen:
 *
 *   COST is each variant's CURRENT `cost_price`. `sale_items` records what was
 *   charged but not what the item cost that day, so a supplier price change
 *   moves historical margin with it. Same caveat the Margin report carries —
 *   deliberately the same source, so the two reports cannot disagree.
 *
 *   EXPENSES are only cash paid out of the till. Carfectionist has an
 *   `expenses` table; Kids Corner records rent, wages and electricity nowhere,
 *   because they are not POS events. So the net line is what the POS knows, and
 *   a pay-out used to BANK the takings is a transfer rather than a cost — which
 *   is why every pay-out is listed by its reason instead of collapsed into one
 *   figure the owner has to take on trust.
 */

const ROW_CAP = 5_000
const OVER_CAP = ROW_CAP + 1

export type PnlExpense = {
  reason: string
  amount: number
  count: number
}

export type PnlReport = {
  from: string
  to: string
  /** Sales less credit notes, VAT taken out — what a VAT return calls turnover. */
  revenue: number
  /** Stock consumed, at each variant's current cost. Returns come back off it. */
  cost: number
  gross: number
  grossPct: number
  /** Cash paid out of the till. */
  expenses: number
  net: number
  expenseRows: PnlExpense[]
  counts: { sales: number; credits: number; payouts: number }
  truncated: boolean
}

/** Net value from the immutable tax snapshot, never from today's rate. */
export function frozenNet(document: {
  total: number
  vatEnabled: boolean
  vatAmount: number
}): number {
  return round2(document.total - (document.vatEnabled ? document.vatAmount : 0))
}

/**
 * Pay-outs grouped by what they were for, biggest first.
 *
 * Pure and exported for the tests. Reasons are free text typed at a counter, so
 * they are trimmed and folded to one case before grouping — "Petty cash" and
 * "petty cash" are the same expense, and two rows for it would invite the owner
 * to add them up by hand.
 */
export function groupPayouts(
  movements: { amount: number; reason: string | null }[],
): PnlExpense[] {
  const groups = new Map<string, PnlExpense>()

  for (const movement of movements) {
    // Only money LEAVING the drawer. A positive movement is a float top-up or
    // change from the safe — cash arriving, which costs the shop nothing.
    if (movement.amount >= 0) continue

    const label = (movement.reason ?? "").trim() || "No reason given"
    const key = label.toLowerCase()
    const existing = groups.get(key) ?? { reason: label, amount: 0, count: 0 }
    existing.amount = round2(existing.amount + Math.abs(movement.amount))
    existing.count += 1
    groups.set(key, existing)
  }

  return [...groups.values()].sort((a, b) => b.amount - a.amount)
}

export async function getPnlReport(from: string, to: string): Promise<PnlReport> {
  const supabase = await createClient()
  const after = startOfShopDay(from)
  const before = endOfShopDay(to)

  const [salesResult, creditResult, itemResult, returnResult, movementResult] =
    await Promise.all([
      supabase
        .from("sales")
        .select("id, sale_date, total, vat_enabled, vat_rate, vat_amount, status")
        .in("status", ["completed", "refunded"])
        .gte("sale_date", after)
        .lte("sale_date", before)
        .order("sale_date", { ascending: true })
        .limit(OVER_CAP),
      supabase
        .from("credit_notes")
        .select("id, created_at, total, vat_enabled, vat_rate, vat_amount")
        .gte("created_at", after)
        .lte("created_at", before)
        .order("created_at", { ascending: true })
        .limit(OVER_CAP),
      // Cost of what left the shelf. Scoped by the SALE's date through the
      // inner join, so it covers exactly the sales counted as revenue above.
      supabase
        .from("sale_items")
        .select("qty, sales!inner ( sale_date, status ), product_variants ( cost_price )")
        .in("sales.status", ["completed", "refunded"])
        .gte("sales.sale_date", after)
        .lte("sales.sale_date", before)
        .limit(OVER_CAP),
      // Returned goods went back on the shelf, so their cost was not consumed.
      supabase
        .from("credit_note_items")
        .select("qty, credit_notes!inner ( created_at ), product_variants ( cost_price )")
        .gte("credit_notes.created_at", after)
        .lte("credit_notes.created_at", before)
        .limit(OVER_CAP),
      supabase
        .from("till_movements")
        .select("id, amount, reason, created_at")
        .lt("amount", 0)
        .gte("created_at", after)
        .lte("created_at", before)
        .order("created_at", { ascending: true })
        .limit(OVER_CAP),
    ])

  if (salesResult.error) throw salesResult.error
  if (creditResult.error) throw creditResult.error
  if (itemResult.error) throw itemResult.error
  if (returnResult.error) throw returnResult.error
  if (movementResult.error) throw movementResult.error

  const saleRows = salesResult.data ?? []
  const creditRows = creditResult.data ?? []
  const itemRows = itemResult.data ?? []
  const returnRows = returnResult.data ?? []
  const movementRows = movementResult.data ?? []

  const truncated =
    saleRows.length > ROW_CAP ||
    creditRows.length > ROW_CAP ||
    itemRows.length > ROW_CAP ||
    returnRows.length > ROW_CAP ||
    movementRows.length > ROW_CAP

  const sales = saleRows.slice(0, ROW_CAP)
  const credits = creditRows.slice(0, ROW_CAP)
  const items = itemRows.slice(0, ROW_CAP)
  const returns = returnRows.slice(0, ROW_CAP)
  const movements = movementRows.slice(0, ROW_CAP)

  // VAT is contained in the total, so net is the total LESS the frozen VAT —
  // never the total divided by today's rate, which would restate every sale
  // made before a rate change.
  const revenue = round2(
    sales.reduce(
      (sum, s) =>
        sum +
        frozenNet({
          total: Number(s.total),
          vatEnabled: s.vat_enabled,
          vatAmount: Number(s.vat_amount),
        }),
      0,
    ) -
      credits.reduce(
        (sum, c) =>
          sum +
          frozenNet({
            total: Number(c.total),
            vatEnabled: c.vat_enabled,
            vatAmount: Number(c.vat_amount),
          }),
        0,
      ),
  )

  const cost = round2(
    items.reduce(
      (sum, i) => sum + i.qty * Number(i.product_variants?.cost_price ?? 0),
      0,
    ) -
      returns.reduce(
        (sum, r) => sum + r.qty * Number(r.product_variants?.cost_price ?? 0),
        0,
      ),
  )

  const expenseRows = groupPayouts(
    movements.map((m) => ({ amount: Number(m.amount), reason: m.reason })),
  )
  const expenses = round2(expenseRows.reduce((sum, e) => sum + e.amount, 0))

  const gross = round2(revenue - cost)

  return {
    from,
    to,
    revenue,
    cost,
    gross,
    // Measured against revenue, which is what "a 40% margin" means in a shop.
    grossPct: revenue > 0 ? (gross / revenue) * 100 : 0,
    expenses,
    net: round2(gross - expenses),
    expenseRows,
    counts: {
      sales: sales.length,
      credits: credits.length,
      payouts: movements.length,
    },
    truncated,
  }
}
