"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { changedFields, logAudit } from "@/lib/activity/audit"
import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { formatRs } from "@/lib/format"
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

  // What it was, so an edit can say what moved. A discount rule is the one
  // catalogue setting that gives money away, and changing it leaves no other
  // record anywhere.
  //
  // Every column in `values` is read back, not a subset. `changedFields` walks
  // the keys of the NEW row, so a column missing from this select reads as
  // absent-before and is reported as changed on every save — which would have
  // made "code, starts_on, ends_on changed" the summary of an edit that only
  // touched the percentage.
  const { data: before } =
    d.id === null
      ? { data: null }
      : await supabase
          .from("discounts")
          .select(Object.keys(values).join(", "))
          .eq("id", d.id)
          .maybeSingle<Record<string, unknown>>()

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

  const amount = d.kind === "percent" ? `${d.value}%` : formatRs(d.value)

  if (d.id === null) {
    await logAudit(supabase, {
      type: "discount.created",
      refType: "discount",
      refId: data[0].id,
      summary: `${d.name} · ${amount}${d.requiresManager ? " · needs a manager" : ""}`,
      detail: values,
    })
  } else if (before) {
    const changes = changedFields(before, values)
    // A save that touched nothing is not an event. See lib/activity/audit.ts.
    if (changes.length > 0) {
      await logAudit(supabase, {
        type: "discount.changed",
        refType: "discount",
        refId: d.id,
        summary: `${d.name} · ${changes.map((c) => c.field).join(", ")}`,
        detail: { changes },
      })
    }
  }

  revalidatePath("/settings")
  revalidatePath("/point-of-sale")
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

  const isActive = boolOf(formData, "isActive")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("discounts")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("id, name")

  if (error) return fail(error.message)
  if (data.length === 0) return fail("That discount no longer exists.")

  // Retiring a rule is the closest thing this app has to deleting one — the row
  // stays so old sales keep their reason, and the trail names it as a removal
  // rather than as one more edit.
  await logAudit(supabase, {
    type: isActive ? "discount.changed" : "discount.deleted",
    refType: "discount",
    refId: id,
    summary: `${data[0].name} ${isActive ? "switched on" : "retired"}`,
    detail: { isActive },
  })

  revalidatePath("/settings")
  revalidatePath("/point-of-sale")
  return formOk("Discount updated.")
}
