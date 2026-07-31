"use server"

import { revalidatePath } from "next/cache"

import { isAdminRole } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { round2 } from "@/lib/format"
import {
  formFail as fail,
  formOk,
  idOf,
  numberOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { PIN_PATTERN, hashPin } from "@/lib/pos/pin"
import {
  closeShiftFor,
  openShiftFor,
  recordMovementFor,
} from "@/lib/pos/shift-core"
import {
  authenticateCashier,
  commitSale,
  completeSaleSchema,
  listCashiers as listCashiersCore,
  pinLockSeconds as pinLockSecondsCore,
  type Cashier,
  type CompleteSaleInput,
  type CompleteSaleResult,
} from "@/lib/pos/sale-core"
import { createClient } from "@/lib/supabase/server"

/**
 * Till actions: opening a shift and completing a sale.
 *
 * Every role may use the till, including cashiers, so these gate on a valid
 * active session rather than the catalog-manager role the back office uses.
 *
 * The money rules are not here. They live in `sale-core`, which the Android
 * till's route handlers call too — one implementation, two transports. What
 * remains in this file is the cookie-session check and cache revalidation,
 * which are the only parts that are genuinely Next-specific.
 *
 * Types live in `sale-core` and are imported from there, never re-exported
 * through here. A `"use server"` module's exports are compiled into the action
 * manifest, and `export type { … }` survives that transform as a runtime export
 * of something that does not exist at runtime — which typechecks and lints
 * clean, then fails the production build.
 */

async function requireTillUser(): Promise<
  { id: string; name: string } | FormState
> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return fail("Your session has expired. Sign in again.")
  }
  return { id: profile.id, name: profile.fullName }
}

// --------------------------------------------------------------- cashiers

/** Staff who can be switched to at the till. */
export async function listCashiers(): Promise<Cashier[]> {
  const user = await requireTillUser()
  if ("status" in user) return []
  return listCashiersCore(await createClient())
}

/** Seconds a profile must wait before it may try a PIN again. 0 means now. */
export async function pinLockSeconds(profileId: string): Promise<number> {
  const user = await requireTillUser()
  if ("status" in user) return 0
  return pinLockSecondsCore(await createClient(), profileId)
}

/** Verifies a 4-digit PIN server-side. The hash never leaves the server. */
export async function switchCashier(
  profileId: string,
  pin: string,
): Promise<{ ok: boolean; error?: string; cashier?: Cashier; lockedFor?: number }> {
  const user = await requireTillUser()
  if ("status" in user) return { ok: false, error: "Session expired." }
  return authenticateCashier(await createClient(), profileId, pin)
}

/** Frees a locked-out cashier without waiting out the clock. Owner/manager. */
export async function clearPinLock(profileId: string): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (!isAdminRole(profile.role)) {
    return fail("Only an owner or manager can unlock a cashier.")
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("clear_pin_lock", { p_profile_id: profileId })
  if (error) return fail(error.message)

  revalidatePath("/settings")
  return formOk("Cashier unlocked.")
}

/**
 * Sets or clears a staff PIN. Owner-only, matching
 * `manage_profiles ... current_role_of_user() = 'owner'` — a non-owner's UPDATE
 * matches zero rows under RLS, which is why the result is checked rather than
 * assumed.
 */
