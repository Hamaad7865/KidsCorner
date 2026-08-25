"use server"

import { revalidatePath } from "next/cache"

import { logAudits } from "@/lib/activity/audit"
import { canManageCatalog, canManageSettings } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import {
  fieldErrorsOf,
  formFail as fail,
  formOk,
  idOf,
  intOf,
  nullableTextOf,
  numberOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

import { loadProductForPromo, type PromoVariant } from "./queries"
import {
  applyPromotionSchema,
  liftPromotionSchema,
  reducePromotionSchema,
  slowMoverDaysSchema,
} from "./schemas"

/**
 * Putting a product on promotion, and taking it back off.
 *
 * As with every other money rule, the guard that a promotion never goes below
 * cost lives in the database (`apply_promotion`), not here. These actions check
 * the caller's role — turning a silent RLS refusal into a sentence — and pass
 * the friendly error the RPC raises straight through.
 */

async function requireManager(): Promise<FormState | null> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can manage promotions.")
  }
  return null
}

function revalidatePromos() {
  revalidatePath("/promotions")
  revalidatePath("/products")
}

export async function applyPromotion(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireManager()
  if (denied) return denied

  const parsed = applyPromotionSchema.safeParse({
    variantId: idOf(formData, "variantId"),
    promoPrice: numberOf(formData, "promoPrice", 0),
    note: nullableTextOf(formData, "note"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { variantId, promoPrice, note } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.rpc("apply_promotion" as never, {
    p_variant_id: variantId,
    p_promo_price: promoPrice,
    p_note: note,
  } as never)

  // The RPC raises in the shop's own words — "cannot go below cost", "already
  // on promotion" — so its message is what the till or the owner should read.
  if (error) return fail(error.message)

  revalidatePromos()
  return formOk("Promotion applied.")
}

/**
 * The active, in-stock variants of a product, for the Apply-promotion dialog.
 * Lazy-loaded when the dialog opens rather than shipped with every slow-mover
 * row, so a long list stays one query.
 */
export async function fetchPromoVariants(
  productId: number,
): Promise<
  | { ok: true; productName: string; variants: PromoVariant[] }
  | { ok: false; error: string }
> {
  const denied = await requireManager()
  if (denied) return { ok: false, error: denied.error ?? "Not allowed." }

  const loaded = await loadProductForPromo(productId)
  if (!loaded) return { ok: false, error: "That product no longer exists." }
  return { ok: true, productName: loaded.productName, variants: loaded.variants }
}

/**
 * Apply a promotion price to one or more of a product's variants in a single
 * submit — parallel `variantId` / `promoPrice` fields. Each variant is settled
 * independently by the RPC (its own cost floor), so a bad one is reported
 * without holding back the good ones.
 */
export async function applyPromotionBatch(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireManager()
  if (denied) return denied

  const ids = formData.getAll("variantId").map((v) => Number(v))
  const prices = formData.getAll("promoPrice").map((v) => Number(v))
  const supabase = await createClient()

  let applied = 0
  const problems: string[] = []

  for (let i = 0; i < ids.length; i++) {
    const variantId = ids[i]
    const promoPrice = prices[i]
    // A blank or unchanged input just means "leave this variant alone".
    if (!Number.isFinite(promoPrice) || promoPrice <= 0) continue
    const parsed = applyPromotionSchema.safeParse({ variantId, promoPrice, note: null })
    if (!parsed.success) {
      problems.push(`One variant's price was invalid.`)
      continue
    }

    const { error } = await supabase.rpc("apply_promotion" as never, {
      p_variant_id: variantId,
      p_promo_price: promoPrice,
      p_note: null,
    } as never)
    if (error) problems.push(error.message)
    else applied += 1
  }

  if (applied === 0) {
    return fail(problems[0] ?? "Enter a promotion price for at least one item.")
  }

  revalidatePromos()
  const noun = applied === 1 ? "item" : "items"
  return formOk(
    problems.length > 0
      ? `${applied} ${noun} put on promotion. ${problems.length} could not be: ${problems[0]}`
      : `${applied} ${noun} put on promotion.`,
  )
}

export async function liftPromotion(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireManager()
  if (denied) return denied

  const parsed = liftPromotionSchema.safeParse({
    promotionId: idOf(formData, "promotionId"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("lift_promotion" as never, {
    p_promotion_id: parsed.data.promotionId,
  } as never)

  if (error) return fail(error.message)

  revalidatePromos()
  // The RPC returns whether it actually put the price back, or left a figure
  // someone had changed by hand during the promotion.
  return formOk(
    data === false
      ? "Promotion ended. The price was left as it was changed during the promotion."
      : "Promotion lifted and the price restored.",
  )
}

/**
 * Marking a running promotion down AGAIN — the second threshold's action.
 *
 * Deliberately not lift-then-reapply: that would end the promotion's history
 * and forget the true original price. `reduce_promotion` edits the SAME
 * promotion row, so `original_price` — what lifting restores and what the
 * till strikes through — survives any number of reductions.
 */
export async function reducePromotion(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await requireManager()
  if (denied) return denied

  const parsed = reducePromotionSchema.safeParse({
    variantId: idOf(formData, "variantId"),
    newPrice: numberOf(formData, "newPrice", 0),
    note: nullableTextOf(formData, "note"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { variantId, newPrice, note } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.rpc("reduce_promotion" as never, {
    p_variant_id: variantId,
    p_new_price: newPrice,
    p_note: note,
  } as never)

  // The RPC's own words — "cannot go below cost", "must be lower than the
  // current promotion price" — are what the manager should read.
  if (error) return fail(error.message)

  revalidatePromos()
  return formOk("Promotion reduced.")
}

/**
 * One shop setting that counts days, saved owner-only and audited. Both
 * thresholds — the slow-mover flag and the still-not-selling-on-promotion
 * flag — are the same shape: a number in `settings`, a change worth a trail,
 * a list behind it that re-runs the moment it is saved.
 */
async function saveDaysSetting(
  key: string,
  days: number,
  summaryNoun: string,
): Promise<FormState> {
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle()
  const before = existing?.value ?? null

  const { data, error } = await supabase
    .from("settings")
    .update({ value: days })
    .eq("key", key)
    .select("key")

  if (error) return fail(error.message)
  if (data.length === 0) {
    const { error: insertError } = await supabase
      .from("settings")
      .insert({ key, value: days })
    if (insertError) return fail("Could not save the threshold. Sign in as the owner.")
  }

  if (Number(before) !== days) {
    await logAudits(supabase, [
      {
        type: "setting.changed",
        refType: "setting",
        refId: key,
        summary: `${summaryNoun}: ${before ?? "—"} → ${days} days`,
        detail: { key, before, after: days },
      },
    ])
  }

  revalidatePath("/promotions")
  return formOk("Threshold saved.")
}

/**
 * The slow-mover threshold. Owner-only, like every other shop setting, and
 * recorded on the audit trail the same way — it changes which products the shop
 * is told to act on, and leaves no other trace.
 */
export async function setSlowMoverDays(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (!canManageSettings(profile.role)) {
    return fail("Only the owner can change the slow-mover threshold.")
  }

  const parsed = slowMoverDaysSchema.safeParse({
    days: intOf(formData, "days", 0),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  return saveDaysSetting("slow_mover_days", parsed.data.days, "Slow-mover threshold")
}

/**
 * The second threshold: how long a variant may sit ON PROMOTION without a
 * sale before it is flagged to be reduced again. Owner-only for the same
 * reason the first one is.
 */
export async function setPromoStillDays(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (!canManageSettings(profile.role)) {
    return fail("Only the owner can change the promotion threshold.")
  }

  const parsed = slowMoverDaysSchema.safeParse({
    days: intOf(formData, "days", 0),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  return saveDaysSetting("promo_still_days", parsed.data.days, "Promotion still-idle threshold")
}
