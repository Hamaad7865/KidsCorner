/** Must match `allowed_mime_types` on the product-images bucket (migration 033). */
export const PRODUCT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number]

/** A plain string so client components never import configuration from a server action. */
export const PRODUCT_IMAGE_ACCEPT = PRODUCT_IMAGE_TYPES.join(",")

export const MAX_PRODUCT_IMAGE_BYTES = 3 * 1024 * 1024

export function isSupportedProductImageType(value: string): value is ProductImageType {
  return PRODUCT_IMAGE_TYPES.includes(value as ProductImageType)
}
