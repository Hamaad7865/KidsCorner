import type { SizeType } from "@/lib/db-enums"
import type { Brand, Category, Colour, Size } from "@/lib/master-data/queries"

import {
  normaliseKey,
  parseGender,
  parseMoney,
  parseQty,
  parseStockLocation,
  type ImportField,
  type RawRow,
  type StockLocationName,
} from "./columns"

/** Lookup key for a size: unique per (size_type, label), so both must key it. */
function sizeKey(sizeType: SizeType, label: string): string {
  return `${sizeType}:${normaliseKey(label)}`
}

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
  /**
   * Keyed by (size_type, label) via `sizeKey`, because that pair is what is
   * unique: "24" can exist both as an age in months and as an EU shoe size, and
   * the age column and the shoe column must resolve to different rows.
   */
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
    sizes: new Map(data.sizes.map((s) => [sizeKey(s.size_type, s.label), s.id])),
  }
}

/** A master value the sheet references that does not exist yet. */
export type MissingMaster = {
  kind: "category" | "brand" | "colour" | "size"
  /** The value exactly as typed in the sheet, used when creating it. */
  name: string
  /** Sizes only: the type to create it as, decided by which column it came from. */
  sizeType?: SizeType
}

export type ValidatedRow = {
  rowNumber: number
  productName: string
  productCode: string | null
  categoryName: string
  brandName: string | null
  gender: "boy" | "girl" | "unisex"
  shelfLocation: string | null
  location: StockLocationName
  sizeLabel: string
  /** Which column the size came from; null when neither or both were filled. */
  sizeType: SizeType | null
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
  options: {
    existingBarcodes: ReadonlySet<string>
    /**
     * Lowercased — product code uniqueness is case-insensitive, so the caller
     * folds case before building this set and every comparison below folds
     * the sheet's value the same way.
     */
    existingProductCodes: ReadonlySet<string>
  },
): ValidationSummary {
  // Barcode must be unique across the whole file as well as against the
  // database — two rows claiming the same barcode would collide on insert.
  const seenBarcodes = new Map<
    string,
    { rowNumber: number; variantKey: string }
  >()
  // Product code the same way, but scoped to the product rather than the
  // variant: every size/colour row for one product is expected to repeat it.
  const seenProductCodes = new Map<
    string,
    { rowNumber: number; productKey: string }
  >()
  const missingByKey = new Map<string, MissingMaster>()

  const validated = rows.map<ValidatedRow>((row) => {
    const errors: string[] = []
    const missing: MissingMaster[] = []

    const productName = text(row, "productName")
    const categoryName = text(row, "category")
    const brandName = text(row, "brand")
    const colourName = text(row, "colour")
    const barcodeRaw = text(row, "barcode")
    const productCodeRaw = text(row, "productCode")
    const shelfLocationRaw = text(row, "shelfLocation")
    const shelfLocation = shelfLocationRaw === "" ? null : shelfLocationRaw
    const parsedLocation = parseStockLocation(row.values.location)
    const location = parsedLocation ?? "Shop"

    if (parsedLocation === null) {
      errors.push("Location must be Shop or Warehouse.")
    }

    // One size per variant, in exactly one of the three columns: an age or a
    // letter for clothing, an EU number for footwear. Which column it came from
    // *is* the size_type, so the importer never guesses the type from the label.
    const sizeColumns: { label: string; type: SizeType }[] = [
      { label: text(row, "ageRange"), type: "age_range" },
      { label: text(row, "clothingSize"), type: "letter_size" },
      { label: text(row, "shoeSize"), type: "shoe_size" },
    ]
    const sizeCandidates = sizeColumns.filter((c) => c.label !== "")

    let sizeLabel = ""
    let sizeType: SizeType | null = null
    if (sizeCandidates.length > 1) {
      errors.push("Fill only one of Age Range, Clothing Size or Shoe Size.")
    } else if (sizeCandidates.length === 1) {
      sizeLabel = sizeCandidates[0].label
      sizeType = sizeCandidates[0].type
    } else {
      errors.push("A size is required — fill Age Range, Clothing Size or Shoe Size.")
    }

    if (!productName) errors.push("Product Name is empty.")
    if (!categoryName) errors.push("Category is empty.")
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

    const variantKey = [
      normaliseKey(categoryName),
      normaliseKey(productName),
      sizeType ?? "invalid-size",
      normaliseKey(sizeLabel),
      normaliseKey(colourName),
    ].join(":")
    // The variant key's first two components — a product's rows share one
    // code, the way they share one shelf location, regardless of size/colour.
    const productKey = [normaliseKey(categoryName), normaliseKey(productName)].join(":")

    let barcode: string | null = barcodeRaw === "" ? null : barcodeRaw
    if (barcode) {
      if (options.existingBarcodes.has(barcode)) {
        errors.push(`Barcode ${barcode} already belongs to another variant.`)
        barcode = null
      } else {
        const firstSeen = seenBarcodes.get(barcode)
        if (firstSeen !== undefined && firstSeen.variantKey !== variantKey) {
          errors.push(`Barcode ${barcode} is also on row ${firstSeen.rowNumber}.`)
          barcode = null
        } else if (firstSeen === undefined) {
          seenBarcodes.set(barcode, { rowNumber: row.rowNumber, variantKey })
        }
      }
    }

    let productCode: string | null = productCodeRaw === "" ? null : productCodeRaw
    if (productCode) {
      const codeKey = productCode.toLowerCase()
      if (options.existingProductCodes.has(codeKey)) {
        errors.push(`Product code ${productCode} already belongs to another product.`)
        productCode = null
      } else {
        const firstSeen = seenProductCodes.get(codeKey)
        if (firstSeen !== undefined && firstSeen.productKey !== productKey) {
          errors.push(`Product code ${productCode} is also on row ${firstSeen.rowNumber}.`)
          productCode = null
        } else if (firstSeen === undefined) {
          seenProductCodes.set(codeKey, { rowNumber: row.rowNumber, productKey })
        }
      }
    }

    const categoryId = categoryName
      ? (lookup.categories.get(normaliseKey(categoryName)) ?? null)
      : null
    const brandId = brandName
      ? (lookup.brands.get(normaliseKey(brandName)) ?? null)
      : null
    const sizeId =
      sizeType && sizeLabel ? (lookup.sizes.get(sizeKey(sizeType, sizeLabel)) ?? null) : null
    const colourId = colourName
      ? (lookup.colours.get(normaliseKey(colourName)) ?? null)
      : null

    const note = (kind: MissingMaster["kind"], name: string, type?: SizeType) => {
      const entry: MissingMaster = type ? { kind, name, sizeType: type } : { kind, name }
      missing.push(entry)
      // The type is part of the identity: an age "24" and a shoe "24" are two
      // different sizes to create, so they must not dedup onto each other.
      const key = `${kind}:${type ?? ""}:${normaliseKey(name)}`
      if (!missingByKey.has(key)) missingByKey.set(key, entry)
    }

    if (categoryName && categoryId === null) note("category", categoryName)
    if (brandName && brandId === null) note("brand", brandName)
    if (sizeType && sizeLabel && sizeId === null) note("size", sizeLabel, sizeType)
    if (colourName && colourId === null) note("colour", colourName)

    return {
      rowNumber: row.rowNumber,
      productName,
      productCode,
      categoryName,
      brandName: brandName === "" ? null : brandName,
      gender: parseGender(row.values.gender),
      shelfLocation,
      location,
      sizeLabel,
      sizeType,
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

  const addError = (row: ValidatedRow, message: string) => {
    if (!row.errors.includes(message)) row.errors.push(message)
  }

  // Repeated rows are how one physical variant receives stock at both
  // locations. They still describe one variant, so values that would mutate
  // that row must agree rather than becoming dependent on spreadsheet order.
  const variants = new Map<string, ValidatedRow[]>()
  for (const row of validated) {
    if (!row.productName || !row.categoryName || !row.sizeType || !row.colourName) {
      continue
    }
    const key = [
      normaliseKey(row.categoryName),
      normaliseKey(row.productName),
      row.sizeType,
      normaliseKey(row.sizeLabel),
      normaliseKey(row.colourName),
    ].join(":")
    const group = variants.get(key) ?? []
    group.push(row)
    variants.set(key, group)
  }

  const flagVariantConflict = <T>(
    rows: ValidatedRow[],
    label: string,
    valueOf: (row: ValidatedRow) => T,
  ) => {
    if (new Set(rows.map(valueOf)).size <= 1) return
    const message = `Repeated variant has conflicting ${label} values.`
    rows.forEach((row) => addError(row, message))
  }

  for (const rows of variants.values()) {
    if (rows.length < 2) continue
    flagVariantConflict(rows, "Cost Price", (row) => row.costPrice)
    flagVariantConflict(rows, "Sell Price", (row) => row.sellPrice)
    flagVariantConflict(rows, "Barcode", (row) => row.barcode ?? "")
  }

  // Shelf location belongs to the product rather than an individual variant.
  // Blank cells are intentionally ignored so old spreadsheets, or sheets that
  // fill the value only once, can coexist with a non-empty shelf value.
  const products = new Map<string, ValidatedRow[]>()
  for (const row of validated) {
    if (!row.productName) continue
    const key = normaliseKey(row.productName)
    const group = products.get(key) ?? []
    group.push(row)
    products.set(key, group)
  }
  for (const rows of products.values()) {
    const shelves = new Set(
      rows
        .map((row) => row.shelfLocation)
        .filter((value): value is string => value !== null)
        .map(normaliseKey),
    )
    if (shelves.size <= 1) continue
    const message = `Product "${rows[0].productName}" has conflicting Shelf Location values.`
    rows.forEach((row) => addError(row, message))
  }

  // Product code, same rule as shelf location: one value per product, blanks
  // ignored so it only needs filling in on one row.
  for (const rows of products.values()) {
    const codes = new Set(
      rows
        .map((row) => row.productCode)
        .filter((value): value is string => value !== null)
        .map((value) => value.toLowerCase()),
    )
    if (codes.size <= 1) continue
    const message = `Product "${rows[0].productName}" has conflicting Product Code values.`
    rows.forEach((row) => addError(row, message))
  }

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
  const header = "Row,Product Name,Product Code,Size,Colour,Shelf Location,Location,Problems"
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`

  const lines = summary.rows
    .filter((row) => row.errors.length > 0)
    .map((row) =>
      [
        row.rowNumber,
        escape(row.productName),
        escape(row.productCode ?? ""),
        escape(row.sizeLabel),
        escape(row.colourName),
        escape(row.shelfLocation ?? ""),
        escape(row.location),
        escape(row.errors.join(" ")),
      ].join(","),
    )

  return [header, ...lines].join("\r\n")
}
