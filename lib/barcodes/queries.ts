import { isValidEan13 } from "@/lib/barcodes/ean13"
import { getBarcodeSettings, type BarcodeSettings } from "@/lib/barcodes/settings"
import { stockForVariantsAtLocation } from "@/lib/stock/queries"
import { createClient } from "@/lib/supabase/server"

/** Reads for the barcode settings panel, the generate dialog and the label sheet. */

export type BarcodelessVariant = {
  id: number
  sku: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  sellingPrice: number
}

export type LabelRow = BarcodelessVariant & {
  productName: string
  barcode: string
}

export async function readBarcodeSettings(): Promise<BarcodeSettings> {
  const supabase = await createClient()
  return getBarcodeSettings(supabase)
}

/**
 * The variants of one product that still have no barcode — what the generate
 * dialog offers to fill in.
 *
 * Inactive variants are included on purpose: a retired colour still sits on a
 * shelf somewhere, and the whole point of the sweep is that nothing is left
 * unscannable.
 */
export async function listVariantsWithoutBarcode(
  productId: number,
): Promise<BarcodelessVariant[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("product_variants")
    .select(
      `id, sku, selling_price,
       sizes ( label, sort_order ),
       colours ( name, hex_code )`,
    )
    .eq("product_id", productId)
    .is("barcode", null)

  if (error) throw error

  // Size order then colour, so the dialog lists them the way the variant matrix
  // draws them and the two can be read side by side. `sort_order` is only a
  // sort key, so it is read off the row rather than carried on the result.
  const rows = data ?? []
  rows.sort(
    (a, b) =>
      (a.sizes?.sort_order ?? 0) - (b.sizes?.sort_order ?? 0) ||
      (a.colours?.name ?? "").localeCompare(b.colours?.name ?? ""),
  )

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    sizeLabel: row.sizes?.label ?? "—",
    colourName: row.colours?.name ?? "—",
    colourHex: row.colours?.hex_code ?? null,
    sellingPrice: Number(row.selling_price),
  }))
}

/** How many variants across the whole catalogue are still missing a barcode. */
export async function countVariantsWithoutBarcode(): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from("product_variants")
    .select("id", { count: "exact", head: true })
    .is("barcode", null)

  if (error) throw error
  return count ?? 0
}

/**
 * Variants to print labels for, by id.
 *
 * Anything still missing a barcode is dropped rather than printed blank — a
 * label with no symbol on it wastes a sticker and gets stuck on stock anyway.
 */
export async function listLabelRows(variantIds: number[]): Promise<LabelRow[]> {
  if (variantIds.length === 0) return []

  const supabase = await createClient()

  const { data, error } = await supabase
    .from("product_variants")
    .select(
      `id, sku, barcode, selling_price,
       products ( name ),
       sizes ( label, sort_order ),
       colours ( name, hex_code )`,
    )
    .in("id", variantIds)
    .not("barcode", "is", null)

  if (error) throw error

  // Grouped by product, then in size then colour order, so a printed sheet
  // comes off the printer in the order somebody walks the rail.
  const rows = data ?? []
  rows.sort(
    (a, b) =>
      (a.products?.name ?? "").localeCompare(b.products?.name ?? "") ||
      (a.sizes?.sort_order ?? 0) - (b.sizes?.sort_order ?? 0) ||
      (a.colours?.name ?? "").localeCompare(b.colours?.name ?? ""),
  )

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    barcode: row.barcode ?? "",
    productName: row.products?.name ?? "—",
    sizeLabel: row.sizes?.label ?? "—",
    colourName: row.colours?.name ?? "—",
    colourHex: row.colours?.hex_code ?? null,
    sellingPrice: Number(row.selling_price),
  }))
}

/** As many products as the label picker lists before asking for a search. */
const PRINTABLE_LIMIT = 500

export type PrintableVariant = {
  variantId: number
  colourName: string
  sizeLabel: string
  barcode: string
  /** Units at the chosen location — the default label count for this variant. */
  stock: number
}

export type PrintableProductRow = {
  productId: number
  name: string
  categoryName: string | null
  brandName: string | null
  /** Printable variants (valid barcode only), each with its stock at the location. */
  variants: PrintableVariant[]
  /** How many variants still need a code — missing or invalid — for "Generate". */
  barcodelessCount: number
  /** Sum of the printable variants' stock: the default total for the product. */
  unitsAtLocation: number
}

