"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { round2 } from "@/lib/format"
import {
  boolOf,
  fieldErrorsOf,
  formFail as fail,
  formOk,
  idOf,
  nullableTextOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

/**
 * Suppliers and purchases.
 *
 * A purchase is created as a draft and adds no stock. `receive_purchase` is the
 * only thing that turns its lines into stock movements — it is SECURITY DEFINER
 * and does the whole job atomically (status, movements, cost prices), so
 * nothing here duplicates that logic.
 */

async function guard(): Promise<FormState | null> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can manage purchases.")
  }
  return null
}

function describeDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "23503":
      return "That supplier or variant no longer exists. Refresh and try again."
    case "42501":
      return "You don't have permission to do that."
    default:
      return error.message
  }
}

// -------------------------------------------------------------- suppliers

const supplierSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: z
    .string()
    .trim()
    .min(1, "Supplier name is required.")
    .max(120, "Keep the name under 120 characters."),
  phone: z.string().trim().max(40, "That phone number is too long.").nullable(),
  email: z.email("Enter a valid email address.").max(120).nullable(),
  address: z.string().trim().max(300, "That address is too long.").nullable(),
  contactName: z
    .string()
    .trim()
    .max(120, "Keep the contact name under 120 characters.")
    .nullable(),
  town: z.string().trim().max(80, "That town name is too long.").nullable(),
  paymentTerms: z
    .string()
    .trim()
    .max(60, "Keep the terms short — they go in a table column.")
    .nullable(),
  isActive: z.boolean(),
})

