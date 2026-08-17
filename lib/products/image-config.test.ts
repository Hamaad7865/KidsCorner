import { describe, expect, it } from "vitest"

import {
  isSupportedProductImageType,
  PRODUCT_IMAGE_ACCEPT,
} from "./image-config"

describe("product image configuration", () => {
  it("provides a browser-safe accept value for the supported image formats", () => {
    expect(PRODUCT_IMAGE_ACCEPT).toBe("image/jpeg,image/png,image/webp")
  })

  it("accepts JPEG, PNG and WebP while rejecting other file types", () => {
    expect(isSupportedProductImageType("image/jpeg")).toBe(true)
    expect(isSupportedProductImageType("image/png")).toBe(true)
    expect(isSupportedProductImageType("image/webp")).toBe(true)
    expect(isSupportedProductImageType("image/gif")).toBe(false)
  })
})
