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
  paymentMethods: z
    .array(z.enum(PAYMENT_METHODS))
    .min(1, "The till needs at least one payment method."),
  refundRequiresManager: z.boolean(),

  // Both optional. The VAT rate and number are no longer edited here — they
  // belong to the append-only VAT policy ledger, changed through the VAT
  // registration card and its `set_vat_policy` RPC, so that every change is a
  // frozen, audited policy version rather than a mutable setting.
  shopAddress: z.string().trim().max(200, "Keep the address under 200 characters."),
  shopPhone: z.string().trim().max(40, "That phone number is too long."),
})

const SETTING_LABELS: Record<string, string> = {
  shop_name: "Shop name",
  shop_address: "Shop address",
  shop_phone: "Shop phone",
  payment_methods: "Payment methods",
  refund_requires_manager: "Manager approval for returns",
}

/**
 * A settings value as a person would say it.
 *
 * The payment methods are a JSON array and read as a list; a boolean reads as
 * required/not required. Without this the trail would use the database's
 * phrasing rather than the shop's.
 */
function describe(_key: string, value: unknown): string {
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
    paymentMethods: formData.getAll("paymentMethods").filter(
      (v): v is string => typeof v === "string",
    ),
    refundRequiresManager: boolOf(formData, "refundRequiresManager"),
    shopAddress: textOf(formData, "shopAddress"),
    shopPhone: textOf(formData, "shopPhone"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const {
    shopName,
    paymentMethods,
    refundRequiresManager,
    shopAddress,
    shopPhone,
  } = parsed.data
  const supabase = await createClient()

  // Upserted one key at a time: `settings` is a key/value table, and doing them
  // together would need a single statement anyway. Any failure stops the rest,
  // so a partial change is reported rather than silently half-applied.
  const rows = [
    { key: "shop_name", value: shopName },
    { key: "payment_methods", value: paymentMethods },
    { key: "refund_requires_manager", value: refundRequiresManager },
    // Address and phone are what getShopIdentity has always read and nothing
    // ever wrote: the receipt printed with no address and no phone. They are
    // not seeded by any migration, so the insert branch below is the path that
    // creates them the first time an owner saves. The VAT rate and number are
    // not here — they live in the VAT policy ledger now.
    { key: "shop_address", value: shopAddress },
    { key: "shop_phone", value: shopPhone },
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
  revalidatePath("/point-of-sale")
  revalidatePath("/dashboard")
  revalidatePath("/reports")

  return formOk("Shop settings saved.")
}
