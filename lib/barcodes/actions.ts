"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { isValidEan13, prefixProblem } from "@/lib/barcodes/ean13"
import { MAX_COPIES_PER_VARIANT } from "@/lib/barcodes/labels"
import { allocateBarcodes, getBarcodeSettings } from "@/lib/barcodes/settings"
import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { stockForVariantsAtLocation } from "@/lib/stock/queries"
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

  // These came from `.is("barcode", null)`, so each is a blank — guarded as such.
  const result = await issueBarcodes(
    supabase,
    targets.map((id) => ({ id, currentBarcode: null })),
  )
  if ("error" in result) return fail(result.error)
  const { written, problems } = result

  revalidatePath("/products")
  if (productId !== null) revalidatePath(`/products/${productId}`)
  revalidatePath("/print-labels")
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

/**
 * Reserve and write a barcode to each of these variants.
 *
 * The one place a code actually lands on a variant, shared by the product-page
 * dialog and the label picker so there is a single writer for a UNIQUE column
 * where a double-write re-issues a number already on a printed sticker. Each row
 * is filled under `.is("barcode", null)` so a concurrent write wins rather than
 * being clobbered, and a spent-but-failed serial is skipped — gaps are harmless,
 * duplicates are not.
 */
type BarcodeTarget = { id: number; currentBarcode: string | null }

async function issueBarcodes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  targets: BarcodeTarget[],
): Promise<{ written: number; problems: string[] } | { error: string }> {
  const settings = await getBarcodeSettings(supabase)

  // `auto` is forced on: that flag only governs whether a blank is filled
  // automatically at creation, and an explicit press must work even with it off.
  const { codes, error: allocError } = await allocateBarcodes(
    supabase,
    targets.length,
    { ...settings, auto: true },
  )
  if (allocError) return { error: allocError }
  if (codes.length !== targets.length) {
    return { error: "Could not reserve enough barcode numbers. Try again." }
  }

  let written = 0
  const problems: string[] = []

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]
    // The guard matches what the target was when we read it: a blank stays
    // guarded on null so a concurrent write wins, and an invalid code is only
    // overwritten while it is still that exact invalid value. Either way a valid
    // barcode already on a printed label can never be clobbered from here.
    const update = supabase
      .from("product_variants")
      .update({ barcode: codes[i] })
      .eq("id", target.id)
    const guarded =
      target.currentBarcode === null
        ? update.is("barcode", null)
        : update.eq("barcode", target.currentBarcode)

    const { data, error } = await guarded.select("id")

    if (error) {
      problems.push(error.code === "23505" ? "a code was already taken" : error.message)
      continue
    }
    if (data.length > 0) written += 1
  }

  return { written, problems }
}

/**
 * Fill in barcodes for every variant of one product that still lacks one.
 *
 * Called straight from the label picker so a product with no codes can be made
 * printable without a detour to its edit screen. The blanks are re-read here
 * rather than trusted from the caller: the picker's list can be stale, and
 * issuing a code over one already printed would orphan a sticker.
 */
export async function generateBarcodesForProduct(
  productId: number,
): Promise<{ ok: boolean; message: string }> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return { ok: false, message: "Your session has expired." }
  }
  if (!canManageCatalog(profile.role)) {
    return { ok: false, message: "Only an owner or manager can issue barcodes." }
  }
  if (!Number.isInteger(productId) || productId <= 0) {
    return { ok: false, message: "Unknown product." }
  }

  const supabase = await createClient()
  const { data: variants, error } = await supabase
    .from("product_variants")
    .select("id, barcode")
    .eq("product_id", productId)

  if (error) return { ok: false, message: error.message }

  // A missing code, or one that fails its check digit — both need a fresh code.
  // The invalid ones carry their current value so the write only overwrites that
  // exact bad code, never a valid one issued in the meantime.
  const targets = (variants ?? [])
    .filter((row) => row.barcode === null || !isValidEan13(row.barcode))
    .map((row) => ({ id: row.id, currentBarcode: row.barcode }))
  if (targets.length === 0) {
    return { ok: false, message: "Every variant already has a valid barcode." }
  }

  const result = await issueBarcodes(supabase, targets)
  if ("error" in result) return { ok: false, message: result.error }

  revalidatePath("/print-labels")
  revalidatePath("/products")
  revalidatePath(`/products/${productId}`)
  revalidatePath("/settings")

  const { written, problems } = result
  if (written === 0) {
    return {
      ok: false,
      message: problems[0] ? `No barcodes issued — ${problems[0]}.` : "No barcodes issued.",
    }
  }

  const issued = `${written} barcode${written === 1 ? "" : "s"} issued`
  return {
    ok: true,
    message: problems.length > 0 ? `${issued}, ${problems.length} failed.` : `${issued}.`,
  }
}

/**
 * Build the roll-label URL that prints every barcoded variant of the selected
 * products at its stock count for one location.
 *
 * The counts are read here, server-side, not trusted from the browser: the
 * table shows a number but a print run must reflect the ledger, and a tampered
 * count could otherwise spool the roll. Returns null with a reason when there is
 * nothing to print, so the picker can say why rather than open a blank sheet.
 */
export async function batchLabelHref(
  productIds: number[],
  locationId: number,
): Promise<{ href: string | null; message?: string }> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return { href: null, message: "Your session has expired." }
  }
  if (!canManageCatalog(profile.role)) {
    return { href: null, message: "Only an owner or manager can print labels." }
  }

  const ids = productIds.filter((id) => Number.isInteger(id) && id > 0)
  if (ids.length === 0) return { href: null, message: "Pick at least one product." }
  if (!Number.isInteger(locationId) || locationId <= 0) {
    return { href: null, message: "Pick a location first." }
  }

  const supabase = await createClient()
  const { data: variants, error } = await supabase
    .from("product_variants")
    .select("id, barcode")
    .in("product_id", ids)
    .not("barcode", "is", null)

  if (error) return { href: null, message: error.message }

  // Valid codes only: an invalid barcode would print as "Invalid barcode" on a
  // sticker, so it is excluded here exactly as the picker excludes it from the
  // printable count.
  const variantIds = (variants ?? [])
    .filter((row) => row.barcode !== null && isValidEan13(row.barcode))
    .map((row) => row.id)
  if (variantIds.length === 0) {
    return {
      href: null,
      message: "None of the selected products has a valid barcode yet. Generate them first.",
    }
  }

  const stock = await stockForVariantsAtLocation(variantIds, locationId)
  const pairs = variantIds
    .map((id) => [id, Math.min(stock.get(id) ?? 0, MAX_COPIES_PER_VARIANT)] as const)
    .filter(([, count]) => count > 0)

  if (pairs.length === 0) {
    return {
      href: null,
      message: "Nothing in stock at this location for the selected products.",
    }
  }

  // The anchor product only names the route; the copies carry variants across
  // all the selected products, which the sheet prints as given.
  const copies = pairs.map(([id, count]) => `${id}:${count}`).join(",")
  return { href: `/products/${ids[0]}/labels?label=40x30&copies=${copies}` }
}
