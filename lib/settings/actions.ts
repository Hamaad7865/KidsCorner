"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { logAudits } from "@/lib/activity/audit"
import { getSessionProfile } from "@/lib/auth/session"
import { PAYMENT_METHODS } from "@/lib/db-enums"
import {
  boolOf,
  fieldErrorsOf,
  formFail as fail,
  formOk,
  numberOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

/**
 * Shop-level settings.
 *
 * Owner-only, matching the RLS on `settings`
 * (`current_role_of_user() = 'owner'`). A manager's UPDATE would match zero
 * rows rather than error, so the result is checked rather than assumed.
 *
 * `settings.value` is JSONB, so each value is stored in its natural JSON shape:
 * a string for the name, a number for the rate, an array for the methods.
 */

const shopSettingsSchema = z.object({
  shopName: z
    .string()
    .trim()
    .min(1, "The shop needs a name — it appears on every receipt.")
    .max(60, "Keep the name under 60 characters."),
  // Stored as a fraction (0.15), entered as a percentage (15).
  vatPercent: z
    .number()
    .min(0, "VAT cannot be negative.")
    .max(100, "VAT cannot exceed 100%."),
  paymentMethods: z
    .array(z.enum(PAYMENT_METHODS))
    .min(1, "The till needs at least one payment method."),
  refundRequiresManager: z.boolean(),

  // All three optional. A shop below the registration threshold has no VAT
  // number, and forcing one would put an invented figure on every receipt.
  shopAddress: z.string().trim().max(200, "Keep the address under 200 characters."),
  shopPhone: z.string().trim().max(40, "That phone number is too long."),
  vatNumber: z.string().trim().max(30, "That VAT number is too long."),
})

const SETTING_LABELS: Record<string, string> = {
  shop_name: "Shop name",
  shop_address: "Shop address",
  shop_phone: "Shop phone",
  vat_number: "VAT number",
  vat_rate: "VAT rate",
  payment_methods: "Payment methods",
  refund_requires_manager: "Manager approval for returns",
}

/**
 * A settings value as a person would say it.
 *
 * The VAT rate is stored as 0.15 and read as 15%; the payment methods are a
 * JSON array and read as a list. Without this the trail would say
 * `vat_rate: 0.15 → 0.2`, which is the database's phrasing, not the shop's.
 */
function describe(key: string, value: unknown): string {
  if (key === "vat_rate") {
    const rate = Number(value)
    return Number.isFinite(rate) ? `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%` : "—"
  }
  if (typeof value === "boolean") return value ? "required" : "not required"
  if (Array.isArray(value)) return value.join(", ") || "none"
  return value === null || value === undefined || value === "" ? "—" : String(value)
}

export async function saveShopSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (profile.role !== "owner") {
    return fail("Only the owner can change shop settings.")
  }

  const parsed = shopSettingsSchema.safeParse({
    shopName: textOf(formData, "shopName"),
    vatPercent: numberOf(formData, "vatPercent", NaN),
    paymentMethods: formData.getAll("paymentMethods").filter(
      (v): v is string => typeof v === "string",
    ),
    refundRequiresManager: boolOf(formData, "refundRequiresManager"),
    shopAddress: textOf(formData, "shopAddress"),
    shopPhone: textOf(formData, "shopPhone"),
    vatNumber: textOf(formData, "vatNumber"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const {
    shopName,
    vatPercent,
    paymentMethods,
    refundRequiresManager,
    shopAddress,
    shopPhone,
    vatNumber,
  } = parsed.data
  const supabase = await createClient()

  // Upserted one key at a time: `settings` is a key/value table, and doing them
  // together would need a single statement anyway. Any failure stops the rest,
  // so a partial change is reported rather than silently half-applied.
  const rows = [
    { key: "shop_name", value: shopName },
    // Rounded to 4dp: a rate typed as 15 becomes 0.15 exactly, and complete_sale
    // divides by (1 + rate), so float noise here would drift every VAT figure.
    { key: "vat_rate", value: Math.round((vatPercent / 100) * 10_000) / 10_000 },
    { key: "payment_methods", value: paymentMethods },
    { key: "refund_requires_manager", value: refundRequiresManager },
    // These three are what getShopIdentity has always read and nothing has
    // ever written: the receipt printed with no address, no phone and no VAT
    // number, and the dashboard's subtitle had no shop to name. They are not
    // seeded by any migration, so the insert branch below is the path that
    // creates them the first time an owner saves.
    { key: "shop_address", value: shopAddress },
    { key: "shop_phone", value: shopPhone },
    { key: "vat_number", value: vatNumber },
  ]

  // Read the current values first, so the trail can name what moved. Changing
  // the VAT rate silently re-prices every future sale and leaves no other
  // record anywhere — the settings row is simply different afterwards.
  const { data: existing } = await supabase.from("settings").select("key, value")
  const previous = new Map(
    (existing ?? []).map((row) => [row.key, JSON.stringify(row.value)]),
  )
  const changed: { key: string; before: unknown; after: unknown }[] = []

  for (const row of rows) {
    if (previous.get(row.key) !== JSON.stringify(row.value)) {
      const raw = (existing ?? []).find((r) => r.key === row.key)?.value
      changed.push({ key: row.key, before: raw ?? null, after: row.value })
    }

    const { data, error } = await supabase
      .from("settings")
      .update({ value: row.value })
      .eq("key", row.key)
      .select("key")

    if (error) return fail(error.message)
    if (data.length === 0) {
      // The key is missing rather than the permission being wrong. For the
      // four migration 001 seeds that means the row was deleted; for the
      // address, phone and VAT number it is simply the first save.
      const { error: insertError } = await supabase
        .from("settings")
        .insert({ key: row.key, value: row.value })
      if (insertError) {
        return fail(
          `Could not save ${row.key}. Check you are signed in as the owner.`,
        )
      }
    }
  }

  await logAudits(
    supabase,
    changed.map((c) => ({
      type: "setting.changed",
      refType: "setting",
      refId: c.key,
      summary: `${SETTING_LABELS[c.key] ?? c.key}: ${describe(c.key, c.before)} → ${describe(c.key, c.after)}`,
      detail: { key: c.key, before: c.before, after: c.after },
    })),
  )

  // The VAT rate reaches the till and every money figure, so refresh broadly.
  revalidatePath("/settings")
  revalidatePath("/pos")
  revalidatePath("/dashboard")
  revalidatePath("/reports")

  return formOk("Shop settings saved.")
}
