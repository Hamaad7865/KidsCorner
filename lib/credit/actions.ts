"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { changedFields, logAudit } from "@/lib/activity/audit"
import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { formatRs } from "@/lib/format"
import {
  fieldErrorsOf,
  formFail as fail,
  formOk,
  boolOf,
  idOf,
  intOf,
  nullableTextOf,
  numberOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

/**
 * Writes against a customer's account.
 *
 * Three different things happen here and they are gated differently, which is
 * the point of keeping them in one file where the difference is visible:
 *
 *   SETTING THE TERMS is owner and manager, matching migration 037's UPDATE
 *   policy on `customers` — a credit limit is a column on that row.
 *
 *   TAKING A PAYMENT is owner and manager *here*, because `/customers` is a
 *   back-office route a cashier cannot reach. The till takes payments through
 *   `/api/till/credit`, which is open to cashiers on purpose: a customer
 *   walking in to pay their tab is a counter job.
 *
 *   WRITING OFF is owner only, and that is enforced in the database by
 *   `write_off_customer_credit` rather than trusted from here. Declaring a debt
 *   uncollectable is the one action that destroys money without anybody
 *   handing any over.
 *
 * None of these touch the ledger with an UPDATE. There is no policy that would
 * allow it: every change is a new row through a SECURITY DEFINER function.
 */

// ------------------------------------------------------------------- terms

const termsSchema = z.object({
  creditEnabled: z.boolean(),
  creditTermsDays: z
    .number({ error: "Enter the days as a whole number." })
    .int("Enter the days as a whole number.")
    .min(0, "Terms cannot be negative.")
    .max(365, "Keep terms within a year."),
  creditOnHold: z.boolean(),
})

/**
 * Opens, changes or closes a customer's account.
 *
 * Switching the account off is how it is closed, and it is deliberately NOT
 * blocked when money is still owed: the shop's usual response to a customer who
 * has stopped paying is to stop lending immediately, and the outstanding
 * balance stays on the books and in the aging report regardless. Refusing the
 * change until the debt was cleared would leave the only lever unusable at
 * exactly the moment it is needed.
 */
export async function setCreditTerms(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can change a credit account.")
  }

  const customerId = idOf(formData, "customerId")
  if (customerId === null) return fail("That customer no longer exists.")

  const parsed = termsSchema.safeParse({
    creditEnabled: boolOf(formData, "creditEnabled"),
    creditTermsDays: intOf(formData, "creditTermsDays", 30),
    creditOnHold: boolOf(formData, "creditOnHold"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { creditEnabled, creditTermsDays, creditOnHold } = parsed.data
  const supabase = await createClient()

  const { data: before } = await supabase
    .from("customers")
    .select("full_name, credit_enabled, credit_terms_days, credit_on_hold")
    .eq("id", customerId)
    .maybeSingle()
  if (!before) return fail("That customer no longer exists.")

  const { data, error } = await supabase
    .from("customers")
    .update({
      credit_enabled: creditEnabled,
      credit_terms_days: creditTermsDays,
      credit_on_hold: creditOnHold,
    })
    .eq("id", customerId)
    .select("id")
    .maybeSingle()

  if (error) {
    if (error.code === "42501") {
      return fail("You don't have permission to change credit accounts.")
    }
    return fail(error.message)
  }
  // RLS filters rather than raises, so "no error and no row" is a refusal.
  if (!data) {
    return fail("That change was not saved. You may not have permission.")
  }

  const changes = changedFields(
    {
      credit_enabled: before.credit_enabled,
      credit_terms_days: before.credit_terms_days,
      credit_on_hold: before.credit_on_hold,
    },
    {
      credit_enabled: creditEnabled,
      credit_terms_days: creditTermsDays,
      credit_on_hold: creditOnHold,
    },
  )

  if (changes.length > 0) {
    await logAudit(supabase, {
      type: "customer.credit_changed",
      refType: "customer",
      refId: customerId,
      summary:
        `${before.full_name}: account ${creditEnabled ? "open" : "closed"}, ` +
        `${creditTermsDays} days${creditOnHold ? ", on hold" : ""}`,
      detail: { changes },
    })
  }

  revalidatePath("/customers")
  revalidatePath(`/customers/${customerId}`)
  revalidatePath("/reports/receivables")

  if (changes.length === 0) return formOk("Nothing to change.")
  return formOk(
    creditEnabled
      ? `${before.full_name}'s account is open.`
      : `${before.full_name}'s account closed to new charges.`,
  )
}

// ---------------------------------------------------------------- payments

const settleSchema = z.object({
  amount: z
    .number({ error: "Enter an amount." })
    .positive("A payment has to be more than nothing.")
    .max(9_999_999, "That amount is too large."),
  method: z.enum(["cash", "card", "juice", "myt_money", "bank"], {
    error: "Choose how the payment was made.",
  }),
  reason: z.string().trim().max(200, "Keep the note under 200 characters.").nullable(),
})

/**
 * Records money received against an account.
 *
 * The arithmetic and every refusal live in `settle_customer_credit`: it locks
 * the customer, re-reads the balance, refuses an over-payment, and — for cash
 * taken at a till — writes the matching till movement so the drawer expects the
 * money. None of that is repeated here, because a second implementation of a
 * money rule is a second answer waiting to disagree.
 *
 * No `shiftId`: a payment taken in the back office did not go into any drawer.
 * The till passes its own shift through `/api/till/credit`.
 */
export async function settleAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can record a payment here.")
  }

  const customerId = idOf(formData, "customerId")
  if (customerId === null) return fail("That customer no longer exists.")

  const parsed = settleSchema.safeParse({
    amount: numberOf(formData, "amount", NaN),
    method: textOf(formData, "method"),
    reason: nullableTextOf(formData, "reason"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { amount, method, reason } = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("settle_customer_credit", {
    p_customer_id: customerId,
    p_amount: amount,
    p_method: method,
    p_shift_id: undefined,
    p_reason: reason ?? undefined,
  })

  if (error) {
    if (error.code === "42501") {
      return fail("You don't have permission to record a payment.")
    }
    // The function raises `check_violation` with a sentence written for a
    // person — "Rita Appadoo only owes Rs 350.00" — so it is shown as-is
    // rather than replaced with something vaguer.
    return fail(error.message)
  }

  const balance =
    data && typeof data === "object" && "balance" in data
      ? Number((data as { balance: unknown }).balance)
      : null

  await logAudit(supabase, {
    type: "customer.credit_settled",
    refType: "customer",
    refId: customerId,
    summary: `${formatRs(amount)} received on account`,
    detail: { amount, method, reason, balance },
  })

  revalidatePath("/customers")
  revalidatePath(`/customers/${customerId}`)
  revalidatePath("/reports/receivables")

  return formOk(
    balance === null
      ? `${formatRs(amount)} recorded.`
      : `${formatRs(amount)} recorded — ${formatRs(balance)} still owing.`,
  )
}

// --------------------------------------------------------------- write-off

const writeOffSchema = z.object({
  amount: z
    .number({ error: "Enter an amount." })
    .positive("A write-off needs an amount.")
    .max(9_999_999, "That amount is too large."),
  reason: z
    .string()
    .trim()
    .min(3, "Say why this debt is being written off.")
    .max(200, "Keep the reason under 200 characters."),
})

/**
 * Declares part of a debt uncollectable.
 *
 * Owner only, enforced in `write_off_customer_credit` by
 * `current_role_of_user()` rather than here — the function is SECURITY DEFINER,
 * so it runs with privileges that ignore the policies on the table it writes,
 * and a role check that only existed in TypeScript would be no check at all.
 *
 * A reason is required by the function too. This is the one entry type that
 * reduces a balance with no money involved, so the record of WHY is the only
 * thing distinguishing it from a mistake.
 */
export async function writeOffAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  if (profile.role !== "owner") {
    return fail("Only an owner can write off a debt.")
  }

  const customerId = idOf(formData, "customerId")
  if (customerId === null) return fail("That customer no longer exists.")

  const parsed = writeOffSchema.safeParse({
    amount: numberOf(formData, "amount", NaN),
    reason: textOf(formData, "reason"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { amount, reason } = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("write_off_customer_credit", {
    p_customer_id: customerId,
    p_amount: amount,
    p_reason: reason,
  })

  if (error) {
    if (error.code === "42501") return fail("Only an owner can write off a debt.")
    return fail(error.message)
  }

  const balance =
    data && typeof data === "object" && "balance" in data
      ? Number((data as { balance: unknown }).balance)
      : null

  await logAudit(supabase, {
    type: "customer.credit_written_off",
    refType: "customer",
    refId: customerId,
    summary: `${formatRs(amount)} written off — ${reason}`,
    detail: { amount, reason, balance },
  })

  revalidatePath("/customers")
  revalidatePath(`/customers/${customerId}`)
  revalidatePath("/reports/receivables")

  return formOk(`${formatRs(amount)} written off.`)
}
