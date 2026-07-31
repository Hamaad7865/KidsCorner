"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import {
  fieldErrorsOf,
  formFail as fail,
  formOk,
  idOf,
  intOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

/**
 * Stock mutations.
 *
 * Everything here goes through the `record_stock_movement` RPC. Nothing writes
 * `qty_on_hand` directly — the spec makes it a cache the RPC alone maintains,
 * and a direct UPDATE would leave the ledger disagreeing with the count.
 */

const adjustmentSchema = z.object({
  variantId: z.number().int().positive("Pick a variant to adjust."),
  countedQty: z
    .number()
    .int("Counted quantity must be a whole number.")
    .min(0, "Counted quantity cannot be negative.")
    .max(1_000_000, "That quantity is unrealistically large."),
  // Required by the spec: an adjustment without a reason is untraceable.
  reason: z
    .string()
    .trim()
    .min(3, "Give a reason — this is the only record of why the count changed.")
    .max(200, "Keep the reason under 200 characters."),
})

async function requireStockManager(): Promise<FormState | null> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can adjust stock.")
  }
  return null
}

const transferSchema = z.object({
  variantId: z.number().int().positive("Pick a variant to move."),
  qty: z
    .number()
    .int("Move a whole number of units.")
    .min(1, "Move at least one unit.")
    .max(1_000_000, "That quantity is unrealistically large."),
  fromLocation: z.number().int().positive("Pick where it is moving from."),
  toLocation: z.number().int().positive("Pick where it is moving to."),
  notes: z.string().trim().max(200, "Keep the note under 200 characters.").nullable(),
})

/**
 * Moves stock between locations.
 *
 * Forwarded to the `transfer_stock` RPC, which writes a matched out/in pair in
 * one statement. That matters: two separate movements could half-fail and leave
 * units that exist in neither place. The shop-wide `qty_on_hand` is deliberately
 * unchanged — the goods have not left the shop, only the shelf.
 */
export async function transferStock(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireStockManager()
  if (denied) return denied

  const parsed = transferSchema.safeParse({
    variantId: idOf(formData, "variantId") ?? 0,
    qty: intOf(formData, "qty", NaN),
    fromLocation: idOf(formData, "fromLocation") ?? 0,
    toLocation: idOf(formData, "toLocation") ?? 0,
    notes: textOf(formData, "notes").trim() || null,
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { variantId, qty, fromLocation, toLocation, notes } = parsed.data
  if (fromLocation === toLocation) {
    // The RPC raises on this too; catching it here gives a field error rather
    // than a database exception.
    return fail(null, { toLocation: "Pick a different destination." })
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("transfer_stock", {
    p_variant_id: variantId,
    p_qty: qty,
    p_from_location: fromLocation,
    p_to_location: toLocation,
    p_notes: notes ?? undefined,
  })

  if (error) return fail(error.message)

  revalidatePath("/stock")
  return formOk(`${qty} unit${qty === 1 ? "" : "s"} moved.`)
}

export type VariantSearchResult = {
  id: number
  sku: string
  barcode: string | null
  productName: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  qtyOnHand: number
}

/** Type-ahead for the adjustment dialog: matches product name, SKU or barcode. */
export async function searchVariants(query: string): Promise<VariantSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const denied = await requireStockManager()
  if (denied) return []

  const supabase = await createClient()
  // Escaped so a literal % or _ in a product name matches itself. Double quotes
  // are stripped because the pattern gets embedded in a quoted `or()` value
  // below and an inner quote would terminate it early.
  const pattern = `%${trimmed.replace(/["]/g, "").replace(/[%_]/g, (c) => `\\${c}`)}%`

  const { data, error } = await supabase
    .from("product_variants")
    .select(
      `id, sku, barcode, qty_on_hand,
       products!inner ( name ),
       sizes ( label ),
       colours ( name, hex_code )`,
    )
    // Values MUST be double-quoted: `or()` splits on commas and periods, so a
    // search like "shirt, blue" would otherwise be parsed as extra conditions
    // and the whole filter would fail or match the wrong thing.
    .or(`sku.ilike."${pattern}",barcode.ilike."${pattern}"`)
    .eq("is_active", true)
    .limit(20)

  // A product-name match needs a filter on the embedded table, which cannot be
  // combined with the `or` above in one request — so it is a second query and
  // the two result sets are merged.
  const { data: byName } = await supabase
    .from("product_variants")
    .select(
      `id, sku, barcode, qty_on_hand,
       products!inner ( name ),
       sizes ( label ),
       colours ( name, hex_code )`,
    )
    .ilike("products.name", pattern)
    .eq("is_active", true)
    .limit(20)

  if (error && !byName) return []

  const merged = new Map<number, VariantSearchResult>()
  for (const row of [...(data ?? []), ...(byName ?? [])]) {
    if (merged.has(row.id)) continue
    merged.set(row.id, {
      id: row.id,
      sku: row.sku,
      barcode: row.barcode,
      productName: row.products?.name ?? "",
      sizeLabel: row.sizes?.label ?? "",
      colourName: row.colours?.name ?? "",
      colourHex: row.colours?.hex_code ?? null,
      qtyOnHand: row.qty_on_hand,
    })
  }

  return [...merged.values()].slice(0, 20)
}

/**
 * Records a stock-take correction.
 *
 * The user enters what they *counted*; the delta is derived server-side and
 * applied through the RPC, which increments atomically. That is deliberately
 * safer than writing an absolute figure — a concurrent sale between the read
 * and the write is preserved rather than overwritten.
 *
 * It is not fully serialisable, though: the read of `qty_on_hand` and the RPC
 * call are two statements, so two people stock-taking the *same* variant within
 * the same instant could each compute a delta from the same starting number.
 * Closing that needs a single RPC that reads and writes under a row lock. For a
 * one-shop back office the window is not worth another migration, but the
 * limitation is real rather than absent.
 */
export async function recordAdjustment(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireStockManager()
  if (denied) return denied

  const variantId = idOf(formData, "variantId")
  if (variantId === null) return fail("Pick a variant to adjust.")

  const parsed = adjustmentSchema.safeParse({
    variantId,
    countedQty: intOf(formData, "countedQty", NaN),
    reason: textOf(formData, "reason"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { countedQty, reason } = parsed.data
  const supabase = await createClient()

  const { data: variant, error: readError } = await supabase
    .from("product_variants")
    .select("qty_on_hand")
    .eq("id", variantId)
    .maybeSingle()

  if (readError) return fail(readError.message)
  if (!variant) return fail("That variant no longer exists.")

  const delta = countedQty - variant.qty_on_hand
  if (delta === 0) {
    return fail(`The counted quantity already matches the system (${countedQty}).`)
  }

  const { error } = await supabase.rpc("record_stock_movement", {
    p_variant_id: variantId,
    p_type: "adjustment",
    p_qty: delta,
    p_reference_type: "manual_adjustment",
    p_notes: reason,
  })

  if (error) {
    // The stock floor from migration 009. Reachable if the count is taken
    // against a variant that sells down before the adjustment is saved.
    if (error.code === "23514" && /qty_on_hand_non_negative/.test(error.message)) {
      return fail(
        "That count would put the variant below zero — it has sold since you started. Recount and try again.",
      )
    }
    return fail(error.message)
  }

  revalidatePath("/stock")
  revalidatePath("/products")

  const direction = delta > 0 ? "added" : "removed"
  return formOk(
    `Counted ${countedQty}; ${Math.abs(delta)} ${direction}. Recorded as an adjustment.`,
  )
}
