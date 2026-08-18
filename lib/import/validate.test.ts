import { describe, expect, it } from "vitest"

import type { Brand, Category, Colour, Size } from "@/lib/master-data/queries"

import type { ImportField, RawRow } from "./columns"
import { buildLookup, validateRows, type MasterLookup } from "./validate"

/**
 * Size is two columns now — Age Range and Shoe Size — because the schema has
 * two size_types and the importer used to guess which one a label was. These
 * cover the rule that replaced the guess: exactly one column per row, and the
 * column decides the type it resolves and creates against.
 */

// Only the fields buildLookup reads matter at runtime; cast past the full DB row.
const lookup: MasterLookup = buildLookup({
  categories: [
    { id: 10, name: "T-Shirts" },
    { id: 11, name: "Sandals" },
  ] as unknown as Category[],
  brands: [] as Brand[],
  colours: [
    { id: 20, name: "Navy" },
    { id: 21, name: "Pink" },
  ] as unknown as Colour[],
  sizes: [
    { id: 1, label: "2-3 yrs", size_type: "age_range" },
    { id: 2, label: "EU 24", size_type: "shoe_size" },
    { id: 3, label: "M", size_type: "letter_size" },
  ] as unknown as Size[],
})

const NO_BARCODES = { existingBarcodes: new Set<string>() }

function row(rowNumber: number, values: Partial<Record<ImportField, string>>): RawRow {
  return { rowNumber, values }
}

/** A complete, resolvable row; spread over it to vary just the size columns. */
const base = {
  productName: "Item",
  category: "T-Shirts",
  colour: "Navy",
  sellPrice: "320",
  quantity: "5",
} satisfies Partial<Record<ImportField, string>>

describe("size columns", () => {
  it("takes an age from the Age Range column as an age_range size", () => {
    const [r] = validateRows([row(2, { ...base, ageRange: "2-3 yrs" })], lookup, NO_BARCODES).rows
    expect(r.errors).toEqual([])
    expect(r.sizeType).toBe("age_range")
    expect(r.sizeLabel).toBe("2-3 yrs")
    expect(r.sizeId).toBe(1)
  })

  it("takes a shoe size from the Shoe Size column as a shoe_size size", () => {
    const [r] = validateRows(
      [row(2, { ...base, category: "Sandals", colour: "Pink", shoeSize: "EU 24" })],
      lookup,
      NO_BARCODES,
    ).rows
    expect(r.errors).toEqual([])
    expect(r.sizeType).toBe("shoe_size")
    expect(r.sizeId).toBe(2)
  })

  it("takes a letter from the Clothing Size column as a letter_size size", () => {
    const [r] = validateRows([row(2, { ...base, clothingSize: "M" })], lookup, NO_BARCODES).rows
    expect(r.errors).toEqual([])
    expect(r.sizeType).toBe("letter_size")
    expect(r.sizeId).toBe(3)
  })

  it("rejects a row that fills more than one size column", () => {
    const [r] = validateRows(
      [row(2, { ...base, ageRange: "2-3 yrs", clothingSize: "M" })],
      lookup,
      NO_BARCODES,
    ).rows
    expect(r.errors).toContain("Fill only one of Age Range, Clothing Size or Shoe Size.")
    expect(r.sizeType).toBeNull()
    expect(r.sizeId).toBeNull()
  })

  it("rejects a row that fills no size column", () => {
    const [r] = validateRows([row(2, { ...base })], lookup, NO_BARCODES).rows
    expect(r.errors).toContain("A size is required — fill Age Range, Clothing Size or Shoe Size.")
    expect(r.sizeType).toBeNull()
  })

  it("does not cross-match a shoe label placed in the age column", () => {
    // "EU 24" exists, but as a shoe size. Read from the age column it is a
    // different size that must be created, not silently the id-2 shoe row.
    const [r] = validateRows([row(2, { ...base, ageRange: "EU 24" })], lookup, NO_BARCODES).rows
    expect(r.sizeId).toBeNull()
    expect(r.missing).toContainEqual({ kind: "size", name: "EU 24", sizeType: "age_range" })
  })

  it("keeps same-labelled age and shoe sizes as two things to create", () => {
    const summary = validateRows(
      [
        row(2, { ...base, ageRange: "24" }),
        row(3, { ...base, category: "Sandals", colour: "Pink", shoeSize: "24" }),
      ],
      lookup,
      NO_BARCODES,
    )
    const sizes = summary.missingMasters.filter((m) => m.kind === "size")
    expect(sizes).toHaveLength(2)
    expect(sizes.map((s) => s.sizeType).sort()).toEqual(["age_range", "shoe_size"])
  })
})

