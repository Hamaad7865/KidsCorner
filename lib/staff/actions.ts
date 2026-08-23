"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { logAudit } from "@/lib/activity/audit"
import { getSessionProfile } from "@/lib/auth/session"
import { isServiceRoleConfigured } from "@/lib/env"
import {
  fieldErrorsOf,
  formFail,
  formOk,
  textOf,
  type FormState,
} from "@/lib/forms"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/**
 * Staff logins: who can sign in to the back office or a till device.
 *
 * Each one is two writes in two different places — a row in Supabase Auth
 * (the credential), and a row in `profiles` (the role and the name the shop
 * knows them by). The first needs the service-role key, because the admin API
 * is the only door to `auth.users`; the second goes through this owner's own
 * session so RLS still polices it. Neither write exists in any migration
 * trigger, so before this panel an owner had to open the Supabase dashboard
 * by hand — with the production keys — to give anybody access.
 */

export type StaffLogin = {
  id: string
  fullName: string
  /** Null when the service key is not configured (emails live in auth). */
  email: string | null
  role: string
  isActive: boolean
}

/**
 * Every staff profile, including deactivated ones, for the Settings panel.
 *
 * Owner-only: managers run the shop but do not hand out its doors. Emails ride
 * along only when the admin API is reachable — they live on the auth user, not
 * the profile — and their absence degrades to a list without addresses rather
 * than a broken screen.
 */
export async function listStaffLogins(): Promise<{
  staff: StaffLogin[]
  canCreate: boolean
}> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive || profile.role !== "owner") {
    return { staff: [], canCreate: false }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, is_active")
    .order("full_name")

  if (error) return { staff: [], canCreate: isServiceRoleConfigured }

  const emails = new Map<string, string>()
  if (isServiceRoleConfigured) {
    // Best-effort. A rate limit or a rotated key costs the column, not the page.
    try {
      const { data: users, error: usersError } =
        await createAdminClient().auth.admin.listUsers({ perPage: 500 })
      if (!usersError) {
        for (const user of users?.users ?? []) {
          if (user.email) emails.set(user.id, user.email)
        }
      }
    } catch {
      // Left empty on purpose; the panel renders without addresses.
    }
  }

  return {
    staff: (data ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: emails.get(row.id) ?? null,
      role: row.role,
      isActive: row.is_active,
    })),
    canCreate: isServiceRoleConfigured,
  }
}

const staffNameSchema = z
  .string()
  .trim()
  .min(1, "Their name appears on receipts and sales — enter it.")
  .max(60, "Keep the name under 60 characters.")
const staffRoleSchema = z.enum(["cashier", "manager", "owner"])

const createStaffSchema = z.object({
  fullName: staffNameSchema,
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Use at least 8 characters — this opens the back office.")
    .max(72, "Supabase caps passwords at 72 characters."),
  role: staffRoleSchema,
})

export type CreateStaffInput = z.input<typeof createStaffSchema>

/**
 * Creates a login: an auth user with a password, plus the profile that gives
 * it a name and a role.
 *
 * Owner-only, like every other key-distribution act in the shop. If the
 * profile half fails after the auth user was created, the auth user is deleted
 * again rather than left as a credential nobody's name is attached to — an
 * orphan login signs in as nobody and shows nowhere, which is the worst kind
 * of account to audit later.
 */
