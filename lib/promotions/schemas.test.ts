import { describe, expect, it } from "vitest"

import { applyPromotionSchema, slowMoverDaysSchema } from "./schemas"

describe("applyPromotionSchema", () => {
  const base = { variantId: 7, promoPrice: 250, note: null }

  it("accepts a well-formed markdown", () => {
    expect(applyPromotionSchema.safeParse(base).success).toBe(true)
  })

  it("rejects a zero or negative price", () => {
    expect(applyPromotionSchema.safeParse({ ...base, promoPrice: 0 }).success).toBe(false)
    expect(applyPromotionSchema.safeParse({ ...base, promoPrice: -5 }).success).toBe(false)
  })

  it("trims the note and caps its length", () => {
    const parsed = applyPromotionSchema.parse({ ...base, note: "  clearing summer stock  " })
    expect(parsed.note).toBe("clearing summer stock")
    expect(applyPromotionSchema.safeParse({ ...base, note: "x".repeat(201) }).success).toBe(false)
  })

  // The never-loss floor (promo >= cost) and the must-be-a-reduction rule are
  // enforced in the apply_promotion RPC, not here — they need the variant's
  // cost and current price, which the form does not carry.
})

describe("slowMoverDaysSchema", () => {
  it("accepts a sane day count", () => {
    expect(slowMoverDaysSchema.safeParse({ days: 30 }).success).toBe(true)
    expect(slowMoverDaysSchema.safeParse({ days: 1 }).success).toBe(true)
  })

  it("rejects zero, fractions and absurd spans", () => {
    expect(slowMoverDaysSchema.safeParse({ days: 0 }).success).toBe(false)
    expect(slowMoverDaysSchema.safeParse({ days: 1.5 }).success).toBe(false)
    expect(slowMoverDaysSchema.safeParse({ days: 4000 }).success).toBe(false)
  })
})