/**
 * The products the label picker shows, each with its printable variants (the
 * ones carrying a valid barcode, with stock at the chosen location) and a count
 * of those still needing a code, so a row can be expanded to set per-variant
 * quantities or offered a Generate button.
 *
 * Three reads merged in memory rather than one clever join: the products, their
 * variants (with colour, size and barcode), and the per-location balances for
 * the printable ones. Bounded to {@link PRINTABLE_LIMIT} products, with a search
 * to narrow past that — the same shape as the products list.
 */
export async function listPrintableProducts(
  locationId: number | undefined,
  search?: string,
): Promise<{ rows: PrintableProductRow[]; truncated: boolean }> {
  const supabase = await createClient()

  let query = supabase
    .from("products")
    .select("id, name, categories ( name ), brands ( name )")
    .eq("is_active", true)
    .order("name")

  if (search) {
    const escaped = search.replace(/[%_]/g, (c) => `\\${c}`)
    query = query.ilike("name", `%${escaped}%`)
  }

  const { data: products, error } = await query.limit(PRINTABLE_LIMIT + 1)
  if (error) throw error

  const shown = (products ?? []).slice(0, PRINTABLE_LIMIT)
  const truncated = (products ?? []).length > PRINTABLE_LIMIT
  const productIds = shown.map((product) => product.id)
  if (productIds.length === 0) return { rows: [], truncated }

  const { data: variants, error: variantError } = await supabase
    .from("product_variants")
    .select("id, product_id, barcode, sizes ( label, sort_order ), colours ( name )")
    .in("product_id", productIds)

  if (variantError) throw variantError

  type RawVariant = {
    id: number
    sizeLabel: string
    sizeSort: number
    colourName: string
  }
  const printableByProduct = new Map<number, RawVariant[]>()
  const barcodelessCount = new Map<number, number>()
  const allBarcodedIds: number[] = []

  for (const variant of variants ?? []) {
    if (variant.product_id === null) continue
    // A present-but-invalid barcode (wrong check digit, mistyped or imported) is
    // not printable — it renders as "Invalid barcode" and never scans — so it
    // counts as needing a code, not as printable. Generate then reissues it.
    const printable = variant.barcode !== null && isValidEan13(variant.barcode)
    if (printable) {
      const list = printableByProduct.get(variant.product_id) ?? []
      list.push({
        id: variant.id,
        sizeLabel: variant.sizes?.label ?? "—",
        sizeSort: variant.sizes?.sort_order ?? 0,
        colourName: variant.colours?.name ?? "—",
      })
      printableByProduct.set(variant.product_id, list)
      allBarcodedIds.push(variant.id)
    } else {
      barcodelessCount.set(
        variant.product_id,
        (barcodelessCount.get(variant.product_id) ?? 0) + 1,
      )
    }
  }

  // The barcode text keyed by id, so each printable variant can carry its own
  // code for the label without a second lookup.
  const barcodeById = new Map<number, string>()
  for (const variant of variants ?? []) {
    if (variant.barcode) barcodeById.set(variant.id, variant.barcode)
  }

  // Location undefined (no locations set up) means no stock rows to ask for, so
  // the counts are simply zero rather than a query over nothing.
  const stock =
    locationId === undefined
      ? new Map<number, number>()
      : await stockForVariantsAtLocation(allBarcodedIds, locationId)

  const rows = shown.map((product) => {
    const raw = printableByProduct.get(product.id) ?? []
    // Size order then colour, the way the variant matrix reads.
    raw.sort(
      (a, b) => a.sizeSort - b.sizeSort || a.colourName.localeCompare(b.colourName),
    )
    const printableVariants: PrintableVariant[] = raw.map((variant) => ({
      variantId: variant.id,
      colourName: variant.colourName,
      sizeLabel: variant.sizeLabel,
      barcode: barcodeById.get(variant.id) ?? "",
      stock: stock.get(variant.id) ?? 0,
    }))

    return {
      productId: product.id,
      name: product.name,
      categoryName: product.categories?.name ?? null,
      brandName: product.brands?.name ?? null,
      variants: printableVariants,
      barcodelessCount: barcodelessCount.get(product.id) ?? 0,
      unitsAtLocation: printableVariants.reduce((sum, v) => sum + v.stock, 0),
    }
  })

  return { rows, truncated }
}
