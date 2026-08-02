import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ProductThumb } from "./product-thumb"

/**
 * The garment's photograph, wherever it appears — the product list, the product
 * page, and the POS quick keys all render this one component.
 *
 * Most of a shop's catalogue has no photo for a long time, so the absent case
 * is the normal one, and it is the one that has to look deliberate rather than
 * broken.
 */
describe("ProductThumb", () => {
  it("shows the photograph when there is one", () => {
    const html = renderToStaticMarkup(
      createElement(ProductThumb, {
        src: "https://example.test/storage/v1/object/public/product-images/p/a.jpg",
        name: "Babygrow Long Sleeve",
      }),
    )
    expect(html).toContain("<img")
    expect(html).toContain("product-images/p/a.jpg")
  })

  it("falls back to initials, not to an empty grey square", () => {
    // Nineteen identical grey boxes are worse than no column at all; initials
    // differ from row to row, so the eye can still keep its place in a list.
    const html = renderToStaticMarkup(
      createElement(ProductThumb, { src: null, name: "Babygrow Long Sleeve" }),
    )
    expect(html).not.toContain("<img")
    expect(html).toContain("BL")
  })

  it("takes at most two initials", () => {
    const html = renderToStaticMarkup(
      createElement(ProductThumb, { src: null, name: "Cotton tee short sleeve" }),
    )
    expect(html).toContain("CT")
    expect(html).not.toContain("CTSS")
  })

  it("shows a dash rather than nothing for a nameless product", () => {
    const html = renderToStaticMarkup(
      createElement(ProductThumb, { src: null, name: "   " }),
    )
    expect(html).toContain("—")
  })

  it("scales its own text with the box", () => {
    // The same component is 40px in a list row and 64px on a product page; a
    // fixed font size looks lost in one and cramped in the other.
    const small = renderToStaticMarkup(
      createElement(ProductThumb, { src: null, name: "Socks", size: 40 }),
    )
    const large = renderToStaticMarkup(
      createElement(ProductThumb, { src: null, name: "Socks", size: 64 }),
    )
    expect(small).not.toEqual(large)
    expect(small).toContain("width:40px")
    expect(large).toContain("width:64px")
  })
})
