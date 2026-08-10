"use server"

import { revalidatePath } from "next/cache"

import { canManageCatalog } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { isRole } from "@/lib/db-enums"
import {
  boolOf,
  formFail as fail,
  formOk,
  idOf,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createClient } from "@/lib/supabase/server"

import { MODULES } from "./modules"

/**
 * Module visibility and stock locations.
 *
 * Module access is owner-only, matching its RLS. Worth restating: this controls
 * what a role is SHOWN, never what the database will let it do.
 */

export async function setModuleAccess(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (profile.role !== "owner") {
    return fail("Only the owner can change module access.")
  }

  const role = textOf(formData, "role")
  const moduleKey = textOf(formData, "module")
  const canView = boolOf(formData, "canView")

  if (!isRole(role)) return fail("Unknown role.")
  if (!(MODULES as readonly string[]).includes(moduleKey)) {
    return fail("Unknown module.")
  }
  if (moduleKey === "pos" && !canView) {
    // The database trigger refuses this too; catching it here gives a sentence
    // instead of a raised exception.
    return fail("The till can't be hidden — a role needs somewhere to land.")
  }
  if (role === "owner" && !canView) {
    // Same bargain as the till, and for a stronger reason: the owner is the
    // only role that can undo this, so every module they hide is one they may
    // not be able to get back. Migration 041 refuses it outright.
    return fail("The owner sees every module — that one can't be hidden.")
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("module_access")
    .upsert(
      { role, module: moduleKey, can_view: canView },
      { onConflict: "role,module" },
    )

  if (error) return fail(error.message)

  revalidatePath("/settings")
  // The nav is rendered in the admin layout, so every back-office page changes.
  revalidatePath("/", "layout")
  return formOk("Access updated.")
}

// ------------------------------------------------------------- locations

export async function saveLocation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can change locations.")
  }

  const id = idOf(formData, "id")
  const name = textOf(formData, "name").trim()
  if (!name) return fail(null, { name: "Give the location a name." })
  if (name.length > 60) return fail(null, { name: "Keep the name under 60 characters." })

  const supabase = await createClient()
  const values = { name, is_active: boolOf(formData, "isActive") }

  const { data, error } =
    id === null
      ? await supabase.from("stock_locations").insert(values).select("id")
      : await supabase.from("stock_locations").update(values).eq("id", id).select("id")

  if (error) {
    if (error.code === "23505") {
      return fail(null, { name: "A location with that name already exists." })
    }
    return fail(error.message)
  }
  if (data.length === 0) return fail("That location no longer exists.")

  revalidatePath("/settings")
  revalidatePath("/stock")
  return formOk("Location saved.")
}

/**
 * Moves the default flag. Two statements, because the unique partial index
 * allows only one default — clearing first is what makes the set succeed.
 */
export async function setDefaultLocation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return fail("Your session has expired.")
  if (!canManageCatalog(profile.role)) {
    return fail("Only an owner or manager can change locations.")
  }

  const id = idOf(formData, "id")
  if (id === null) return fail("Couldn't tell which location to default to.")

  const supabase = await createClient()

  const { error: clearError } = await supabase
    .from("stock_locations")
    .update({ is_default: false })
    .eq("is_default", true)
  if (clearError) return fail(clearError.message)

  const { data, error } = await supabase
    .from("stock_locations")
    .update({ is_default: true })
    .eq("id", id)
    .select("id")

  if (error) return fail(error.message)
  if (data.length === 0) {
    // The clear above already ran, so say so rather than leaving the shop with
    // no default at all and no explanation.
    return fail(
      "That location no longer exists, and the previous default was cleared. Pick one.",
    )
  }

  revalidatePath("/settings")
  revalidatePath("/stock")
  return formOk("Default location updated.")
}
