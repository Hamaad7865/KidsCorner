import { createClient } from "@/lib/supabase/server"

import type { DiscountKind, DiscountRule, DiscountScope } from "./rules"

/** Discount rules, for the settings screen and for the till. */
export async function listDiscounts(activeOnly = false): Promise<DiscountRule[]> {
  const supabase = await createClient()

  let query = supabase.from("discounts").select("*").order("name").limit(200)
  if (activeOnly) query = query.eq("is_active", true)

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    // TEXT + CHECK widens to string in the generated types; narrow once here.
    kind: (row.kind === "percent" ? "percent" : "amount") as DiscountKind,
    value: Number(row.value),
    scope: (row.scope === "line" ? "line" : "sale") as DiscountScope,
    categoryId: row.category_id,
    minSpend: Number(row.min_spend),
    maxAmount: row.max_amount === null ? null : Number(row.max_amount),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    requiresManager: row.requires_manager,
    isActive: row.is_active,
  }))
}

export type DiscountReportRow = {
  discountId: number | null
  label: string
  timesUsed: number
  totalGiven: number
}

/**
 * What was given away over a period, by rule — the question the old bare
 * number in `sales.discount` could not answer.
 */
export async function getDiscountReport(
  from: string,
  to: string,
): Promise<DiscountReportRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("discount_report", {
    p_from: from,
    p_to: to,
  })
  if (error) throw error

  return (data ?? []).map((row) => ({
    discountId: row.discount_id,
    label: row.label,
    timesUsed: Number(row.times_used),
    totalGiven: Number(row.total_given),
  }))
}
