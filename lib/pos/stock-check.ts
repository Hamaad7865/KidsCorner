import type { TillClient } from "./sale-core"

export type StockCheckQuantity = {
  variantId: number
  qty: number
}

export type StockCheckLocation = {
  id: number
  name: string
  quantities: StockCheckQuantity[]
}

type LocationRow = {
  id: number | null
  name: string | null
}

type BalanceRow = {
  location_id: number | null
  variant_id: number | null
  qty_on_hand: number | null
}

/**
 * Preserves the active-location list even where the stock view has no row.
 * The Android UI needs that distinction so Warehouse can read zero rather
 * than disappear and look as though it was not checked.
 */
export function groupStockByLocation(
  locations: LocationRow[],
  balances: BalanceRow[],
): StockCheckLocation[] {
  const quantities = new Map<number, StockCheckQuantity[]>()

  for (const row of balances) {
    if (row.location_id === null || row.variant_id === null) continue
    const group = quantities.get(row.location_id) ?? []
    group.push({ variantId: row.variant_id, qty: row.qty_on_hand ?? 0 })
    quantities.set(row.location_id, group)
  }

  return locations.flatMap((location) =>
    location.id === null
      ? []
      : [
          {
            id: location.id,
            name: location.name?.trim() || `Location ${location.id}`,
            quantities: quantities.get(location.id) ?? [],
          },
        ],
  )
}

/** Live, per-location stock for every variant belonging to one product. */
export async function loadProductStock(
  client: TillClient,
  productId: number,
): Promise<StockCheckLocation[]> {
  const [locationsResult, balancesResult] = await Promise.all([
    client
      .from("stock_locations")
      .select("id, name")
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("name"),
    client
      .from("stock_by_location")
      .select("location_id, variant_id, qty_on_hand")
      .eq("product_id", productId),
  ])

  if (locationsResult.error) throw locationsResult.error
  if (balancesResult.error) throw balancesResult.error

  return groupStockByLocation(
    locationsResult.data ?? [],
    balancesResult.data ?? [],
  )
}
