import { isMovementType, type MovementType } from "@/lib/db-enums"
import { endOfShopDay, startOfShopDay } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * Stock reads: the movement ledger and the low-stock list.
 *
 * `stock_movements` is the source of truth for stock — `qty_on_hand` is only a
 * cache maintained by the `record_stock_movement` RPC — so this ledger is the
 * authoritative history and nothing here ever writes.
 */

export const MOVEMENT_PAGE_SIZE = 100

export type MovementFilters = {
  type?: MovementType
  variantId?: number
  /** ISO dates (inclusive). */
  from?: string
  to?: string
}

export type MovementRow = {
  id: number
  movementType: MovementType
  qty: number
  notes: string | null
  referenceType: string | null
  referenceId: number | null
  createdAt: string
  createdBy: string | null
  variantId: number | null
  sku: string | null
  productName: string | null
  sizeLabel: string | null
  colourName: string | null
  colourHex: string | null
}

export type MovementList = {
  rows: MovementRow[]
  truncated: boolean
}

export async function listMovements(
  filters: MovementFilters = {},
): Promise<MovementList> {
  const supabase = await createClient()

  let query = supabase
    .from("stock_movements")
    .select(
      `id, movement_type, qty, notes, reference_type, reference_id, created_at,
       profiles ( full_name ),
       product_variants (
         id, sku,
         products ( name ),
         sizes ( label ),
         colours ( name, hex_code )
       )`,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })

  if (filters.type) query = query.eq("movement_type", filters.type)
  if (filters.variantId !== undefined) query = query.eq("variant_id", filters.variantId)
  // Both bounds are converted from a local calendar date to an instant. Passing
  // the bare date would have Postgres read it as midnight UTC — 4am in
  // Mauritius — so "from 5 March" would skip that morning's movements and
  // "to 5 March" would spill four hours into the 6th.
  if (filters.from) query = query.gte("created_at", startOfShopDay(filters.from))
  if (filters.to) query = query.lte("created_at", endOfShopDay(filters.to))

  const { data, error } = await query.limit(MOVEMENT_PAGE_SIZE + 1)
  if (error) throw error

  const all = data ?? []
  const rows = all.slice(0, MOVEMENT_PAGE_SIZE).map<MovementRow>((row) => {
    const variant = row.product_variants
    return {
      id: row.id,
      // The column is TEXT with a CHECK, so it widens to string in the types.
      movementType: isMovementType(row.movement_type)
        ? row.movement_type
        : "adjustment",
      qty: row.qty,
      notes: row.notes,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      createdAt: row.created_at,
      createdBy: row.profiles?.full_name ?? null,
      variantId: variant?.id ?? null,
      sku: variant?.sku ?? null,
      productName: variant?.products?.name ?? null,
      sizeLabel: variant?.sizes?.label ?? null,
      colourName: variant?.colours?.name ?? null,
      colourHex: variant?.colours?.hex_code ?? null,
    }
  })

  return { rows, truncated: all.length > MOVEMENT_PAGE_SIZE }
}

export type LocationStockRow = {
  variantId: number
  productId: number | null
  sku: string
  productName: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  qty: number
}

export type LocationGroup = {
  locationId: number
  locationName: string
  totalUnits: number
  rows: LocationStockRow[]
}

/**
 * Per-location balances, from the `stock_by_location` view in migration 006.
 *
 * These are DERIVED from the movement ledger, not a second cached figure — the
 * view sums `stock_movements.qty` per location. `product_variants.qty_on_hand`
 * remains the shop-wide total, so the two can never drift: one is the sum of
 * the other.
 *
 * Returns an empty list rather than throwing when the view is absent, so a
 * database without 006 shows an empty tab instead of a crashed page.
 */
export async function listStockByLocation(
  locationId?: number,
): Promise<LocationGroup[]> {
  const supabase = await createClient()

  let query = supabase
    .from("stock_by_location")
    .select("*")
    .order("location_name")
    .order("product_name")
    .limit(2000)

  if (locationId !== undefined) query = query.eq("location_id", locationId)

  const { data, error } = await query
  if (error || !data) return []

  const groups = new Map<number, LocationGroup>()

  for (const row of data) {
    if (row.location_id === null || row.variant_id === null) continue

    const group =
      groups.get(row.location_id) ??
      {
        locationId: row.location_id,
        locationName: row.location_name ?? "Unnamed",
        totalUnits: 0,
        rows: [],
      }

    const qty = row.qty_on_hand ?? 0
    group.totalUnits += qty
    group.rows.push({
      variantId: row.variant_id,
      productId: row.product_id,
      sku: row.sku ?? "",
      productName: row.product_name ?? "",
      sizeLabel: row.size_label ?? "",
      colourName: row.colour_name ?? "",
      colourHex: row.colour_hex,
      qty,
    })

    groups.set(row.location_id, group)
  }

  return [...groups.values()]
}

export type LowStockRow = {
  variantId: number
  productId: number | null
  sku: string
  productName: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  qtyOnHand: number
  reorderLevel: number
  sellingPrice: number
}

/**
 * Reads the `low_stock_variants` view from migration 002. The rule
 * (`qty_on_hand <= reorder_level`) compares two columns, which a PostgREST
 * filter cannot do — hence the view rather than a query here.
 */
/**
 * Just the number, for the tab badge. `head: true` sends no rows at all, so
 * viewing the movements tab no longer pulls hundreds of variant records purely
 * to render a count.
 */
export async function countLowStock(): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from("low_stock_variants")
    .select("variant_id", { count: "exact", head: true })

  if (error) throw error
  return count ?? 0
}

export async function listLowStock(): Promise<LowStockRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("low_stock_variants")
    .select("*")
    .order("qty_on_hand", { ascending: true })
    .limit(500)

  if (error) throw error

  return (data ?? [])
    .filter((row) => row.variant_id !== null)
    .map((row) => ({
      variantId: row.variant_id as number,
      productId: row.product_id,
      sku: row.sku ?? "",
      productName: row.product_name ?? "",
      sizeLabel: row.size_label ?? "",
      colourName: row.colour_name ?? "",
      colourHex: row.colour_hex,
      qtyOnHand: row.qty_on_hand ?? 0,
      reorderLevel: row.reorder_level ?? 0,
      sellingPrice: Number(row.selling_price ?? 0),
    }))
}