describe("stock and shelf locations", () => {
  it("defaults a blank Location to Shop and accepts Warehouse", () => {
    const summary = validateRows(
      [
        row(2, { ...base, ageRange: "2-3 yrs" }),
        row(3, { ...base, clothingSize: "M", location: " warehouse " }),
      ],
      lookup,
      NO_BARCODES,
    )

    expect(summary.rows[0].location).toBe("Shop")
    expect(summary.rows[1].location).toBe("Warehouse")
    expect(summary.rows.flatMap((r) => r.errors)).toEqual([])
  })

  it("rejects an unknown Location instead of silently allocating it", () => {
    const [r] = validateRows(
      [row(2, { ...base, ageRange: "2-3 yrs", location: "Back room" })],
      lookup,
      NO_BARCODES,
    ).rows

    expect(r.errors).toContain("Location must be Shop or Warehouse.")
  })

  it("allows one variant and barcode to repeat across Shop and Warehouse", () => {
    const summary = validateRows(
      [
        row(2, {
          ...base,
          ageRange: "2-3 yrs",
          barcode: "6291041500213",
          shelfLocation: "A12",
          location: "Shop",
        }),
        row(3, {
          ...base,
          ageRange: "2-3 yrs",
          barcode: "6291041500213",
          shelfLocation: "A12",
          location: "Warehouse",
        }),
      ],
      lookup,
      NO_BARCODES,
    )

    expect(summary.rows.flatMap((r) => r.errors)).toEqual([])
    expect(summary.rows.map((r) => r.barcode)).toEqual([
      "6291041500213",
      "6291041500213",
    ])
  })

  it("still rejects one barcode assigned to different variants", () => {
    const summary = validateRows(
      [
        row(2, { ...base, ageRange: "2-3 yrs", barcode: "6291041500213" }),
        row(3, { ...base, clothingSize: "M", barcode: "6291041500213" }),
      ],
      lookup,
      NO_BARCODES,
    )

    expect(summary.rows[1].errors).toContain(
      "Barcode 6291041500213 is also on row 2.",
    )
  })

  it("rejects conflicting prices for repeated location rows", () => {
    const summary = validateRows(
      [
        row(2, { ...base, ageRange: "2-3 yrs", location: "Shop" }),
        row(3, {
          ...base,
          ageRange: "2-3 yrs",
          sellPrice: "350",
          location: "Warehouse",
        }),
      ],
      lookup,
      NO_BARCODES,
    )

    expect(summary.rows.flatMap((r) => r.errors)).toContain(
      "Repeated variant has conflicting Sell Price values.",
    )
  })

  it("rejects conflicting non-empty shelf locations for one product", () => {
    const summary = validateRows(
      [
        row(2, { ...base, ageRange: "2-3 yrs", shelfLocation: "A12" }),
        row(3, { ...base, clothingSize: "M", shelfLocation: "B09" }),
      ],
      lookup,
      NO_BARCODES,
    )

    expect(summary.rows.flatMap((r) => r.errors)).toContain(
      'Product "Item" has conflicting Shelf Location values.',
    )
  })
})
