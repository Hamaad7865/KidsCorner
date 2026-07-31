import { getBarcodeSettings, type BarcodeSettings } from "@/lib/barcodes/settings"
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
