import { createClient } from "@/lib/supabase/server"

/**
 * Reads for the Promotions module: the editable threshold, the slow-mover list
 * (products that have stopped selling and still have stock), and the active
 * promotions. Nothing here writes.
 *
 * Detection is a live query — `slow_movers(days)` in the promotions migration —
 * computed on each page load, exactly like the low-stock count. There is no cron
 * because none is needed: "not sold in N days" is a question about the sales
 * ledger, answered the moment it is asked.
 */

/** The spec default, used when the setting is absent or malformed. */
export const DEFAULT_SLOW_MOVER_DAYS = 30

/** How many idle days flags a product, from settings, defaulting to 30. */
export async function getSlowMoverDays(): Promise<number> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "slow_mover_days")
    .maybeSingle()

  const n = Number(data?.value)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SLOW_MOVER_DAYS
}

export type SlowMover = {
  productId: number
  productName: string
  productCode: string | null
  categoryName: string | null
  qtyOnHand: number
  variantCount: number
  lastSoldAt: string | null
  daysIdle: number
  minPrice: number
  maxPrice: number
}

/** Products idle for at least `days`, with stock, not already on promotion. */
export async function listSlowMovers(days: number): Promise<SlowMover[]> {
  const supabase = await createClient()
  // `as never`: slow_movers is not in the generated types, the same cast the
  // till queries use for z_totals and close_shift_z.
  const { data, error } = await supabase.rpc("slow_movers" as never, {
    p_days: days,
  } as never)
  if (error) throw error

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    productId: Number(row.product_id),
    productName: String(row.product_name ?? ""),
    productCode: (row.product_code as string) ?? null,
    categoryName: (row.category_name as string) ?? null,
    qtyOnHand: Number(row.qty_on_hand ?? 0),
    variantCount: Number(row.variant_count ?? 0),
    lastSoldAt: (row.last_sold_at as string) ?? null,
    daysIdle: Number(row.days_idle ?? 0),
    minPrice: Number(row.min_price ?? 0),
    maxPrice: Number(row.max_price ?? 0),
  }))
}

/** Just the number, for the header pill. Shares the rule with the list. */
export async function countSlowMovers(days: number): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("count_slow_movers" as never, {
    p_days: days,
  } as never)
  if (error) throw error
  return Number(data) || 0
}

export type PromoVariant = {
  variantId: number
  sku: string
  sizeLabel: string
  colourName: string
  costPrice: number
  currentPrice: number
  qtyOnHand: number
}

/**
 * The active, in-stock variants of one product, with cost and current price —
 * what the Apply-promotion dialog needs so the owner or manager can set a price
 * per variant with the cost floor in view.
 */
export async function loadProductForPromo(
  productId: number,
): Promise<{ productName: string; variants: PromoVariant[] } | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("products")
    .select(
      `name,
       product_variants (
         id, sku, cost_price, selling_price, qty_on_hand, is_active,
         sizes ( label ), colours ( name )
       )`,
    )
    .eq("id", productId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const activeVariants = (data.product_variants ?? []).filter((v) => v.is_active)

  // Drop variants already on promotion — the dialog only offers the ones a
  // markdown can still be applied to, so the RPC never has to refuse one.
  const alreadyPromoted = new Set<number>()
  if (activeVariants.length > 0) {
    const { data: promos } = await supabase
      .from("promotions")
      .select("variant_id")
      .eq("status", "active")
      .in(
        "variant_id",
        activeVariants.map((v) => v.id),
      )
    for (const p of promos ?? []) alreadyPromoted.add(p.variant_id)
  }

  const variants = activeVariants
    .filter((v) => !alreadyPromoted.has(v.id))
    .map((v) => ({
      variantId: v.id,
      sku: v.sku ?? "",
      sizeLabel: v.sizes?.label ?? "",
      colourName: v.colours?.name ?? "",
      costPrice: Number(v.cost_price),
      currentPrice: Number(v.selling_price),
      qtyOnHand: v.qty_on_hand,
    }))

  return { productName: data.name, variants }
}

export type ActivePromotion = {
  id: number
  variantId: number
  productId: number | null
  sku: string
  productName: string
  sizeLabel: string
  colourName: string
  costPrice: number
  originalPrice: number
  promoPrice: number
  appliedAt: string
  appliedBy: string | null
  /** True once a completed sale of this variant has landed since the markdown. */
  soldSincePromo: boolean
}

/**
 * Every live promotion, with its variant/product and whether it has started
 * selling again since it was marked down — the nudge to consider lifting it.
 */
export async function listActivePromotions(): Promise<ActivePromotion[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("promotions")
    .select(
      `id, variant_id, original_price, promo_price, applied_at,
       profiles!promotions_applied_by_fkey ( full_name ),
       product_variants (
         id, sku, cost_price, product_id,
         products ( name ), sizes ( label ), colours ( name )
       )`,
    )
    .eq("status", "active")
    .order("applied_at", { ascending: false })
  if (error) throw error

  const rows = data ?? []
  const variantIds = rows
    .map((r) => r.product_variants?.id)
    .filter((id): id is number => typeof id === "number")

  // One extra query: the last completed sale per promoted variant, to tell
  // which promotions have started moving again. Cheap — scoped to the handful
  // of variants currently on promotion, not the whole sales table.
  const lastSold = new Map<number, string>()
  if (variantIds.length > 0) {
    const { data: sales } = await supabase
      .from("sale_items")
      .select("variant_id, sales!inner ( sale_date, status )")
      .in("variant_id", variantIds)
      .eq("sales.status", "completed")
    for (const s of sales ?? []) {
      const vid = s.variant_id
      const at = s.sales?.sale_date
      if (vid == null || !at) continue
      const prev = lastSold.get(vid)
      if (!prev || at > prev) lastSold.set(vid, at)
    }
  }

  return rows.map((r) => {
    const v = r.product_variants
    const lastSaleAt = v?.id != null ? lastSold.get(v.id) : undefined
    return {
      id: r.id,
      variantId: r.variant_id,
      productId: v?.product_id ?? null,
      sku: v?.sku ?? "",
      productName: v?.products?.name ?? "",
      sizeLabel: v?.sizes?.label ?? "",
      colourName: v?.colours?.name ?? "",
      costPrice: Number(v?.cost_price ?? 0),
      originalPrice: Number(r.original_price),
      promoPrice: Number(r.promo_price),
      appliedAt: r.applied_at,
      appliedBy: r.profiles?.full_name ?? null,
      soldSincePromo: lastSaleAt !== undefined && lastSaleAt > r.applied_at,
    }
  })
}

/**
 * Which of these products have an active promotion, for the "On promotion"
 * badge on the products list. Returns a set of product ids.
 */
export async function productsOnPromotion(
  productIds: number[],
): Promise<Set<number>> {
  if (productIds.length === 0) return new Set()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("promotions")
    .select("product_variants!inner ( product_id )")
    .eq("status", "active")
    .in("product_variants.product_id", productIds)
  if (error) return new Set()

  const ids = new Set<number>()
  for (const row of data ?? []) {
    const pid = row.product_variants?.product_id
    if (typeof pid === "number") ids.add(pid)
  }
  return ids
}
