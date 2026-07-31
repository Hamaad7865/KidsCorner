"use server"

import { revalidatePath } from "next/cache"

import { allocateBarcodes } from "@/lib/barcodes/settings"
import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { round2, slugifyForSku } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

/**
 * Server side of the Excel import.
 *
 * Split into small actions the client calls directly (not through
 * `useActionState`) so the wizard can show real progress: masters are created
 * once, then rows are committed in chunks and the progress bar reflects actual
 * completed work rather than an animation.
 *
 * Every quantity goes in through `record_stock_movement` with
 * `movement_type = 'import'`, per the spec's rule that `stock_movements` is the
 * truth and `qty_on_hand` is a cache no other code may write.
 */

export type ImportMasterKind = "category" | "brand" | "colour" | "size"

export type CreatedMaster = {
  kind: ImportMasterKind
  name: string
  id: number
  /** Only for sizes: which type the server inferred, so the client agrees. */
  sizeType?: "age_range" | "shoe_size"
}

export type CommitRow = {
  rowNumber: number
  productName: string
  categoryId: number
  brandId: number | null
  gender: string
  sizeId: number
  colourId: number
  costPrice: number
  sellPrice: number
  quantity: number
  barcode: string | null
}

export type ChunkResult = {
  ok: boolean
  error?: string
  productsCreated: number
  variantsCreated: number
  variantsUpdated: number
  stockAdded: number
  skipped: { rowNumber: number; reason: string }[]
  /**
   * Set when barcodes could not be issued for the rows whose Barcode column was
   * blank. Not fatal — the variants are still imported — but it must be said,
   * or the shop finds out at the till that new stock does not scan.
   */
  barcodeError?: string
}

async function guard(): Promise<string | null> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return "Your session has expired. Sign in again."
  if (!canManageCatalog(profile.role)) {
    return "Only an owner or manager can import products."
  }
  return null
}

/**
 * Which of these barcodes are already taken. Scoped to the file's own barcodes
 * rather than selecting the whole column, so it stays exact regardless of
 * catalog size (PostgREST silently caps an unfiltered select at max-rows).
 */
export async function findExistingBarcodes(barcodes: string[]): Promise<string[]> {
  if (barcodes.length === 0) return []
  const denied = await guard()
  if (denied) return []

  const supabase = await createClient()
  const found: string[] = []

  // Chunked: a few thousand barcodes in one `in()` would blow the URL length.
  for (let i = 0; i < barcodes.length; i += 200) {
    const slice = barcodes.slice(i, i + 200)
    const { data, error } = await supabase
      .from("product_variants")
      .select("barcode")
      .in("barcode", slice)
    if (error) break
    for (const row of data ?? []) if (row.barcode) found.push(row.barcode)
  }
  return found
}

/**
 * A label like "EU 24" or "24" is footwear; anything mentioning months or years
 * is clothing. Only used when the sheet references a size that doesn't exist
 * yet — the user sees which type was chosen and can correct it in Settings.
 */
function guessSizeType(label: string): "age_range" | "shoe_size" {
  const value = label.toLowerCase()
  if (/(yr|year|mth|month|m\b)/.test(value)) return "age_range"
  if (/^(eu|uk|us)?\s*\d{1,2}(\.5)?$/.test(value.trim())) return "shoe_size"
  return "age_range"
}

export async function createMissingMasters(
  missing: { kind: ImportMasterKind; name: string }[],
): Promise<{ ok: boolean; error?: string; created: CreatedMaster[] }> {
  const denied = await guard()
  if (denied) return { ok: false, error: denied, created: [] }

  const supabase = await createClient()
  const created: CreatedMaster[] = []

  for (const item of missing) {
    const name = item.name.trim()
    if (!name) continue

    if (item.kind === "size") {
      const sizeType = guessSizeType(name)
      const { data, error } = await supabase
        .from("sizes")
        .insert({
          label: name,
          size_type: sizeType,
          // Pushed to the end of the ordering; the user can reorder later.
          sort_order: 900,
        })
        .select("id")
        .maybeSingle()
      if (error) return { ok: false, error: error.message, created }
      // sizeType returned so the client's local copy matches the row that was
      // actually written rather than assuming a default.
      if (data) created.push({ kind: "size", name, id: data.id, sizeType })
      continue
    }

    const table =
      item.kind === "category" ? "categories" : item.kind === "brand" ? "brands" : "colours"

    const { data, error } = await supabase
      .from(table)
      .insert({ name })
      .select("id")
      .maybeSingle()
    if (error) return { ok: false, error: error.message, created }
    if (data) created.push({ kind: item.kind, name, id: data.id })
  }

  revalidatePath("/settings")
  return { ok: true, created }
}

