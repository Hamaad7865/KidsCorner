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
 * Creating one is two writes in two different places — a row in Supabase Auth
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

const createStaffSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Their name appears on receipts and sales — enter it.")
    .max(60, "Keep the name under 60 characters."),
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Use at least 8 characters — this opens the back office.")
    .max(72, "Supabase caps passwords at 72 characters."),
  role: z.enum(["cashier", "manager", "owner"]),
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
