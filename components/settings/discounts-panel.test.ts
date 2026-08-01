import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { DiscountsPanel } from "./discounts-panel"
import type { DiscountRule } from "@/lib/discounts/rules"

const rule = (over: Partial<DiscountRule> = {}): DiscountRule => ({
  id: 1,
  name: "Staff discount",
  code: "STAFF",
  kind: "percent",
  value: 10,
  scope: "sale",
  categoryId: null,
  minSpend: 0,
  maxAmount: null,
  startsOn: null,
  endsOn: null,
  requiresManager: true,
  isActive: true,
  ...over,
})

const render = (discounts: DiscountRule[], canManage = true) =>
  renderToStaticMarkup(
    createElement(DiscountsPanel, { discounts, categories: [], canManage }),
  )

describe("DiscountsPanel", () => {
  it("offers a live rule a way to be paused in one move", () => {
    // The action behind this switch existed with no caller: pausing a rule
    // meant opening its dialog, finding a switch and saving.
    const html = render([rule()])
    expect(html).toContain("Pause Staff discount")
  })

  it("offers a paused rule a way back", () => {
    const html = render([rule({ isActive: false })])
    expect(html).toContain("Resume Staff discount")
    expect(html).toContain("Inactive")
  })

  it("reflects the rule's state in the switch, not just in a badge", () => {
    // A switch that always read "off" would still look like a control and
    // would tell the owner the opposite of the truth.
    expect(render([rule({ isActive: true })])).toContain('aria-checked="true"')
    expect(render([rule({ isActive: false })])).toContain('aria-checked="false"')
  })

  it("gives a manager no controls at all", () => {
    // Discounts give money away; changing the rules is the owner's.
    const html = render([rule()], false)
    const controls = html.match(/<button\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((c) => /\sdisabled(=|\s|>)/.test(c))).toBe(true)
  })

  it("says what the shop loses by having no rules yet", () => {
    const html = render([])
    expect(html).toContain("No discounts yet")
    expect(html).toContain("nothing records the reason")
  })
})