export async function createStaffLogin(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return formFail("Your session has expired.")
  if (profile.role !== "owner") {
    return formFail("Only the owner can create logins.")
  }
  if (!isServiceRoleConfigured) {
    return formFail(
      "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment, so logins cannot be created here.",
    )
  }

  const parsed = createStaffSchema.safeParse({
    fullName: textOf(formData, "fullName"),
    email: textOf(formData, "email"),
    password: textOf(formData, "password"),
    role: textOf(formData, "role"),
  })
  if (!parsed.success) return formFail(null, fieldErrorsOf(parsed.error))

  const { fullName, email, password, role } = parsed.data
  const admin = createAdminClient()

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (authError || !created?.user) {
    // "already registered" is the everyday case — say what to do, not what
    // Supabase said.
    const message = /already|exists|duplicate/i.test(authError?.message ?? "")
      ? `${email} already has a login. Reset its password in Supabase Auth instead.`
      : (authError?.message ?? "Could not create the login.")
    return formFail(message)
  }

  const user = created.user
  const supabase = await createClient()
  const { error: profileError } = await supabase.from("profiles").insert({
    id: user.id,
    full_name: fullName,
    role,
    is_active: true,
  })

  if (profileError) {
    await admin.auth.admin
      .deleteUser(user.id)
      .then(() => undefined, () => undefined)

    return formFail(
      `The sign-in was created but the staff record failed (${profileError.message}) and was rolled back. Try again.`,
    )
  }

  await logAudit(supabase, {
    type: "staff.login_created",
    refType: "profile",
    refId: user.id,
    summary: `${fullName} added as ${role} with a ${email} login`,
    detail: { email, role, created_by: profile.id },
  })

  revalidatePath("/settings")
  return formOk(`${fullName} can now sign in.`)
}

/**
 * Flips a staff member between active and inactive.
 *
 * Deactivating keeps every past sale, PIN hash and audit line exactly where it
 * was — it only closes the doors. Refusing self-deactivation is not paranoia:
 * the owner is how every other lock gets undone.
 */
export async function setStaffActive(
  targetId: string,
  next: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return { ok: false, error: "Your session has expired." }
  }
  if (profile.role !== "owner") {
    return { ok: false, error: "Only the owner can change who has access." }
  }
  if (targetId === profile.id && !next) {
    return { ok: false, error: "You cannot deactivate your own login." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: next })
    .eq("id", targetId)

  if (error) return { ok: false, error: error.message }

  await logAudit(supabase, {
    type: "staff.login_active_changed",
    refType: "profile",
    refId: targetId,
    summary: next ? "Access switched back on" : "Access switched off",
    detail: { active: next, changed_by: profile.id },
  })

  revalidatePath("/settings")
  return { ok: true }
}

const updateStaffSchema = z.object({
  fullName: staffNameSchema,
  email: z.email("Enter a valid email address."),
  role: staffRoleSchema,
  // Blank means "keep the current password". Only Supabase's own cap applies
  // to the blank case, hence the union rather than a bare min().
  password: z.union([
    z.literal(""),
    z
      .string()
      .min(8, "Use at least 8 characters — this opens the back office.")
      .max(72, "Supabase caps passwords at 72 characters."),
  ]),
})

/**
 * Edits a login: name and role on the profile, email and (optionally) password
 * on the auth user.
 *
 * The auth half runs FIRST so a refused email — already taken, service key
 * missing — leaves the profile exactly as it was, rather than renaming
 * somebody whose address change then failed. A role edit is refused for the
 * acting owner themselves: with self-deactivation already blocked this is the
 * remaining way to end up with zero owners, and an owner demoted by their own
 * hand has nobody left to undo it.
 */
export async function updateStaffLogin(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) return formFail("Your session has expired.")
  if (profile.role !== "owner") {
    return formFail("Only the owner can edit logins.")
  }

  const parsed = updateStaffSchema.safeParse({
    fullName: textOf(formData, "fullName"),
    email: textOf(formData, "email"),
    role: textOf(formData, "role"),
    password: textOf(formData, "password"),
  })
  if (!parsed.success) return formFail(null, fieldErrorsOf(parsed.error))

  const { fullName, email, role } = parsed.data
  const password = parsed.data.password
  const profileId = textOf(formData, "profileId")
  const originalEmail = textOf(formData, "originalEmail")

  const supabase = await createClient()
  const { data: target } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", profileId)
    .maybeSingle()
  if (!target) return formFail("That staff member could not be found.")
  if (profileId === profile.id && role !== target.role) {
    return formFail("You cannot change your own role — have another owner do it.")
  }

  const emailChanged = email.toLowerCase() !== originalEmail.trim().toLowerCase()
  const needsAuth = Boolean(password) || emailChanged

  if (needsAuth) {
    if (!isServiceRoleConfigured) {
      return formFail(
        "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment, so emails and passwords cannot be changed here. Name and role still can.",
      )
    }
    const admin = createAdminClient()
    const { error: authError } = await admin.auth.admin.updateUserById(
      profileId,
      {
        ...(emailChanged ? { email, email_confirm: true } : {}),
        ...(password ? { password } : {}),
      },
    )
    if (authError) {
      const message = /already|exists|duplicate/i.test(authError.message)
        ? `${email} already belongs to another login.`
        : authError.message
      return formFail(message)
    }
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, role })
    .eq("id", profileId)
    .select("id")

  if (error) return formFail(error.message)
  if (!data || data.length === 0) {
    return formFail("That staff member could not be updated — check you are the owner.")
  }

  await logAudit(supabase, {
    type: "staff.login_updated",
    refType: "profile",
    refId: profileId,
    summary:
      role !== target.role
        ? `${fullName} is now ${role}`
        : `${fullName}'s login was updated`,
    detail: {
      name_changed: fullName !== target.full_name,
      role_changed: role !== target.role,
      email_changed: emailChanged,
      password_reset: Boolean(password),
      changed_by: profile.id,
    },
  })

  revalidatePath("/settings")
  return formOk("Login updated.")
}

