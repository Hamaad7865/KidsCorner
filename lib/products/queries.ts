import { cache } from "react"

import {
  SIZE_TYPES,
  isGender,
  isSizeType,
  type Gender,
  type SizeType,
} from "@/lib/db-enums"
import { createClient } from "@/lib/supabase/server"

import { isAtOrBelowReorder } from "./stock"

/**
 * Product reads for the back office.
 *
 * Aggregates (variant count, total stock, price range) are computed in JS from
 * an embedded `product_variants` select rather than in SQL. PostgREST cannot
 * express GROUP BY without a view, and adding one would mean another migration
 * for the shop owner to run. At this shop's scale — hundreds of products, a few
 * thousand variants — a single round trip and a reduce is the cheaper trade.
 * If the catalog ever outgrows that, the fix is a view in migration 002, not a
 * second query here.
 */

export type ProductFilters = {
  search?: string
  categoryId?: number
  brandId?: number
  /** `undefined` shows everything; the list defaults to active only. */
  activeOnly?: boolean
}

export type ProductListRow = {
  id: number
  name: string
  gender: Gender
  imageUrl: string | null
  isActive: boolean
  categoryName: string | null
  brandName: string | null
  variantCount: number
  totalStock: number
  lowStockCount: number
  minPrice: number | null
  maxPrice: number | null
  /**
   * The distinct colours this product comes in, for the list's swatch column.
   *
   * Capped where it is rendered, not here: a buyer scanning the list wants to
   * see that a product has eight colours, and the count is only knowable if
   * all eight come back.
   */
  colours: { name: string; hex: string | null }[]
}

function toGender(value: string): Gender {
  return isGender(value) ? value : "unisex"
}

/**
 * How many products the list will show at once.
 *
 * An unbounded `.select()` is not actually unbounded — PostgREST caps results
 * at `max-rows` (1000 on Supabase by default) and says nothing about it, so a
 * large catalog would silently lose rows off the end. Asking for an explicit
 * limit and fetching one extra row makes the truncation visible instead, which
 * matters as soon as the Excel import starts creating products in bulk.
 */
export const PRODUCT_LIST_LIMIT = 500

export type ProductList = {
  rows: ProductListRow[]
  /** True when more products matched than are shown. */
  truncated: boolean
}

export async function listProducts(
  filters: ProductFilters = {},
): Promise<ProductList> {
  const supabase = await createClient()

  let query = supabase
    .from("products")
    .select(
      `id, name, gender, image_url, is_active,
       categories ( name ),
       brands ( name ),
       product_variants ( id, selling_price, qty_on_hand, reorder_level, is_active,
         colours ( name, hex_code ) )`,
    )
    .order("name")

  if (filters.search) {
    // Escape PostgREST's wildcards so a literal % in a product name still
    // matches itself rather than everything.
    const escaped = filters.search.replace(/[%_]/g, (c) => `\\${c}`)
    query = query.ilike("name", `%${escaped}%`)
  }
  if (filters.categoryId !== undefined) query = query.eq("category_id", filters.categoryId)
  if (filters.brandId !== undefined) query = query.eq("brand_id", filters.brandId)
  if (filters.activeOnly) query = query.eq("is_active", true)

  // One extra row: if it comes back, there were more matches than we show.
  const { data, error } = await query.limit(PRODUCT_LIST_LIMIT + 1)
  if (error) throw error

  const truncated = (data ?? []).length > PRODUCT_LIST_LIMIT
  const rows = (data ?? []).slice(0, PRODUCT_LIST_LIMIT).map((row) => {
    // Only active variants count toward the figures a buyer acts on: a retired
    // colour should not inflate stock or widen the price range on the list.
    const variants = (row.product_variants ?? []).filter((v) => v.is_active)
    const prices = variants.map((v) => Number(v.selling_price))

    return {
      id: row.id,
      name: row.name,
      gender: toGender(row.gender),
      imageUrl: row.image_url,
      isActive: row.is_active,
      categoryName: row.categories?.name ?? null,
      brandName: row.brands?.name ?? null,
      variantCount: variants.length,
      totalStock: variants.reduce((sum, v) => sum + v.qty_on_hand, 0),
      lowStockCount: variants.filter((v) =>
        isAtOrBelowReorder(v.qty_on_hand, v.reorder_level),
      ).length,
      minPrice: prices.length > 0 ? Math.min(...prices) : null,
      maxPrice: prices.length > 0 ? Math.max(...prices) : null,
      // Deduplicated by name: the same colour across four sizes is one swatch.
      colours: [
        ...new Map(
          variants
            .map((v) => v.colours)
            .filter((c): c is { name: string; hex_code: string | null } => Boolean(c))
            .map((c) => [c.name, { name: c.name, hex: c.hex_code }]),
        ).values(),
      ],
    }
  })

  return { rows, truncated }
}

export type VariantRow = {
  id: number
  sizeId: number
  colourId: number
  sku: string
  barcode: string | null
  costPrice: number
  sellingPrice: number
  qtyOnHand: number
  reorderLevel: number
  isActive: boolean
}

export type ProductDetail = {
  id: number
  name: string
  categoryId: number
  brandId: number | null
  gender: Gender
  description: string | null
  imageUrl: string | null
  isActive: boolean
  categoryName: string | null
  brandName: string | null
  variants: VariantRow[]
  /** Size types actually present on this product, so the matrix can split them. */
  sizeTypesUsed: SizeType[]
}

/**
 * `cache()` dedupes this across a single request. The detail route calls it
 * from both `generateMetadata` and the page body, which Next runs in the same
 * pass — without this that is two identical round trips per page view.
 */
export const getProduct = cache(async (id: number): Promise<ProductDetail | null> => {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("products")
    .select(
      `id, name, category_id, brand_id, gender, description, image_url, is_active,
       categories ( name ),
       brands ( name ),
       product_variants (
         id, size_id, colour_id, sku, barcode, cost_price, selling_price,
         qty_on_hand, reorder_level, is_active,
         sizes ( size_type )
       )`,
    )
    .eq("id", id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const rows = data.product_variants ?? []
  const sizeTypes = new Set<SizeType>()
  for (const row of rows) {
    const type = row.sizes?.size_type
    if (isSizeType(type)) sizeTypes.add(type)
  }

  return {
    id: data.id,
    name: data.name,
    categoryId: data.category_id,
    brandId: data.brand_id,
    gender: toGender(data.gender),
    description: data.description,
    imageUrl: data.image_url,
    isActive: data.is_active,
    categoryName: data.categories?.name ?? null,
    brandName: data.brands?.name ?? null,
    variants: rows.map((row) => ({
      id: row.id,
      sizeId: row.size_id,
      colourId: row.colour_id,
      sku: row.sku,
      barcode: row.barcode,
      costPrice: Number(row.cost_price),
      sellingPrice: Number(row.selling_price),
      qtyOnHand: row.qty_on_hand,
      reorderLevel: row.reorder_level,
      isActive: row.is_active,
    })),
    // Ordered by SIZE_TYPES, not Set insertion order — otherwise the matrix
    // would group age ranges above or below shoe sizes depending on which
    // variant Postgres happened to return first.
    sizeTypesUsed: SIZE_TYPES.filter((type) => sizeTypes.has(type)),
  }
})