export async function importChunk(rows: CommitRow[]): Promise<ChunkResult> {
  const empty: ChunkResult = {
    ok: true,
    productsCreated: 0,
    variantsCreated: 0,
    variantsUpdated: 0,
    stockAdded: 0,
    skipped: [],
  }
  if (rows.length === 0) return empty

  const denied = await guard()
  if (denied) return { ...empty, ok: false, error: denied }

  const supabase = await createClient()
  const result: ChunkResult = { ...empty, skipped: [] }

  // Labels for SKU generation, fetched once for the whole chunk.
  const sizeIds = [...new Set(rows.map((r) => r.sizeId))]
  const colourIds = [...new Set(rows.map((r) => r.colourId))]

  const [sizesResult, coloursResult] = await Promise.all([
    supabase.from("sizes").select("id, label").in("id", sizeIds),
    supabase.from("colours").select("id, name").in("id", colourIds),
  ])
  if (sizesResult.error || coloursResult.error) {
    return {
      ...result,
      ok: false,
      error: (sizesResult.error ?? coloursResult.error)?.message,
    }
  }
  const sizeLabels = new Map((sizesResult.data ?? []).map((s) => [s.id, s.label]))
  const colourNames = new Map((coloursResult.data ?? []).map((c) => [c.id, c.name]))

  // Spare barcodes for rows whose Barcode column was blank. Reserved once for
  // the chunk, then handed out only as *new* variants are inserted — a row that
  // turns out to update an existing variant keeps whatever code that variant
  // already has. Over-reserving is deliberate: unused serials leave a gap in the
  // sequence, which costs nothing, while running out mid-chunk would leave part
  // of an import unscannable.
  const blankCount = rows.filter((r) => !r.barcode).length
  const { codes: spareBarcodes, error: barcodeError } = await allocateBarcodes(
    supabase,
    blankCount,
  )
  let nextSpare = 0
  const takeSpare = () =>
    nextSpare < spareBarcodes.length ? spareBarcodes[nextSpare++] : null

  // Reported rather than swallowed. The import still runs — a variant with no
  // barcode is worth having — but "success" with a whole delivery that cannot
  // be scanned is the kind of silence somebody discovers at the till.
  if (barcodeError) result.barcodeError = barcodeError

  // Resolve products. A product is identified by name within a category, so two
  // categories may legitimately hold same-named products without merging.
  const productKey = (r: CommitRow) =>
    `${r.categoryId}:${r.productName.trim().toLowerCase()}`
  const productIds = new Map<string, number>()

  for (const row of rows) {
    const key = productKey(row)
    if (productIds.has(key)) continue

    const { data: existing, error: findError } = await supabase
      .from("products")
      .select("id")
      .eq("category_id", row.categoryId)
      // Escaped: `ilike` treats % and _ as wildcards, so a product genuinely
      // named "50% cotton tee" would match unrelated rows and quietly merge
      // its variants into the wrong product.
      .ilike("name", row.productName.trim().replace(/[%_]/g, (c) => `\\${c}`))
      .limit(1)

    if (findError) return { ...result, ok: false, error: findError.message }

    if (existing && existing.length > 0) {
      productIds.set(key, existing[0].id)
      continue
    }

    const { data: inserted, error: insertError } = await supabase
      .from("products")
      .insert({
        name: row.productName.trim(),
        category_id: row.categoryId,
        brand_id: row.brandId,
        gender: row.gender,
      })
      .select("id")
      .maybeSingle()

    if (insertError || !inserted) {
      return { ...result, ok: false, error: insertError?.message ?? "Product insert failed." }
    }
    productIds.set(key, inserted.id)
    result.productsCreated += 1
  }

  for (const row of rows) {
    const productId = productIds.get(productKey(row))
    if (productId === undefined) {
      result.skipped.push({ rowNumber: row.rowNumber, reason: "Product could not be resolved." })
      continue
    }

    // Spec: a row matching an existing variant by (product, size, colour) OR by
    // barcode updates prices and *adds* quantity rather than duplicating.
    let variantId: number | null = null

    const { data: byCell, error: cellError } = await supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", productId)
      .eq("size_id", row.sizeId)
      .eq("colour_id", row.colourId)
      .limit(1)
    if (cellError) {
      result.skipped.push({ rowNumber: row.rowNumber, reason: cellError.message })
      continue
    }
    if (byCell && byCell.length > 0) variantId = byCell[0].id

    if (variantId === null && row.barcode) {
      const { data: byBarcode } = await supabase
        .from("product_variants")
        .select("id")
        .eq("barcode", row.barcode)
        .limit(1)
      if (byBarcode && byBarcode.length > 0) variantId = byBarcode[0].id
    }

    if (variantId === null) {
      const label = sizeLabels.get(row.sizeId) ?? String(row.sizeId)
      const colour = colourNames.get(row.colourId) ?? String(row.colourId)
      const baseSku = `${productId}-${slugifyForSku(label)}-${slugifyForSku(colour)}`
      // The file's own barcode wins; a spare is only spent when the cell was
      // blank. Taken once and reused on the SKU retry below, so a clash does
      // not burn a second serial.
      const barcode = row.barcode ?? takeSpare()

      const { data: inserted, error: variantError } = await supabase
        .from("product_variants")
        .insert({
          product_id: productId,
          size_id: row.sizeId,
          colour_id: row.colourId,
          // Suffixed on clash: two labels can slugify identically, and `sku`
          // is UNIQUE across the whole table.
          sku: baseSku,
          barcode,
          cost_price: round2(row.costPrice),
          selling_price: round2(row.sellPrice),
        })
        .select("id")
        .maybeSingle()

      if (variantError || !inserted) {
        // Two different unique constraints reach this branch and they need
        // opposite remedies. A SKU clash wants a new SKU and the same code; a
        // barcode clash wants a new code and the same SKU — retrying a barcode
        // clash with the same barcode just fails again for the same reason.
        const clashedOnBarcode =
          variantError?.code === "23505" && /barcode/i.test(variantError.message)

        // A code the file supplied is the shop's own data. Quietly swapping it
        // for a generated one would leave the printed tag and the database
        // disagreeing, so that row is reported instead of guessed at.
        if (clashedOnBarcode && row.barcode) {
          result.skipped.push({
            rowNumber: row.rowNumber,
            reason: `Barcode ${row.barcode} already belongs to another variant.`,
          })
          continue
        }

        const retrySku = clashedOnBarcode
          ? baseSku
          : `${baseSku}-${row.sizeId}-${row.colourId}`
        const retryBarcode = clashedOnBarcode ? takeSpare() : barcode

        const { data: retry, error: retryError } = await supabase
          .from("product_variants")
          .insert({
            product_id: productId,
            size_id: row.sizeId,
            colour_id: row.colourId,
            sku: retrySku,
            barcode: retryBarcode,
            cost_price: round2(row.costPrice),
            selling_price: round2(row.sellPrice),
          })
          .select("id")
          .maybeSingle()

        if (retryError || !retry) {
          result.skipped.push({
            rowNumber: row.rowNumber,
            reason: retryError?.message ?? variantError?.message ?? "Variant insert failed.",
          })
          continue
        }
        variantId = retry.id
      } else {
        variantId = inserted.id
      }
      result.variantsCreated += 1
    } else {
      const { error: updateError } = await supabase
        .from("product_variants")
        .update({
          cost_price: round2(row.costPrice),
          selling_price: round2(row.sellPrice),
        })
        .eq("id", variantId)

      if (updateError) {
        result.skipped.push({ rowNumber: row.rowNumber, reason: updateError.message })
        continue
      }
      result.variantsUpdated += 1
    }

    if (row.quantity > 0) {
      const { error: movementError } = await supabase.rpc("record_stock_movement", {
        p_variant_id: variantId,
        p_type: "import",
        p_qty: row.quantity,
        p_reference_type: "excel_import",
        p_notes: `Imported from spreadsheet row ${row.rowNumber}`,
      })

      if (movementError) {
        // The variant exists but its stock did not land — say so rather than
        // report a clean import.
        result.skipped.push({
          rowNumber: row.rowNumber,
          reason: `Variant saved but stock was not added: ${movementError.message}`,
        })
        continue
      }
      result.stockAdded += row.quantity
    }
  }

  revalidatePath("/products")
  revalidatePath("/stock")
  // Issuing codes moved the counter that Settings displays; without this the
  // field there goes stale and the next save from that page is refused.
  if (spareBarcodes.length > 0) revalidatePath("/settings")
  return result
}
