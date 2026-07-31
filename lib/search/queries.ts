import { isValidEan13 } from "@/lib/barcodes/ean13"
import { createClient } from "@/lib/supabase/server"

/**
 * Back-office global search: products, variants by barcode or SKU, suppliers
 * and customers, from one box in the header.
 *
 * A barcode scanner behaves as a keyboard that types fast and presses Enter, so
 * the same field serves both. An exact barcode hit short-circuits everything
 * else — somebody who just scanned a tag wants that product, not a list.
 */

const PER_GROUP = 8

export type ScanHit = {
  productId: number
  productName: string
  sku: string
  barcode: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  sellingPrice: number
  qtyOnHand: number
}

export type SearchResults = {
  query: string
  /** Set when the query matched one variant's barcode exactly. */
  scan: ScanHit | null
  products: Array<{
    id: number
    name: string
    categoryName: string | null
    brandName: string | null
    variantCount: number
    isActive: boolean
  }>
  suppliers: Array<{ id: number; name: string; phone: string | null }>
  customers: Array<{ id: number; name: string; phone: string | null }>
  isEmpty: boolean
}

/**
 * PostgREST `ilike` treats % and _ as wildcards, so a search for "50% cotton"
 * would otherwise match unrelated rows. Escaped, then wrapped for a contains
 * match.
 */
function contains(term: string): string {
  return `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
}

/** A bare run of digits is worth trying as a barcode, EAN-13 or not. */
function looksScanned(term: string): boolean {
  return /^\d{6,14}$/.test(term)
}

export async function search(rawQuery: string): Promise<SearchResults> {
  const query = rawQuery.trim()

  const empty: SearchResults = {
    query,
    scan: null,
    products: [],
    suppliers: [],
    customers: [],
    isEmpty: true,
  }
  // One or two characters matches most of the catalogue and helps nobody.
  if (query.length < 2) return empty

  const supabase = await createClient()

  if (looksScanned(query)) {
    const { data } = await supabase
      .from("product_variants")
      .select(
        `sku, barcode, selling_price, qty_on_hand,
         products ( id, name ),
         sizes ( label ),
         colours ( name, hex_code )`,
      )
      .eq("barcode", query)
      .limit(1)
      .maybeSingle()

    if (data?.products) {
      return {
        ...empty,
        isEmpty: false,
        scan: {
          productId: data.products.id,
          productName: data.products.name,
          sku: data.sku,
          barcode: data.barcode ?? query,
          sizeLabel: data.sizes?.label ?? "—",
          colourName: data.colours?.name ?? "—",
          colourHex: data.colours?.hex_code ?? null,
          sellingPrice: Number(data.selling_price),
          qtyOnHand: data.qty_on_hand,
        },
      }
    }
    // A well-formed code that matches nothing is worth saying so about, rather
    // than falling through to a name search that will also find nothing.
    if (isValidEan13(query)) return { ...empty, isEmpty: true }
  }

  const pattern = contains(query)

  const [products, variants, suppliers, customers] = await Promise.all([
    supabase
      .from("products")
      .select(
        `id, name, is_active,
         categories ( name ),
         brands ( name ),
         product_variants ( id )`,
      )
      .ilike("name", pattern)
      .limit(PER_GROUP),
    // SKU is the other thing printed on a tag, so it searches alongside names.
    supabase
      .from("product_variants")
      .select("products ( id, name, is_active )")
      .ilike("sku", pattern)
      .limit(PER_GROUP),
    supabase
      .from("suppliers")
      .select("id, name, phone")
      .ilike("name", pattern)
      .limit(PER_GROUP),
    supabase
      .from("customers")
      .select("id, full_name, phone")
      .ilike("full_name", pattern)
      .limit(PER_GROUP),
  ])

  const byId = new Map<number, SearchResults["products"][number]>()

  for (const row of products.data ?? []) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      categoryName: row.categories?.name ?? null,
      brandName: row.brands?.name ?? null,
      variantCount: (row.product_variants ?? []).length,
      isActive: row.is_active,
    })
  }

  // Products reached via a SKU match. Merged into the same list rather than
  // shown separately — from the shopkeeper's side it is still "the product".
  for (const row of variants.data ?? []) {
    const product = row.products
    if (!product || byId.has(product.id)) continue
    byId.set(product.id, {
      id: product.id,
      name: product.name,
      categoryName: null,
      brandName: null,
      variantCount: 0,
      isActive: product.is_active,
    })
  }

  const results: SearchResults = {
    query,
    scan: null,
    products: [...byId.values()].slice(0, PER_GROUP),
    suppliers: (suppliers.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
    })),
    customers: (customers.data ?? []).map((c) => ({
      id: c.id,
      name: c.full_name,
      phone: c.phone,
    })),
    isEmpty: false,
  }

  results.isEmpty =
    results.products.length === 0 &&
    results.suppliers.length === 0 &&
    results.customers.length === 0

  return results
}
