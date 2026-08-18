"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSessionProfile } from "@/lib/auth/session"
import {
  fieldErrorsOf,
  formFail as fail,
  formOk,
  numberOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"
import { getCurrentVatPolicy } from "@/lib/vat/policy"

/**
 * Owner-only VAT registration control.
 *
 * Every change appends an immutable `vat_policies` row through `set_vat_policy`
 * — the single security-definer RPC that validates the transition, updates the
 * `settings` pointer, and writes the Activity event, atomically. This action
 * never writes `vat_enabled`, `vat_rate` or `vat_number` through the generic
 * settings path; those three keys belong to the policy ledger now.
 *
 * The form carries an `intent`:
 *   - `enable`  — turn VAT on; requires a non-blank VAT number.
 *   - `disable` — turn VAT off; the configured rate and number are retained on
 *                 the new disabled policy for later reactivation.
 *   - `save`    — keep the current on/off status but store an edited rate/number
 *                 as a new policy for future activity, without toggling.
 */

/** The form state shape; identical to the shared FormState the card renders. */
export type VatSettingsState = FormState

const vatSettingsSchema = z
  .object({
    intent: z.enum(["save", "enable", "disable"]),
    // Entered as a percentage (15), stored as a fraction (0.15). Must stay
    // within (0, 100]; the RPC enforces the same bound as a last line.
    ratePercent: z
      .number({ error: "Enter the VAT rate as a percentage." })
      .gt(0, "VAT rate must be greater than 0%.")
      .max(100, "VAT rate cannot exceed 100%."),
    vatNumber: z.string().trim().max(30, "That VAT number is too long."),
  })
  .refine((v) => v.intent !== "enable" || v.vatNumber.length > 0, {
    path: ["vatNumber"],
    message: "A VAT number is required to register for VAT.",
  })

/** Turns the RPC's raised messages into text an owner should see. */
function friendlyError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes("only an active owner")) {
    return "Only the owner can change VAT registration."
  }
  if (lower.includes("vat number is required")) {
    return "A VAT number is required to register for VAT."
  }
  if (lower.includes("configured vat rate")) {
    return "VAT rate must be greater than 0% and at most 100%."
  }
  return "Could not save the VAT change. Please try again."
}

export async function saveVatPolicy(
  _prev: VatSettingsState,
  formData: FormData,
): Promise<VatSettingsState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (profile.role !== "owner") {
    return fail("Only the owner can change VAT registration.")
  }

  const parsed = vatSettingsSchema.safeParse({
    intent: textOf(formData, "intent"),
    ratePercent: numberOf(formData, "ratePercent", NaN),
    vatNumber: textOf(formData, "vatNumber"),
  })
  if (!parsed.success) return fail(null, fieldErrorsOf(parsed.error))

  const { intent, ratePercent, vatNumber } = parsed.data
  const supabase = await createClient()

  // `save` keeps whatever the shop's current status is; only enable/disable set
  // it explicitly. Reading the current policy is the authoritative source — a
  // hidden form field could be tampered with.
  let enabled: boolean
  if (intent === "enable") enabled = true
  else if (intent === "disable") enabled = false
  else {
    const current = await getCurrentVatPolicy(supabase)
    enabled = current.enabled
  }

  // Rounded to 6dp to match vat_policies.configured_rate NUMERIC(7,6): a rate
  // typed as 15 becomes 0.15 exactly, with no float tail for the sale RPC's
  // divide-by-(1+rate) to smear across every VAT figure.
  const configuredRate = Math.round((ratePercent / 100) * 1_000_000) / 1_000_000

  const { error } = await supabase.rpc("set_vat_policy", {
    p_enabled: enabled,
    p_configured_rate: configuredRate,
    p_vat_number: vatNumber,
  })
  if (error) return fail(friendlyError(error.message))

  // The policy reaches Settings, the dashboard, every report, the receipt
  // routes and the till bootstrap — refresh all of them.
  revalidatePath("/settings")
  revalidatePath("/dashboard")
  revalidatePath("/reports")
  revalidatePath("/sales")
  revalidatePath("/pos")

  const done =
    intent === "enable"
      ? "VAT is now active. New sales will show VAT."
      : intent === "disable"
        ? "VAT is now disabled. New sales will contain no VAT."
        : "VAT details saved."
  return formOk(done)
}
