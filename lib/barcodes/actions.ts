"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { prefixProblem } from "@/lib/barcodes/ean13"
import { allocateBarcodes, getBarcodeSettings } from "@/lib/barcodes/settings"
import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import {
  boolOf,
  fieldErrorsOf,
  formFail as fail,
  formOk,
  idListOf,
  idOf,
  intOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

/** Barcode scheme settings, and filling in the blanks on existing variants. */

const schemeSchema = z.object({
  auto: z.boolean(),
  prefix: z
    .string()
    .trim()
    .refine((value) => prefixProblem(value) === null, {
      // The message the shopkeeper reads comes straight from the same helper
      // that the live preview uses, so the two can never disagree.
      error: (issue) => prefixProblem(String(issue.input)) ?? "Invalid prefix.",
    }),
  next: z
    // NaN reaches here from an empty box as well as from a malformed one, so
    // the message has to read correctly for both.
    .number()
    .int("Enter the next number to use.")
    .min(0, "The next number cannot be negative."),
})

export async function saveBarcodeSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  // Matches the RLS on `settings`, which is owner-only.
  if (profile.role !== "owner") {
    return fail("Only the owner can change the barcode scheme.")
  }

  const parsed = schemeSchema.safeParse({
    auto: boolOf(formData, "auto"),
    prefix: textOf(formData, "prefix"),
    next: intOf(formData, "next", NaN),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { auto, prefix, next } = parsed.data
  const supabase = await createClient()

  // All three keys are written by one RPC, under a lock on the counter row.
  // Doing the read-check-write here instead would let an allocation land in the
  // gap and be silently rolled back, re-issuing serials already printed on
  // labels — and `barcode` is UNIQUE, so that surfaces much later as a failed
  // insert on an unrelated variant.
  const { data, error } = await supabase.rpc("set_barcode_scheme", {
    p_auto: auto,
    p_prefix: prefix,
    p_next: next,
  })

  if (error) {
    const missing = error.message.includes("set_barcode_scheme")
    return fail(
      missing
        ? "Barcode numbering is not set up yet. Run migration 008."
        : error.message,
    )
  }

  // The RPC returns the counter in force afterwards. Anything above what we
  // asked for means it refused a rewind and wrote nothing.
  if (typeof data === "number" && data > next) {
    return fail(null, {
      next: `Already issued up to ${data - 1}. Going back would print a code twice.`,
    })
  }

  revalidatePath("/settings")
  revalidatePath("/products")
  return formOk("Barcode scheme saved.")
}

/**
 * Issues a barcode to each named variant that has none.
 *
 * Codes are assigned one row at a time rather than in a single bulk update:
 * each variant needs its own code, and a failure part-way must leave the ones
 * already written in place. A serial spent on a row that then fails is simply
 * skipped — gaps in the sequence are harmless, duplicates are not.
 */
export async function generateBarcodes(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can issue barcodes.")
  }

  const productId = idOf(formData, "productId")
  const variantIds = idListOf(formData, "variantIds")
  if (variantIds.length === 0) return fail("Pick at least one variant.")

  const supabase = await createClient()

  // Re-read which of them are actually blank. The dialog's list can be stale if
  // somebody else generated codes in the meantime, and overwriting a barcode
  // that is already on a printed label would orphan every sticker.
  const { data: blanks, error: blanksError } = await supabase
    .from("product_variants")
    .select("id")
    .in("id", variantIds)
    .is("barcode", null)

  if (blanksError) return fail(blanksError.message)

  const targets = (blanks ?? []).map((row) => row.id)
  if (targets.length === 0) {
    return fail("Those variants already have barcodes. Refresh to see them.")
  }

  const settings = await getBarcodeSettings(supabase)

  // `auto` is forced on for this call. That flag governs whether a blank is
  // filled in *automatically* when a variant is created; pressing this button
  // is an explicit request, and refusing it because the automatic path is off
  // would leave no way to issue a code by hand at all.
  const { codes, error: allocError } = await allocateBarcodes(
    supabase,
    targets.length,
    { ...settings, auto: true },
  )
  if (allocError) return fail(allocError)
  if (codes.length !== targets.length) {
    return fail("Could not reserve enough barcode numbers. Try again.")
  }

  let written = 0
  const problems: string[] = []

  for (let i = 0; i < targets.length; i += 1) {
    const { data, error } = await supabase
      .from("product_variants")
      .update({ barcode: codes[i] })
      // `.is("barcode", null)` again so a concurrent write wins rather than
      // being silently clobbered by this one.
      .eq("id", targets[i])
      .is("barcode", null)
      .select("id")

    if (error) {
      problems.push(error.code === "23505" ? "a code was already taken" : error.message)
      continue
    }
    if (data.length > 0) written += 1
  }

  revalidatePath("/products")
  if (productId !== null) revalidatePath(`/products/${productId}`)
  revalidatePath("/settings")

  if (written === 0) {
    return fail(
      problems[0] ? `No barcodes issued — ${problems[0]}.` : "No barcodes issued.",
    )
  }

  const issued = `${written} barcode${written === 1 ? "" : "s"} issued`
  return formOk(
    problems.length > 0 ? `${issued}, ${problems.length} failed.` : `${issued}.`,
  )
}
