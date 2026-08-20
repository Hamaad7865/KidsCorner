import { describe, expect, it } from "vitest"

import { productSchema } from "./schemas"

const product = (shelfLocation: string | null, productCode = "PC-1") => ({
  id: null,
  name: "Chemise cotton",
  productCode,
  categoryId: 1,
  brandId: null,
  gender: "unisex" as const,
  description: null,
  imageUrl: null,
  shelfLocation,
  isActive: true,
})

describe("product shelf location", () => {
  it("trims an optional shelf location", () => {
    const parsed = productSchema.parse(product("  A12  "))

    expect("shelfLocation" in parsed ? parsed.shelfLocation : undefined).toBe("A12")
  })

  it("accepts a product with no shelf assigned", () => {
    const parsed = productSchema.parse(product(null))

    expect("shelfLocation" in parsed ? parsed.shelfLocation : undefined).toBeNull()
  })
})

describe("product code", () => {
  it("trims it", () => {
    const parsed = productSchema.parse(product(null, "  PC-1023  "))

    expect(parsed.productCode).toBe("PC-1023")
  })

  it("is required", () => {
    const result = productSchema.safeParse(product(null, ""))

    expect(result.success).toBe(false)
  })

  it("refuses more than 40 characters", () => {
    const result = productSchema.safeParse(product(null, "x".repeat(41)))

    expect(result.success).toBe(false)
  })
})
