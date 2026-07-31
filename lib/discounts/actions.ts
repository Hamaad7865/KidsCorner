"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import {
  boolOf,
  fieldErrorsOf,
  formFail as fail,
  formOk,
  idOf,
  nullableTextOf,
  numberOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

/**
 * Discount rule CRUD. Mirrors the RLS on `discounts`
 * (`current_role_of_user() IN ('owner','manager')`), so a cashier gets a
 * sentence rather than a silent zero-row write.
 */

const discountSchema = z
  .object({
    id: z.number().int().positive().nullable(),
    name: z
      .string()
      .trim()
      .min(1, "Give the discount a name staff will recognise.")
      .max(80, "Keep the name under 80 characters."),
    code: z
      .string()
      .trim()
      .max(20, "Keep the code short.")
      .nullable(),
    kind: z.enum(["percent", "amount"]),
    value: z.number().positive("The value must be more than zero."),
    scope: z.enum(["sale", "line"]),
    categoryId: z.number().int().positive().nullable(),
    minSpend: z.number().min(0, "Minimum spend cannot be negative."),
    maxAmount: z.number().positive("A cap must be more than zero.").nullable(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    requiresManager: z.boolean(),
    isActive: z.boolean(),
  })
  // Mirrors the CHECK constraints, so the user sees a field error instead of a
  // raw constraint violation.
  .refine((v) => v.kind !== "percent" || v.value <= 100, {
    message: "A percentage cannot exceed 100.",
    path: ["value"],
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
    message: "The end date is before the start date.",
    path: ["endsOn"],
  })

export async function saveDiscount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can change discounts.")
  }

  const maxAmountRaw = textOf(formData, "maxAmount").trim()

  const parsed = discountSchema.safeParse({
    id: idOf(formData, "id"),
    name: textOf(formData, "name"),
    code: nullableTextOf(formData, "code"),
    kind: textOf(formData, "kind"),
    value: numberOf(formData, "value", NaN),
    scope: textOf(formData, "scope"),
    categoryId: idOf(formData, "categoryId"),
    minSpend: numberOf(formData, "minSpend", 0),
    // Blank means "no cap", which is different from zero.
    maxAmount: maxAmountRaw === "" ? null : numberOf(formData, "maxAmount", NaN),
    startsOn: nullableTextOf(formData, "startsOn"),
    endsOn: nullableTextOf(formData, "endsOn"),
    requiresManager: boolOf(formData, "requiresManager"),
    isActive: boolOf(formData, "isActive"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const d = parsed.data
  const values = {
    name: d.name,
    code: d.code,
    kind: d.kind,
    value: d.value,
    scope: d.scope,
    category_id: d.categoryId,
    min_spend: d.minSpend,
    max_amount: d.maxAmount,
    starts_on: d.startsOn,
    ends_on: d.endsOn,
    requires_manager: d.requiresManager,
    is_active: d.isActive,
  }

  const supabase = await createClient()
  const { data, error } =
    d.id === null
      ? await supabase.from("discounts").insert(values).select("id")
      : await supabase.from("discounts").update(values).eq("id", d.id).select("id")

  if (error) {
    if (error.code === "23505") {
      return fail(null, { code: "That code is already used by another discount." })
    }
    return fail(error.message)
  }
  if (data.length === 0) {
    return fail("That discount no longer exists. Refresh and try again.")
  }

  revalidatePath("/settings")
  revalidatePath("/pos")
  return formOk("Discount saved.")
}

export async function setDiscountActive(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can change discounts.")
  }

  const id = idOf(formData, "id")
  if (id === null) return fail("Couldn't tell which discount to update.")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("discounts")
    .update({ is_active: boolOf(formData, "isActive") })
    .eq("id", id)
    .select("id")

  if (error) return fail(error.message)
  if (data.length === 0) return fail("That discount no longer exists.")

  revalidatePath("/settings")
  revalidatePath("/pos")
  return formOk("Discount updated.")
}
