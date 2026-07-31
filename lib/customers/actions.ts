"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

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
 * Customer creation.
 *
 * Deliberately create-only. Migration 001 gives `customers` a SELECT policy and
 * an INSERT policy and nothing else, so UPDATE and DELETE are refused by RLS —
 * an edit form here would appear to work and silently change nothing. Adding
 * one means adding an UPDATE policy in a new migration first.
 *
 * Note the INSERT policy is `WITH CHECK (true)` for any authenticated user,
 * including cashiers: capturing a customer at the till is part of the POS flow,
 * so this is not gated on the catalog-manager role like the back-office writes.
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
