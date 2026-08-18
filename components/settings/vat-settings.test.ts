import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { VatSettings } from "./vat-settings"
import type { VatPolicy } from "@/lib/vat/policy"

// The action is a "use server" module; static rendering never calls it, but the
// import must resolve, so stub it.
vi.mock("@/lib/settings/vat-actions", () => ({ saveVatPolicy: vi.fn() }))

const disabledPolicy: VatPolicy = {
  id: 2,
  enabled: false,
  configuredRate: 0.15,
  effectiveRate: 0,
  vatNumber: null,
  createdAt: "2026-08-18T09:00:00Z",
}

const enabledPolicy: VatPolicy = {
  id: 3,
  enabled: true,
  configuredRate: 0.15,
  effectiveRate: 0.15,
  vatNumber: "VAT20123456",
  createdAt: "2026-08-18T10:00:00Z",
}

const render = (policy: VatPolicy, canManage = true) =>
  renderToStaticMarkup(createElement(VatSettings, { policy, canManage }))

describe("VatSettings", () => {
  it("defaults to a disabled status and the saved rate", () => {
    const html = render(disabledPolicy)
    expect(html).toContain("VAT disabled")
    expect(html).toContain("Rate saved at 15%")
    expect(html).toContain("Not VAT registered")
  })

  it("offers the owner a way to enable VAT when disabled", () => {
    const html = render(disabledPolicy)
    expect(html).toContain("Enable VAT")
    expect(html).not.toContain("Disable VAT")
  })

  it("shows the active status, rate and number when enabled", () => {
    const html = render(enabledPolicy)
    expect(html).toContain("VAT active · 15%")
    expect(html).toContain("VAT20123456")
    expect(html).toContain("Disable VAT")
  })

  it("states the future-only effect in the always-visible copy", () => {
    // The confirmation dialog spells this out in full, but it only renders when
    // opened (Base UI portals it), so the guarantee is also carried by the
    // card's own supporting text, which static render can see.
    const html = render(disabledPolicy)
    expect(html).toContain("New sales record no VAT")
  })

  it("states that history is preserved in the always-visible copy", () => {
    const html = render(enabledPolicy)
    expect(html).toContain("Turning VAT off never changes past sales")
  })

  it("prepares the rate and number inputs for a save-without-toggle", () => {
    const html = render(disabledPolicy)
    expect(html).toContain('name="ratePercent"')
    expect(html).toContain('name="vatNumber"')
    expect(html).toContain("Save details")
    // The intent field defaults to save so a plain submit never toggles.
    expect(html).toContain('name="intent"')
    expect(html).toContain('value="save"')
  })

  it("gives a manager the status but no editing controls", () => {
    const html = render(enabledPolicy, false)
    expect(html).toContain("VAT active · 15%")
    expect(html).toContain("Only the owner can change this")
    expect(html).not.toContain("Save details")
    expect(html).not.toContain("Disable VAT")
    // The inputs are shown read-only.
    expect(html).toContain("disabled")
  })

  it("seeds the rate input from the configured rate", () => {
    const html = render(disabledPolicy)
    expect(html).toContain('value="15"')
  })
})