/**
 * Removes a login outright: the auth user first, whose deletion cascades to
 * the profile row.
 *
 * Deletion is only possible while nobody else points at the person. The first
 * sale they ring up creates `sales.cashier_id` → `profiles` references that no
 * `ON DELETE` action will break — deliberately, history must keep who rang it.
 * So the everyday exit stays the active toggle, and this fails with that
 * suggestion when the references are already there.
 */
export async function deleteStaffLogin(
  targetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive) {
    return { ok: false, error: "Your session has expired." }
  }
  if (profile.role !== "owner") {
    return { ok: false, error: "Only the owner can remove logins." }
  }
  if (targetId === profile.id) {
    return { ok: false, error: "You cannot delete your own login." }
  }

  const supabase = await createClient()
  const { data: target } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", targetId)
    .maybeSingle()

  let authDeleted = false
  if (isServiceRoleConfigured) {
    const { error } = await createAdminClient().auth.admin.deleteUser(targetId)
    if (!error) {
      authDeleted = true
    } else if (!/not found/i.test(error.message)) {
      // Includes the FK refusal: Postgres names the constraint that held on.
      return { ok: false, error: deleteRefusal(error.message) }
    }
    // "not found" means there was never an auth user behind this profile —
    // seeded by hand in an emergency, perhaps. The profile row is still ours
    // to remove below.
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .delete()
    .eq("id", targetId)

  if (profileError) return { ok: false, error: deleteRefusal(profileError.message) }
  if (!authDeleted && !isServiceRoleConfigured) {
    // The sign-in itself survives in Supabase Auth, but with the profile gone
    // `signIn` refuses it — dead credential, not a live door. Say so rather
    // than let the row's disappearance imply more than happened.
    await logAudit(supabase, {
      type: "staff.login_deleted",
      refType: "profile",
      refId: targetId,
      summary: `${target?.full_name ?? "Staff member"} removed from staff`,
      detail: {
        auth_user_deleted: false,
        deleted_by: profile.id,
      },
    })
    revalidatePath("/settings")
    return { ok: true }
  }

  await logAudit(supabase, {
    type: "staff.login_deleted",
    refType: "profile",
    refId: targetId,
    summary: `${target?.full_name ?? "Staff member"} removed from staff`,
    detail: { auth_user_deleted: authDeleted, deleted_by: profile.id },
  })
  revalidatePath("/settings")
  return { ok: true }
}

/**
 * Turns a raw Postgres/admin refusal into something an owner can act on.
 *
 * FK violations are the expected shape here; every other message passes
 * through as-is, because guessing wrong about an unknown failure helps nobody.
 */
function deleteRefusal(message: string): string {
  if (/foreign key|fkey|duplicate key/i.test(message)) {
    return (
      "This person still has records tied to them — sales rung, shifts opened, audits written — " +
      "so the account cannot be deleted without rewriting history. Switch them off instead; " +
      "that keeps everything intact."
    )
  }
  return message
}
