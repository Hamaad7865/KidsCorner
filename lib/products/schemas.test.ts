import { describe, expect, it } from "vitest"

import { productSchema } from "./schemas"

const product = (shelfLocation: string | null) => ({
  id: null,
  name: "Chemise cotton",
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
