"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { isRole } from "@/lib/db-enums"
import { isSupabaseConfigured } from "@/lib/env"
import { LOGIN_PATH, landingPathForRole, safeRedirectPath } from "@/lib/routes"
import { createClient } from "@/lib/supabase/server"

const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
})

export type SignInState = {
  error: string | null
  fieldErrors: Partial<Record<"email" | "password", string>>
}

/**
 * Email/password sign-in for the device or user (owner, manager, or a shared
 * till account). Cashier identity on the POS is a separate PIN layer on top of
 * whatever session this establishes.
 */
export async function signIn(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  if (!isSupabaseConfigured) {
    return {
      error: "Supabase is not configured yet. Add your credentials to .env.local and restart the dev server.",
      fieldErrors: {},
    }
  }

  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  })

  if (!parsed.success) {
    const fieldErrors: SignInState["fieldErrors"] = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if (field === "email" || field === "password") {
        fieldErrors[field] ??= issue.message
      }
    }
    return { error: null, fieldErrors }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error || !data.user) {
    // Deliberately vague on bad credentials so the form can't be used to probe
    // which email addresses exist.
    const message =
      error?.code === "email_not_confirmed"
        ? "That email address hasn't been confirmed yet."
        : error?.code === "over_request_rate_limit" || error?.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "Wrong email or password."
    return { error: message, fieldErrors: {} }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", data.user.id)
    .maybeSingle()

  if (!profile || !isRole(profile.role)) {
    await supabase.auth.signOut()
    return {
      error:
        "This account has no staff profile yet. Ask the owner to add a row in `profiles` with a role of owner, manager or cashier.",
      fieldErrors: {},
    }
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    return { error: "This account has been deactivated.", fieldErrors: {} }
  }

  const destination =
    safeRedirectPath(parsed.data.next ?? null) ?? landingPathForRole(profile.role)

  revalidatePath("/", "layout")
  // redirect() throws NEXT_REDIRECT, so it must stay outside any try/catch.
  redirect(destination)
}

export async function signOut() {
  if (isSupabaseConfigured) {
    const supabase = await createClient()
    await supabase.auth.signOut()
  }
  revalidatePath("/", "layout")
  redirect(LOGIN_PATH)
}
