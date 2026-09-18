import { createElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("next/navigation", () => ({
  usePathname: () => "/products",
  useSearchParams: () => new URLSearchParams(""),
}))

import { NavigationProgress, startsTransition } from "./navigation-progress"

describe("startsTransition", () => {
  const here = "/products?status=active"

  it("starts for a different module", () => {
    expect(startsTransition("/sales", here, false)).toBe(true)
  })

  it("starts for a filter change on the same page", () => {
    // TabLinks navigate by search params; those transitions load too.
    expect(startsTransition("/products?status=slow", here, false)).toBe(true)
  })

  it("ignores a re-click of the active module", () => {
    expect(startsTransition("/products?status=active", here, false)).toBe(false)
  })

  it("ignores a same-page hash jump", () => {
    expect(startsTransition("/products?status=active#table", here, false)).toBe(false)
  })

  it("ignores external addresses and protocol-relative URLs", () => {
    expect(startsTransition("https://example.com/x", here, false)).toBe(false)
    expect(startsTransition("//example.com/x", here, false)).toBe(false)
  })

  it("ignores new-tab and modified clicks", () => {
    expect(startsTransition("/sales", here, true)).toBe(false)
  })

  it("ignores a missing href", () => {
    expect(startsTransition(null, here, false)).toBe(false)
  })
})

describe("NavigationProgress", () => {
  it("parks invisible: no width, no opacity, out of the a11y tree and off paper", () => {
    const html = renderToStaticMarkup(createElement(NavigationProgress))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain("fixed")
    expect(html).toContain("print:hidden")
    expect(html).toContain("bg-brand-600")
    // Parked state renders as zero width and fully transparent.
    expect(html).toContain("width:0%")
    expect(html).toContain("opacity:0")
  })
})