export async function saveSupplier(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await guard()
  if (denied) return denied

  const parsed = supplierSchema.safeParse({
    id: idOf(formData, "id"),
    name: textOf(formData, "name"),
    phone: nullableTextOf(formData, "phone"),
    email: nullableTextOf(formData, "email"),
    address: nullableTextOf(formData, "address"),
    contactName: nullableTextOf(formData, "contactName"),
    town: nullableTextOf(formData, "town"),
    paymentTerms: nullableTextOf(formData, "paymentTerms"),
    isActive: boolOf(formData, "isActive"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { id, name, phone, email, address, contactName, town, paymentTerms, isActive } =
    parsed.data
  const values = {
    name,
    phone,
    email,
    address,
    contact_name: contactName,
    town,
    payment_terms: paymentTerms,
    is_active: isActive,
  }

  const supabase = await createClient()
  const { data, error } =
    id === null
      ? await supabase.from("suppliers").insert(values).select("id")
      : await supabase.from("suppliers").update(values).eq("id", id).select("id")

  if (error) return fail(describeDbError(error))
  if (data.length === 0) {
    return fail("That supplier no longer exists. Refresh and try again.")
  }

  revalidatePath("/suppliers")
  revalidatePath("/purchases")
  return formOk("Supplier saved.")
}

// -------------------------------------------------------------- purchases

const lineSchema = z.object({
  variantId: z.number().int().positive(),
  // purchase_items has CHECK (qty > 0), so zero-quantity lines are rejected
  // here rather than surfacing as a constraint violation.
  qty: z.number().int().min(1, "Quantity must be at least 1."),
  unitCost: z.number().min(0, "Unit cost cannot be negative.").max(99_999_999.99),
})

const purchaseSchema = z.object({
  id: z.number().int().positive().nullable(),
  supplierId: z.number().int().positive("Pick a supplier."),
  invoiceNo: z.string().trim().max(60, "That invoice number is too long.").nullable(),
  purchaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid purchase date."),
  // Nullable: an empty field means the supplier has not given a date, which is
  // a different fact from "arriving today" and must not become one.
  expectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid expected date.")
    .nullable(),
  notes: z.string().trim().max(1000, "That note is too long.").nullable(),
  lines: z.array(lineSchema).min(1, "Add at least one line."),
})

/** Lines arrive as JSON in a hidden field — the editor is a client-side list. */
function parseLines(formData: FormData): unknown {
  const raw = textOf(formData, "lines")
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export async function savePurchase(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await guard()
  if (denied) return denied

  const parsed = purchaseSchema.safeParse({
    id: idOf(formData, "id"),
    supplierId: idOf(formData, "supplierId") ?? 0,
    invoiceNo: nullableTextOf(formData, "invoiceNo"),
    purchaseDate: textOf(formData, "purchaseDate"),
    expectedDate: nullableTextOf(formData, "expectedDate"),
    notes: nullableTextOf(formData, "notes"),
    lines: parseLines(formData),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { id, supplierId, invoiceNo, purchaseDate, expectedDate, notes, lines } =
    parsed.data

  // One row per variant: purchase_items has no unique constraint, but two lines
  // for the same variant would receive twice and confuse the totals.
  const byVariant = new Map<number, { qty: number; unitCost: number }>()
  for (const line of lines) {
    const existing = byVariant.get(line.variantId)
    if (existing) existing.qty += line.qty
    else byVariant.set(line.variantId, { qty: line.qty, unitCost: line.unitCost })
  }

  const total = round2(
    [...byVariant.values()].reduce((sum, l) => sum + l.qty * l.unitCost, 0),
  )

  const supabase = await createClient()

  // Checked up front because replacing an existing draft's lines is a delete
  // followed by an insert with no transaction around it. A vanished variant is
  // the realistic way the insert fails, and by then the old lines are already
  // gone. Verifying first turns that into a clean rejection.
  const variantIds = [...byVariant.keys()]
  const { data: liveVariants, error: variantError } = await supabase
    .from("product_variants")
    .select("id")
    .in("id", variantIds)

  if (variantError) return fail(describeDbError(variantError))
  if ((liveVariants ?? []).length !== variantIds.length) {
    return fail(
      "One of those variants no longer exists. Refresh the page and rebuild the affected line.",
    )
  }

  const header = {
    supplier_id: supplierId,
    invoice_no: invoiceNo,
    purchase_date: purchaseDate,
    expected_date: expectedDate,
    notes,
    total_amount: total,
  }

  let purchaseId = id

  if (purchaseId === null) {
    const { data, error } = await supabase
      .from("purchases")
      .insert(header)
      .select("id")
      .maybeSingle()
    if (error) return fail(describeDbError(error))
    if (!data) return fail("The purchase was not created. Please try again.")
    purchaseId = data.id
  } else {
    // Only drafts are editable; a received purchase has already moved stock.
    const { data: current, error: readError } = await supabase
      .from("purchases")
      .select("status")
      .eq("id", purchaseId)
      .maybeSingle()
    if (readError) return fail(describeDbError(readError))
    if (!current) return fail("That purchase no longer exists.")
    if (current.status !== "draft") {
      return fail("This purchase has already been received and can't be edited.")
    }

    // The result is checked, not assumed. A receipt landing between the read
    // above and this write makes the guard match no row — and the line-clearing
    // DELETE below would then fire against a purchase that has already booked
    // stock in. (The database refuses that too, since migration 030, but this
    // says so in words the buyer can act on.)
    const { data: updated, error } = await supabase
      .from("purchases")
      .update(header)
      .eq("id", purchaseId)
      .eq("status", "draft")
      .select("id")
    if (error) return fail(describeDbError(error))
    if (!updated || updated.length === 0) {
      return fail("This purchase was received while you were editing it, so nothing was changed.")
    }

    // Replace the lines wholesale — simpler and safer than diffing, and the
    // rows carry no history of their own while the purchase is still a draft.
    const { error: clearError } = await supabase
      .from("purchase_items")
      .delete()
      .eq("purchase_id", purchaseId)
    if (clearError) return fail(describeDbError(clearError))
  }

  const { error: linesError } = await supabase.from("purchase_items").insert(
    [...byVariant.entries()].map(([variantId, line]) => ({
      purchase_id: purchaseId as number,
      variant_id: variantId,
      qty: line.qty,
      unit_cost: round2(line.unitCost),
      // line_total is GENERATED ALWAYS — inserting it would be an error.
    })),
  )
  if (linesError) {
    // Only reachable on an edit, where the old lines have already been deleted.
    // Say so rather than reporting a bare database error against a draft that
    // now looks empty.
    return fail(
      id === null
        ? describeDbError(linesError)
        : `The lines could not be saved and the previous ones have been cleared — please re-add them. (${describeDbError(linesError)})`,
    )
  }

  revalidatePath("/purchases")
  revalidatePath(`/purchases/${purchaseId}`)

  if (id === null) redirect(`/purchases/${purchaseId}`)
  return formOk("Purchase saved.")
}

/**
 * Hands off to the `receive_purchase` RPC, which marks the purchase received,
 * freezes the then-current VAT policy, records a `purchase` movement per line
 * and updates each variant's cost price — atomically, and only from `draft`.
 */
export async function receivePurchase(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await guard()
  if (denied) return denied

  const purchaseId = idOf(formData, "id")
  if (purchaseId === null) return fail("Couldn't tell which purchase to receive.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("receive_purchase", {
    p_purchase_id: purchaseId,
  })

  if (error) {
    // The RPC raises when the purchase is not in draft — usually a double click
    // or a second tab that already received it.
    return fail(
      /not in draft status/i.test(error.message)
        ? "This purchase has already been received."
        : describeDbError(error),
    )
  }

  revalidatePath("/purchases")
  revalidatePath(`/purchases/${purchaseId}`)
  revalidatePath("/stock")
  revalidatePath("/products")
  revalidatePath("/reports")
  return formOk("Received. Stock, cost prices, and the VAT snapshot have been updated.")
}

export async function cancelPurchase(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const denied = await guard()
  if (denied) return denied

  const purchaseId = idOf(formData, "id")
  if (purchaseId === null) return fail("Couldn't tell which purchase to cancel.")

  const supabase = await createClient()
  // Guarded on status so a received purchase can never be cancelled out from
  // under the stock movements it already created.
  const { data, error } = await supabase
    .from("purchases")
    .update({ status: "cancelled" })
    .eq("id", purchaseId)
    .eq("status", "draft")
    .select("id")

  if (error) return fail(describeDbError(error))
  if (data.length === 0) {
    return fail("Only a draft purchase can be cancelled.")
  }

  revalidatePath("/purchases")
  revalidatePath(`/purchases/${purchaseId}`)
  return formOk("Purchase cancelled.")
}
