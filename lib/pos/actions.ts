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

  const supabase = await createClient()
  // This keypad is the web till, so the sign-in is attributed to the
  // back-office device — the same row the shift opener uses.
  const { data: backOffice } = await supabase
    .from("pos_devices")
    .select("id")
    .eq("code", "back-office")
    .maybeSingle()

  return authenticateCashier(supabase, profileId, pin, backOffice?.id ?? null)
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

  const supabase = await createClient()

  // The web till is always the seeded back-office device — it has no install
  // to generate an id, and there is only ever one of it.
  const { data: backOffice } = await supabase
    .from("pos_devices")
    .select("id")
    .eq("code", "back-office")
    .maybeSingle()

  const result = await openShiftFor(supabase, user, openingFloat, backOffice?.id ?? null)
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

/**
 * Closes a shift from the BACK OFFICE, not from the till.
 *
 * Ported from Carfectionist's "power off". The case is mundane and constant:
 * the shop shuts, everybody leaves, and nobody pressed Close on the tablet.
 * Left open, the next day's sales land inside the same shift and the Z covers
 * two days — which cannot be corrected afterwards, because being frozen is the
 * whole point of a Z.
 *
 * Owner and manager only. Closing a till decides a cash variance that somebody
 * may be answerable for, and doing that remotely — for a drawer you are not
 * standing at — is a step further than a cashier's own close. `closeShiftFor`
 * still recomputes `expected_cash` server-side, so the figure this is judged
 * against never comes from the browser.
 */
export async function closeShiftRemotely(input: {
  shiftId: number
  countedCash: number
  notes: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return { ok: false, error: "Your session has expired. Sign in again." }
  }
  if (profile.role !== "owner" && profile.role !== "manager") {
    return { ok: false, error: "Only an owner or manager can close a till remotely." }
  }

  if (!Number.isFinite(input.countedCash) || input.countedCash < 0) {
    return { ok: false, error: "Enter the counted cash." }
  }

  const result = await closeShiftFor(
    await createClient(),
    { id: profile.id, name: profile.fullName },
    {
      shiftId: input.shiftId,
      countedCash: round2(input.countedCash),
      // Stamped so the trail says this was not closed at the counter.
      notes: input.notes ?? "Closed from the back office.",
    },
  )
  if (!result.ok) return { ok: false, error: result.error }

  revalidatePath("/point-of-sale")
  revalidatePath("/pos")
  revalidatePath("/reports")
  return { ok: true }
}

/**
 * Renames a till, or retires it.
 *
 * The name is the whole point of the registry: a device that registered itself
 * as "Google sdk_gphone64_x86_64" tells an owner nothing, and "the counter
 * till is short" is only sayable once somebody has called it the counter.
 *
 * Retiring rather than deleting. A till's shifts, and their variances, stay
 * attributable to it forever — a device that can be deleted is a variance that
 * can be made to belong to nobody.
 */
/**
 * Cash taken out of another till's drawer, from the back office.
 *
 * Carfectionist's Cash out button, on its Cash movements header. Owner or
 * manager only — at the till itself a cashier records their own pay-outs, but
 * reaching into a drawer someone else is standing at is a management act. The
 * shift must be open because a movement is a line in a drawer's ledger: it has
 * to land inside the Z of the drawer it changed, and `record_till_movement`
 * refuses to overdraw what that drawer actually holds.
 */
export async function cashOutRemotely(input: {
  shiftId: number
  amount: number
  reason: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return { ok: false, error: "Your session has expired. Sign in again." }
  }
  if (profile.role !== "owner" && profile.role !== "manager") {
    return { ok: false, error: "Only an owner or manager can take cash out from here." }
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Enter the amount taken out." }
  }

  const supabase = await createClient()

  // Confirmed open here for the error message; the RPC re-checks under lock,
  // so a close racing this loses nothing.
  const { data: shift } = await supabase
    .from("shifts")
    .select("id, closed_at")
    .eq("id", input.shiftId)
    .maybeSingle()

  if (!shift) return { ok: false, error: "That shift no longer exists." }
  if (shift.closed_at !== null) {
    return { ok: false, error: "That till has been closed — nothing can move in a closed drawer." }
  }

  const result = await recordMovementFor(
    supabase,
    input.shiftId,
    -Math.abs(input.amount),
    input.reason,
  )
  if (!result.ok) return { ok: false, error: result.error }

  revalidatePath("/point-of-sale")
  return { ok: true }
}

export async function saveDevice(input: {
  id: number
  name?: string
  isActive?: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return { ok: false, error: "Your session has expired. Sign in again." }
  }
  if (profile.role !== "owner" && profile.role !== "manager") {
    return { ok: false, error: "Only an owner or manager can change a till." }
  }

  const patch: { name?: string; is_active?: boolean } = {}

  if (input.name !== undefined) {
    const name = input.name.trim()
    if (name.length < 2) return { ok: false, error: "Give the till a name." }
    if (name.length > 60) return { ok: false, error: "That name is too long." }
    patch.name = name
  }

  if (input.isActive !== undefined) patch.is_active = input.isActive

  if (Object.keys(patch).length === 0) return { ok: true }

  const supabase = await createClient()

  // Refuse to retire a till with money in its drawer: the shift would be
  // orphaned on a device the back office has stopped listing.
  if (patch.is_active === false) {
    // The web till cannot be retired at all. The UI never offers it, but the
    // action is callable on its own, and a hidden back-office row would strand
    // every legacy shift the overview files under it.
    const { data: target } = await supabase
      .from("pos_devices")
      .select("is_back_office")
      .eq("id", input.id)
      .maybeSingle()

    if (target?.is_back_office) {
      return { ok: false, error: "The web till is the back office itself — it cannot be retired." }
    }

    const { data: open } = await supabase
      .from("shifts")
      .select("id")
      .eq("device_id", input.id)
      .is("closed_at", null)
      .limit(1)

    if (open && open.length > 0) {
      return {
        ok: false,
        error: "That till still has a shift open. Close the day on it first.",
      }
    }
  }

  const { error } = await supabase.from("pos_devices").update(patch).eq("id", input.id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/point-of-sale")
  return { ok: true }
}
