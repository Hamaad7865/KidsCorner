import { z } from "zod"

import { SIZE_TYPES } from "@/lib/db-enums"

/**
 * Validation for the master data forms (categories, brands, colours, sizes).
 *
 * These live outside `actions.ts` deliberately: a `"use server"` module may only
 * export async functions, so exporting a schema constant from there is a build
 * error.
 *
 * Every rule mirrors a constraint in migration 001 — anything that passes here
 * will not be rejected by Postgres for shape reasons. Uniqueness is the
 * exception: only the database can decide that, so it comes back as a 23505 and
 * is translated in `actions.ts`.
 */

/** `id` is absent when creating and present when editing. */
const rowId = z.number().int().positive().nullable()

const isActive = z.boolean()

const name = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(80, "Keep the name under 80 characters.")

export const categorySchema = z.object({
  id: rowId,
  name,
  // NULL means top level. A category may not be its own parent; that check
  // needs the id, so it lives in the refine below.
  parentId: z.number().int().positive().nullable(),
  isActive,
})
  .refine((v) => v.id === null || v.parentId !== v.id, {
    message: "A category cannot be its own parent.",
    path: ["parentId"],
  })

export const brandSchema = z.object({
  id: rowId,
  name,
  isActive,
})

export const colourSchema = z.object({
  id: rowId,
  name,
  // `colours.hex_code` is nullable TEXT. The swatch just renders grey without
  // one, so an empty field is valid rather than an error.
  hexCode: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, e.g. #E53935.")
    .nullable(),
  isActive,
})

export const sizeSchema = z.object({
  id: rowId,
  sizeType: z.enum(SIZE_TYPES),
  label: z
    .string()
    .trim()
    .min(1, "Label is required.")
    .max(40, "Keep the label under 40 characters."),
  // Drives display order in the variant matrix, so it must sort numerically.
  sortOrder: z
    .number()
    .int("Sort order must be a whole number.")
    .min(0, "Sort order cannot be negative.")
    .max(9999, "Sort order is too large."),
  isActive,
})

export type CategoryInput = z.infer<typeof categorySchema>
export type BrandInput = z.infer<typeof brandSchema>
export type ColourInput = z.infer<typeof colourSchema>
export type SizeInput = z.infer<typeof sizeSchema>
