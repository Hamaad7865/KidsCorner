"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { changedFields, logAudit } from "@/lib/activity/audit"
import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import {
  fieldErrorsOf,
  formFail as fail,
  formOk,
  nullableTextOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

/**
 * Customers: create, and correct.
 *
 * The two are gated differently on purpose. The INSERT policy is
 * `WITH CHECK (true)` for any authenticated user, cashiers included, because
 * capturing a customer at the till is part of the sale. UPDATE (migration 037)
 * is owner and manager only: it rewrites a row that past sales point at, and
 * `/customers` is a back-office screen a cashier cannot reach anyway.
 *
 * There is still no delete. A customer attached to sales must not be able to
 * vanish out from under them.
 */

const customerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "A name is required.")
    .max(120, "Keep the name under 120 characters."),
  // UNIQUE in the schema, so a duplicate comes back as 23505 below.
  phone: z
    .string()
    .trim()
    .min(5, "That phone number looks too short.")
    .max(40, "That phone number is too long.")
    .nullable(),
  email: z.email("Enter a valid email address.").max(120).nullable(),
  notes: z.string().trim().max(1000, "That note is too long.").nullable(),
})

export async function createCustomer(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }

  const parsed = customerSchema.safeParse({
    fullName: textOf(formData, "fullName"),
    phone: nullableTextOf(formData, "phone"),
    email: nullableTextOf(formData, "email"),
    notes: nullableTextOf(formData, "notes"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { fullName, phone, email, notes } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("customers")
    .insert({ full_name: fullName, phone, email, notes })
    .select("id")
    .maybeSingle()

  if (error) {
    if (error.code === "23505") {
      return fail(null, {
        phone: "A customer with that phone number already exists.",
      })
    }
    if (error.code === "42501") {
      return fail("You don't have permission to add customers.")
    }
    return fail(error.message)
  }
  if (!data) return fail("The customer was not created. Please try again.")

  revalidatePath("/customers")
  return formOk(`${fullName} added.`)
}

/**
 * Correcting a customer's details.
 *
 * Owner and manager only, matching the RLS policy from migration 037. The
 * check is here as well as in the database because RLS refuses by matching no
 * rows rather than by raising — without it a cashier would get "Saved" and a
 * record that did not move.
 */
export async function updateCustomer(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can change a customer's details.")
  }

  const id = Number(textOf(formData, "id"))
  if (!Number.isInteger(id) || id <= 0) return fail("That customer no longer exists.")

  const parsed = customerSchema.safeParse({
    fullName: textOf(formData, "fullName"),
    phone: nullableTextOf(formData, "phone"),
    email: nullableTextOf(formData, "email"),
    notes: nullableTextOf(formData, "notes"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { fullName, phone, email, notes } = parsed.data
  const supabase = await createClient()

  // Read first, so the trail can say what actually moved. Only the four
  // columns being written — comparing more than was read back is how an audit
  // ends up reporting a change on every save.
  const { data: before } = await supabase
    .from("customers")
    .select("full_name, phone, email, notes")
    .eq("id", id)
    .maybeSingle()
  if (!before) return fail("That customer no longer exists.")

  const { data, error } = await supabase
    .from("customers")
    .update({ full_name: fullName, phone, email, notes })
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) {
    if (error.code === "23505") {
      return fail(null, {
        phone: "Another customer already has that phone number.",
      })
    }
    if (error.code === "42501") {
      return fail("You don't have permission to change customers.")
    }
    return fail(error.message)
  }
  // RLS filters rather than raises, so "no error and no row" is the shape a
  // refusal arrives in.
  if (!data) {
    return fail("That change was not saved. You may not have permission.")
  }

  const changes = changedFields(before, {
    full_name: fullName,
    phone,
    email,
    notes,
  })
  // A no-op is not an event.
  if (changes.length > 0) {
    await logAudit(supabase, {
      type: "customer.changed",
      refType: "customer",
      refId: id,
      summary: `${fullName}: ${changes.map((c) => c.field).join(", ")}`,
      detail: { changes },
    })
  }

  revalidatePath("/customers")
  revalidatePath(`/customers/${id}`)
  return changes.length > 0
    ? formOk(`${fullName} updated.`)
    : formOk("Nothing to change.")
}
