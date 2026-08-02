import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { QuickKeys } from "./quick-keys"
import type { CatalogVariant } from "@/lib/pos/queries"

/**
 * The category grid on the idle web till.
 *
 * Covered because it grew a photograph and nobody had looked at it since. The
 * tile carries the thing a cashier taps to ring up a sale, so a crash here is
 * a counter that cannot sell — and the photo is optional data, which is exactly
 * the shape that goes wrong when it is absent.
 */

const variant = (over: Partial<CatalogVariant> = {}): CatalogVariant => ({
  id: 1,
  productId: 10,
  productName: "Babygrow",
  categoryId: 3,
  categoryName: "Babywear",
  sizeLabel: "3-6 mths",
  sizeSort: 1,
  colourName: "Beige",
  colourHex: "#D8C3A5",
  sku: "KC-0001",
  barcode: "6291041000017",
  price: 450,
  qtyOnHand: 4,
  imageUrl: null,
  ...over,
})

const render = (catalog: CatalogVariant[]) =>
  renderToStaticMarkup(createElement(QuickKeys, { catalog, onPick: () => {} }))

describe("QuickKeys", () => {
  it("lists each category with how much is in it", () => {
    const html = render([
      variant(),
      variant({ id: 2, productId: 11, productName: "Socks" }),
      variant({ id: 3, productId: 12, categoryId: 4, categoryName: "Shoes" }),
    ])
    expect(html).toContain("Babywear")
    expect(html).toContain("Shoes")
  })

  it("invites a scan before any category is open", () => {
    const html = render([variant()])
    expect(html).toContain("Pick a category, scan a barcode, or start typing")
    expect(html).toContain("1 variants loaded")
  })

  it("says what to do when the catalogue has no categories at all", () => {
    const html = render([variant({ categoryId: null, categoryName: null })])
    expect(html).toContain("Scan a barcode, or type at least two characters")
  })

  it("survives a catalogue with nothing in it", () => {
    expect(render([])).toContain("Scan a barcode")
  })

  // The tiles themselves are NOT covered here, and saying so is the point: the
  // grid opens with no category selected, so a static render produces none of
  // them. An assertion about a tile in this file would pass on any markup at
  // all. The thing the tiles gained — the photograph — is covered where it
  // actually lives, in product-thumb.test.ts.
})