export async function setCashierPin(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (profile.role !== "owner") return fail("Only the owner can set PINs.")

  const profileId = textOf(formData, "profileId")
  const pin = textOf(formData, "pin").trim()
  const clearing = pin === ""

  if (!clearing && !PIN_PATTERN.test(pin)) {
    return fail(null, { pin: "A PIN must be exactly 4 digits." })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .update({ pin_code: clearing ? null : await hashPin(pin) })
    .eq("id", profileId)
    .select("id")

  if (error) return fail(error.message)
  if (data.length === 0) {
    return fail("That staff member could not be updated — check you are the owner.")
  }

  revalidatePath("/settings")
  return formOk(clearing ? "PIN cleared." : "PIN set.")
}

// ----------------------------------------------------------------- shifts

export async function openShift(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireTillUser()
  if ("status" in user) return user

  const openingFloat = numberOf(formData, "openingFloat", NaN)
  if (!Number.isFinite(openingFloat)) {
    return fail(null, { openingFloat: "Enter the opening float." })
  }

  const result = await openShiftFor(await createClient(), user, openingFloat)
  if (!result.ok) return fail(result.error)

  revalidatePath("/pos")
  return formOk("Till open.")
}

/**
 * Petty cash in or out of an open drawer.
 *
 * The form offers a positive figure plus a direction, which is far harder to
 * get wrong at a till than asking someone to type a minus sign. The sign is
 * applied here; everything past that is `recordMovementFor`, which the Android
 * till reaches through `/api/till/shift/movement`.
 */
export async function recordTillMovement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireTillUser()
  if ("status" in user) return user

  const shiftId = idOf(formData, "shiftId")
  if (shiftId === null) return fail("Couldn't tell which shift this belongs to.")

  const magnitude = numberOf(formData, "amount", NaN)
  if (!Number.isFinite(magnitude)) return fail(null, { amount: "Enter an amount." })

  const isPayIn = textOf(formData, "direction") === "in"

  const result = await recordMovementFor(
    await createClient(),
    shiftId,
    isPayIn ? magnitude : -magnitude,
    textOf(formData, "reason"),
  )
  if (!result.ok) return fail(result.error)

  revalidatePath("/pos/shift")
  return formOk(
    isPayIn
      ? `${round2(magnitude).toFixed(2)} paid into the till.`
      : `${round2(magnitude).toFixed(2)} taken out of the till.`,
  )
}

/**
 * Closes the shift and records the cash variance.
 *
 * `expected_cash` is recomputed inside `closeShiftFor` rather than trusted from
 * the client — it is the number the day reconciles against, so it must come
 * from the sales ledger, not from whatever the browser posted.
 */
export async function closeShift(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireTillUser()
  if ("status" in user) return user

  // Guarded first: no UI renders a "shiftId" field error, so it would fail
  // silently with the dialog just sitting there.
  const shiftId = idOf(formData, "shiftId")
  if (shiftId === null) return fail("Couldn't tell which shift to close.")

  const countedCash = numberOf(formData, "countedCash", NaN)
  if (!Number.isFinite(countedCash)) {
    return fail(null, { countedCash: "Enter the counted cash." })
  }

  const result = await closeShiftFor(await createClient(), user, {
    shiftId,
    countedCash,
    notes: textOf(formData, "notes").trim() || null,
  })
  if (!result.ok) return fail(result.error)

  const { variance } = result.value

  revalidatePath("/pos")
  revalidatePath("/dashboard")

  return formOk(
    variance === 0
      ? "Till closed and balanced."
      : `Till closed. Variance ${variance > 0 ? "+" : ""}${variance.toFixed(2)}.`,
  )
}

// ------------------------------------------------------------------ sale

/**
 * The web till's entry point to a sale.
 *
 * Validation, pricing, discount settlement and the commit are all in
 * `sale-core`. What is left here is the cookie session and the cache
 * invalidation — and that is the whole point of the split: the Android till
 * reaches the same `commitSale` through `/api/till/sale`, so there is no second
 * copy of the money rules to keep in step with this one.
 */
export async function completeSale(
  input: CompleteSaleInput,
): Promise<CompleteSaleResult> {
  const user = await requireTillUser()
  if ("status" in user) {
    return { ok: false, error: user.error ?? "Not signed in." }
  }

  const parsed = completeSaleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid sale." }
  }

  const result = await commitSale(await createClient(), user, parsed.data)

  if (result.ok) {
    revalidatePath("/pos")
    revalidatePath("/stock")
    revalidatePath("/sales")
  }
  return result
}
