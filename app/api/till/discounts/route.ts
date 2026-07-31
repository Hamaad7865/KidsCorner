import { NextResponse } from "next/server"

import { requireTillSession } from "@/lib/api/till-session"
import { shopToday } from "@/lib/format"

/**
 * The discount rules a cashier may offer.
 *
 * Sent so the till can show the list and preview an amount. None of it is
 * authoritative: `settleDiscounts` recomputes every rule-backed discount from
 * this same table at commit time — its amount, and also its label, kind and
 * value, because those are what the receipt is built from. A till that edited
 * this response would change what the screen said and nothing else.
 *
 * `requiresManager` is included so the device knows when to raise the PIN
 * prompt. The server checks it again regardless; this only saves the cashier
 * finding out after the customer has been quoted a price.
 */
export async function GET(request: Request) {
  const session = await requireTillSession(request)
  if ("response" in session) return session.response

  const today = shopToday()

  const { data, error } = await session.supabase
    .from("discounts")
    .select("*")
    .eq("is_active", true)
    .order("name")

  if (error) return NextResponse.json({ ok: false, error: error.message })

  const live = (data ?? []).filter((row) => {
    // Date-windowed rules are filtered here rather than in SQL so a NULL bound
    // reads as "no bound" instead of excluding the row.
    if (row.starts_on && row.starts_on > today) return false
    if (row.ends_on && row.ends_on < today) return false
    return true
  })

  return NextResponse.json({
    ok: true,
    discounts: live.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      kind: row.kind === "percent" ? "percent" : "amount",
      value: Number(row.value),
      scope: row.scope === "line" ? "line" : "sale",
      // Sent so the till previews a category rule against that category's own
      // lines. Without it the screen would quote a basket-wide figure and the
      // server would settle a smaller one — the customer told one price and
      // charged another.
      categoryId: row.category_id,
      minSpend: Number(row.min_spend),
      maxAmount: row.max_amount === null ? null : Number(row.max_amount),
      requiresManager: row.requires_manager,
    })),
  })
}
