import { z } from "zod"

import { GENDERS } from "@/lib/db-enums"

/**
 * Validation for the product form, the variant matrix and the generate-variants
 * flow. Separate from `actions.ts` because a `"use server"` module may only
 * export async functions.
 *
 * Money is validated as a plain number here and rounded to 2dp at the action
 * boundary — `selling_price` is NUMERIC(10,2), so anything finer is silently
 * truncated by Postgres and the UI would then disagree with the database.
 */

const rowId = z.number().int().positive().nullable()

/** NUMERIC(10,2) tops out at 99,999,999.99. */
const money = z
  .number()
  .min(0, "Price cannot be negative.")
  .max(99_999_999.99, "That price is too large for the database column.")

export const productSchema = z.object({
  id: rowId,
  name: z
    .string()
    .trim()
    .min(1, "Product name is required.")
    .max(120, "Keep the name under 120 characters."),
  // Required going forward — how staff identify the product — but the column
  // itself stays nullable for products that predate this field; a legacy
  // product only needs one the next time someone saves it through this form.
  productCode: z
    .string()
    .trim()
    .min(1, "Product code is required.")
    .max(40, "Keep the product code under 40 characters."),
  // NOT NULL in 001 — a product cannot exist without a category.
  categoryId: z
    .number({ error: "Pick a category." })
    .int()
    .positive("Pick a category."),
  brandId: z.number().int().positive().nullable(),
  gender: z.enum(GENDERS),
  description: z.string().trim().max(2000, "Description is too long.").nullable(),
  imageUrl: z
    .url("Enter a full image URL, or leave it blank.")
    .max(500, "That URL is too long.")
    .nullable(),
  shelfLocation: z
    .string()
    .trim()
    .max(120, "Keep the shelf location under 120 characters.")
    .nullable(),
  isActive: z.boolean(),
})

/**
 * Inline edits from the variant matrix.
 *
 * `qty_on_hand` is deliberately absent. The spec makes `stock_movements` the
 * source of truth and `qty_on_hand` a cache that only `record_stock_movement`
 * may touch, so quantity changes belong to the stock adjustment flow, not here.
 */
export const variantUpdateSchema = z.object({
  id: z.number().int().positive(),
  costPrice: money,
  sellingPrice: money,
  reorderLevel: z
    .number()
    .int("Reorder level must be a whole number.")
    .min(0, "Reorder level cannot be negative.")
    .max(100_000, "That reorder level is unrealistically large."),
  barcode: z
    .string()
    .trim()
    .min(4, "A barcode needs at least 4 characters.")
    .max(64, "That barcode is too long.")
    .nullable(),
  isActive: z.boolean(),
})

export const generateVariantsSchema = z.object({
  productId: z.number().int().positive(),
  sizeIds: z.array(z.number().int().positive()).min(1, "Pick at least one size."),
  colourIds: z
    .array(z.number().int().positive())
    .min(1, "Pick at least one colour."),
  costPrice: money,
  // NOT NULL with no default in 001, so every generated variant needs one.
  sellingPrice: money,
  reorderLevel: z.number().int().min(0).max(100_000),
})

export type ProductInput = z.infer<typeof productSchema>
export type VariantUpdateInput = z.infer<typeof variantUpdateSchema>
export type GenerateVariantsInput = z.infer<typeof generateVariantsSchema>
