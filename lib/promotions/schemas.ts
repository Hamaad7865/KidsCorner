import { z } from "zod"

/**
 * Validation for the promotions actions. Separate from `actions.ts` because a
 * `"use server"` module may only export async functions.
 *
 * The never-loss rule (promo ≥ cost) and the must-be-a-reduction rule live in
 * the `apply_promotion` RPC, the single authority — both need the variant's cost
 * and current price, which the database has and a form does not. These schemas
 * only check the shape.
 */

/** NUMERIC(10,2) tops out at 99,999,999.99 — same ceiling as a variant price. */
const money = z
  .number()
  .min(0, "Price cannot be negative.")
  .max(99_999_999.99, "That price is too large for the database column.")

export const applyPromotionSchema = z.object({
  variantId: z.number().int().positive(),
  promoPrice: money.refine((v) => v > 0, "Enter a promotion price."),
  note: z.string().trim().max(200, "Keep the note under 200 characters.").nullable(),
})

export const liftPromotionSchema = z.object({
  promotionId: z.number().int().positive(),
})

/**
 * Reducing a running promotion. Same shape rules as applying one; the
 * must-be-lower-than-the-promo-price rule needs the live promotion row, so it
 * lives in the `reduce_promotion` RPC, not here.
 */
export const reducePromotionSchema = z.object({
  variantId: z.number().int().positive(),
  newPrice: money.refine((v) => v > 0, "Enter a promotion price."),
  note: z.string().trim().max(200, "Keep the note under 200 characters.").nullable(),
})

export const slowMoverDaysSchema = z.object({
  // A day count, generous at the top so a shop can set a season if it wants.
  days: z
    .number({ error: "Enter a number of days." })
    .int("Use a whole number of days.")
    .min(1, "It must be at least one day.")
    .max(3650, "Keep it under ten years."),
})
