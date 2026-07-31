import type { Brand, Category, Colour, Size } from "@/lib/master-data/queries"

import {
  normaliseKey,
  parseGender,
  parseMoney,
  parseQty,
  type ImportField,
  type RawRow,
} from "./columns"

/**
 * Per-row validation for the import preview.
 *
 * Pure and client-safe so step 2 can re-validate instantly as the user remaps a
 * column or ticks "create this category" — no server round trip per keystroke.
 * The one thing it cannot know on its own is which barcodes already exist in
 * the database, so those are passed in.
 */

export type MasterLookup = {
  categories: Map<string, number>
  brands: Map<string, number>
  colours: Map<string, number>
  /** Sizes are unique per (size_type, label), so the key is the label alone. */
  sizes: Map<string, number>
}

export function buildLookup(data: {
  categories: Category[]
  brands: Brand[]
  colours: Colour[]
  sizes: Size[]
}): MasterLookup {
  return {
    categories: new Map(data.categories.map((c) => [normaliseKey(c.name), c.id])),
    brands: new Map(data.brands.map((b) => [normaliseKey(b.name), b.id])),
    colours: new Map(data.colours.map((c) => [normaliseKey(c.name), c.id])),
    sizes: new Map(data.sizes.map((s) => [normaliseKey(s.label), s.id])),
  }
}

/** A master value the sheet references that does not exist yet. */
export type MissingMaster = {
  kind: "category" | "brand" | "colour" | "size"
  /** The value exactly as typed in the sheet, used when creating it. */
  name: string
}

export type ValidatedRow = {
  rowNumber: number
  productName: string
  categoryName: string
  brandName: string | null
  gender: "boy" | "girl" | "unisex"
  sizeLabel: string
  colourName: string
  costPrice: number
  sellPrice: number
  quantity: number
  barcode: string | null
  /** Resolved where the master already exists; null when it must be created. */
  categoryId: number | null
  brandId: number | null
  sizeId: number | null
  colourId: number | null
  missing: MissingMaster[]
  errors: string[]
}

export type ValidationSummary = {
  rows: ValidatedRow[]
  ready: number
  needsMasters: number
  errors: number
  /** Deduplicated across the whole file, for the "create these" chips. */
  missingMasters: MissingMaster[]
}

function text(row: RawRow, field: ImportField): string {
  return (row.values[field] ?? "").trim()
}

export function validateRows(
  rows: RawRow[],
  lookup: MasterLookup,
  // ReadonlySet: this function only ever reads from it.
  options: { existingBarcodes: ReadonlySet<string> },
): ValidationSummary {
  // Barcode must be unique across the whole file as well as against the
  // database — two rows claiming the same barcode would collide on insert.
  const seenBarcodes = new Map<string, number>()
  const missingByKey = new Map<string, MissingMaster>()

  const validated = rows.map<ValidatedRow>((row) => {
    const errors: string[] = []
    const missing: MissingMaster[] = []

    const productName = text(row, "productName")
    const categoryName = text(row, "category")
    const brandName = text(row, "brand")
    const sizeLabel = text(row, "size")
    const colourName = text(row, "colour")
    const barcodeRaw = text(row, "barcode")

    if (!productName) errors.push("Product Name is empty.")
    if (!categoryName) errors.push("Category is empty.")
    if (!sizeLabel) errors.push("Size is empty.")
    if (!colourName) errors.push("Colour is empty.")

    const sellPrice = parseMoney(row.values.sellPrice)
    if (sellPrice === null) errors.push("Sell Price is missing or not a number.")
    else if (sellPrice < 0) errors.push("Sell Price cannot be negative.")

    // Cost is optional; a blank cell means zero rather than an error.
    const costPrice = parseMoney(row.values.costPrice) ?? 0
    if (costPrice < 0) errors.push("Cost Price cannot be negative.")

    const quantity = parseQty(row.values.quantity)
    if (quantity === null) errors.push("Quantity is missing or not a number.")
    else if (quantity < 0) errors.push("Quantity cannot be negative.")

    let barcode: string | null = barcodeRaw === "" ? null : barcodeRaw
    if (barcode) {
      if (options.existingBarcodes.has(barcode)) {
        errors.push(`Barcode ${barcode} already belongs to another variant.`)
        barcode = null
      } else {
        const firstSeen = seenBarcodes.get(barcode)
        if (firstSeen !== undefined) {
          errors.push(`Barcode ${barcode} is also on row ${firstSeen}.`)
          barcode = null
        } else {
          seenBarcodes.set(barcode, row.rowNumber)
        }
      }
    }

    const categoryId = categoryName
      ? (lookup.categories.get(normaliseKey(categoryName)) ?? null)
      : null
    const brandId = brandName
      ? (lookup.brands.get(normaliseKey(brandName)) ?? null)
      : null
    const sizeId = sizeLabel ? (lookup.sizes.get(normaliseKey(sizeLabel)) ?? null) : null
    const colourId = colourName
      ? (lookup.colours.get(normaliseKey(colourName)) ?? null)
      : null

    const note = (kind: MissingMaster["kind"], name: string) => {
      const entry = { kind, name }
      missing.push(entry)
      const key = `${kind}:${normaliseKey(name)}`
      if (!missingByKey.has(key)) missingByKey.set(key, entry)
    }

    if (categoryName && categoryId === null) note("category", categoryName)
    if (brandName && brandId === null) note("brand", brandName)
    if (sizeLabel && sizeId === null) note("size", sizeLabel)
    if (colourName && colourId === null) note("colour", colourName)

    return {
      rowNumber: row.rowNumber,
      productName,
      categoryName,
      brandName: brandName === "" ? null : brandName,
      gender: parseGender(row.values.gender),
      sizeLabel,
      colourName,
      costPrice,
      sellPrice: sellPrice ?? 0,
      quantity: quantity ?? 0,
      barcode,
      categoryId,
      brandId,
      sizeId,
      colourId,
      missing,
      errors,
    }
  })

  return {
    rows: validated,
    ready: validated.filter((r) => r.errors.length === 0 && r.missing.length === 0)
      .length,
    needsMasters: validated.filter(
      (r) => r.errors.length === 0 && r.missing.length > 0,
    ).length,
    errors: validated.filter((r) => r.errors.length > 0).length,
    missingMasters: [...missingByKey.values()],
  }
}

/** Rows that can be imported: no hard errors. Missing masters get created first. */
export function importableRows(summary: ValidationSummary): ValidatedRow[] {
  return summary.rows.filter((row) => row.errors.length === 0)
}

/** CSV of every rejected row and why, for the downloadable error report. */
export function buildErrorReport(summary: ValidationSummary): string {
  const header = "Row,Product Name,Size,Colour,Problems"
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`

  const lines = summary.rows
    .filter((row) => row.errors.length > 0)
    .map((row) =>
      [
        row.rowNumber,
        escape(row.productName),
        escape(row.sizeLabel),
        escape(row.colourName),
        escape(row.errors.join(" ")),
      ].join(","),
    )

  return [header, ...lines].join("\r\n")
}
