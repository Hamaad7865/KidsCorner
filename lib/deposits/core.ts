import { z } from "zod"

/**
 * Shared shape of a deposit's money, with no transport attached.
 *
 * The Android till is the only writer of deposit orders, but it is not
 * trusted to decide any of the arithmetic — every figure here is re-derived
 * by `create_deposit_order`, `add_deposit_payment`, `collect_deposit_order`
 * and `cancel_deposit_order` from the database. What this module owns is the
 * vocabulary both the route handlers and their zod schemas agree on, so a
 * client that skips the till app cannot talk a route into a shape the RPCs
 * were never meant to receive.
 */

/** Real tenders only. 'credit' bills an account; 'deposit' exists only as a
 * SALE tender written by collect_deposit_order and is never accepted here. */
export const DEPOSIT_TENDERS = ["cash", "card", "juice", "myt_money", "bank"] as const

export type DepositTender = (typeof DEPOSIT_TENDERS)[number]

const tenderSchema = z.enum(DEPOSIT_TENDERS)

/** Names one attempt so a retried request replays rather than charges again. */
export const idempotencyKeySchema = z.string().trim().min(8).max(64)

export const depositPaymentInputSchema = z.object({
  method: tenderSchema,
  amount: z.number().positive(),
  /** Cash handed over beyond the price; the change comes back out of it. */
  tendered: z.number().min(0).nullish(),
})

export const createDepositSchema = z.object({
  customerId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        variantId: z.number().int().positive(),
        qty: z.number().int().min(1),
        /** Read but not trusted: clamped to the line by the RPC. */
        discount: z.number().min(0).default(0),
      }),
    )
    .min(1, "A deposit needs at least one item.")
    .max(50),
  /** Null for a pure reservation — goods held, nothing taken yet. */
  payment: depositPaymentInputSchema.nullish(),
  collectBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
    .nullish(),
  note: z.string().trim().max(200).nullish(),
  /** Required whenever the first payment is cash: notes go into a drawer. */
  shiftId: z.number().int().positive().nullish(),
  deviceId: z.number().int().positive().nullish(),
  /** A manager's PIN, required by the route when any line carries money off. */
  approval: z.object({ managerId: z.uuid(), pin: z.string() }).nullish(),
  idempotencyKey: idempotencyKeySchema,
})

export type CreateDepositInput = z.infer<typeof createDepositSchema>

export const depositTopUpSchema = z.object({
  method: tenderSchema,
  amount: z.number().positive(),
  tendered: z.number().min(0).nullish(),
  shiftId: z.number().int().positive().nullish(),
  deviceId: z.number().int().positive().nullish(),
  idempotencyKey: idempotencyKeySchema,
})

export const depositCollectSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        qty: z.number().int().min(1),
      }),
    )
    .min(1, "Choose what the customer is taking today.")
    .max(50),
  newPayments: z.array(depositPaymentInputSchema).max(10).default([]),
  shiftId: z.number().int().positive(),
  deviceId: z.number().int().positive().nullish(),
  /**
   * The immutable VAT policy cached when this attempt was frozen, mirroring
   * the checkout freeze a normal sale sends. Null maps to the legacy policy.
   */
  vatPolicyId: z.number().int().positive().nullable().optional(),
  checkedOutAt: z.string().datetime().nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
})

export const depositCancelSchema = z.object({
  reason: z.string().trim().min(3).max(200),
  /** Where refund cash leaves from; required before the RPC will pay cash. */
  shiftId: z.number().int().positive().nullish(),
  deviceId: z.number().int().positive().nullish(),
  idempotencyKey: idempotencyKeySchema,
})
