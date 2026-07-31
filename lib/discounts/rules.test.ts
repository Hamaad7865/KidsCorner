import { describe, expect, it } from "vitest"

import {
  applyRule,
  checkEligibility,
  discountAmountFor,
  discountBaseFor,
  manualDiscount,
  type DiscountRule,
} from "./rules"

/**
 * The rules that decide how much comes off a sale.
 *
 * Every case here is money. A wrong answer is not a layout glitch — it is the
 * shop charging a price nobody agreed to, and it stays invisible until a
 * customer is standing at the counter.
 */

function rule(over: Partial<DiscountRule> = {}): DiscountRule {
  return {
    id: 1,
    name: "Staff discount",
    code: null,
    kind: "percent",
    value: 10,
    scope: "sale",
    categoryId: null,
    minSpend: 0,
    maxAmount: null,
    startsOn: null,
    endsOn: null,
    requiresManager: false,
    isActive: true,
    ...over,
  }
}

describe("discountAmountFor", () => {
  it("takes a percentage of the base", () => {
    expect(discountAmountFor("percent", 10, 1_451.42)).toBe(145.14)
  })

  it("takes a flat amount as itself", () => {
    expect(discountAmountFor("amount", 250, 1_451.42)).toBe(250)
  })

  it("never exceeds the base, so a total cannot go negative", () => {
    expect(discountAmountFor("amount", 5_000, 320)).toBe(320)
    expect(discountAmountFor("percent", 150, 320)).toBe(320)
  })

  it("honours the rule's own ceiling", () => {
    // 10% of 10,000 is 1,000, but this rule caps at 200.
    expect(discountAmountFor("percent", 10, 10_000, 200)).toBe(200)
  })

  it("clamps a negative or non-finite input to zero rather than inverting", () => {
    // A negative discount would ADD money to a sale.
    expect(discountAmountFor("amount", -50, 500)).toBe(0)
    expect(discountAmountFor("percent", 10, -500)).toBe(0)
    expect(discountAmountFor("percent", Number.NaN, 500)).toBe(0)
    expect(discountAmountFor("percent", 10, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it("rounds to the cent, not to whatever float arithmetic produced", () => {
    // 33.333...% of 100 is 33.33, and must not carry a long tail into money.
    expect(discountAmountFor("percent", 33.333, 100)).toBe(33.33)
  })
})

describe("discountBaseFor", () => {
  const basket = 1_000
  const categoryTotals = new Map([
    [7, 400], // Babywear
    [9, 250], // Footwear
  ])

  it("measures a sale-wide rule against the whole basket", () => {
    expect(discountBaseFor(rule({ scope: "sale", categoryId: null }), basket, categoryTotals))
      .toBe(basket)
  })

  it("measures a category rule against that category's lines only", () => {
    // The bug this pins: a category rule settled against the whole basket
    // gives away far more than the category is worth.
    expect(discountBaseFor(rule({ scope: "sale", categoryId: 7 }), basket, categoryTotals))
      .toBe(400)
  })

  it("gives a category rule nothing when the basket has none of it", () => {
    expect(discountBaseFor(rule({ categoryId: 99 }), basket, categoryTotals)).toBe(0)
  })

  it("refuses a line-scoped rule that names no category", () => {
    // There is no line target in the payload and no category to stand in for
    // one, so there is no honest base. Null means "refuse", not "use zero".
    expect(discountBaseFor(rule({ scope: "line", categoryId: null }), basket, categoryTotals))
      .toBeNull()
  })

  it("still resolves a line-scoped rule that DOES name a category", () => {
    expect(discountBaseFor(rule({ scope: "line", categoryId: 9 }), basket, categoryTotals))
      .toBe(250)
  })

  it("never returns a negative base", () => {
    expect(discountBaseFor(rule({ categoryId: null }), -50, categoryTotals)).toBe(0)
    expect(discountBaseFor(rule({ categoryId: 7 }), 1_000, new Map([[7, -10]]))).toBe(0)
  })
})

describe("checkEligibility", () => {
  const today = "2026-07-31"

  it("accepts a live rule inside its window and over the minimum", () => {
    expect(
      checkEligibility(
        rule({ startsOn: "2026-07-01", endsOn: "2026-08-31", minSpend: 500 }),
        1_000,
        today,
      ),
    ).toEqual({ eligible: true })
  })

  it("refuses an inactive rule", () => {
    const result = checkEligibility(rule({ isActive: false }), 1_000, today)
    expect(result.eligible).toBe(false)
  })

  it("refuses before it starts and after it ends", () => {
    expect(checkEligibility(rule({ startsOn: "2026-08-01" }), 1_000, today).eligible).toBe(false)
    expect(checkEligibility(rule({ endsOn: "2026-07-30" }), 1_000, today).eligible).toBe(false)
  })

  it("treats the first and last day as inside the window", () => {
    expect(checkEligibility(rule({ startsOn: today }), 1_000, today).eligible).toBe(true)
    expect(checkEligibility(rule({ endsOn: today }), 1_000, today).eligible).toBe(true)
  })

  it("refuses under the minimum spend but accepts exactly at it", () => {
    expect(checkEligibility(rule({ minSpend: 500 }), 499.99, today).eligible).toBe(false)
    expect(checkEligibility(rule({ minSpend: 500 }), 500, today).eligible).toBe(true)
  })

  it("explains itself, because the cashier has to tell the customer", () => {
    const result = checkEligibility(rule({ endsOn: "2026-06-30" }), 1_000, today)
    expect(result.eligible).toBe(false)
    if (!result.eligible) expect(result.reason).toContain("2026-06-30")
  })
})

describe("applyRule", () => {
  it("copies the label rather than referencing the rule", () => {
    // Renaming a rule next month must not restate what this receipt said.
    const applied = applyRule(rule({ name: "End of season" }), 1_000)
    expect(applied.label).toBe("End of season")
    expect(applied.discountId).toBe(1)
    expect(applied.amount).toBe(100)
  })

  it("records the approver only when one was given", () => {
    expect(applyRule(rule(), 1_000).approvedBy).toBeNull()
    expect(applyRule(rule(), 1_000, "manager-uuid").approvedBy).toBe("manager-uuid")
  })
})

describe("manualDiscount", () => {
  it("has no rule behind it", () => {
    expect(manualDiscount(50, 1_000).discountId).toBeNull()
  })

  it("is clamped to the base like any other", () => {
    expect(manualDiscount(5_000, 320).amount).toBe(320)
  })
})
