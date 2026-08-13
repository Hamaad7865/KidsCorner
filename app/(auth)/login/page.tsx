import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { BrandLock } from "@/components/brand/logo"
import { SetupNotice } from "@/components/setup-notice"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { signOut } from "@/lib/auth/actions"
import { isAdminRole } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { isSupabaseConfigured } from "@/lib/env"
import { landingPathForRole, safeRedirectPath } from "@/lib/routes"

import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: "Sign in",
}

/** Reads the session to bounce anyone already signed in — must stay per-request. */
export const dynamic = "force-dynamic"

/** Reasons the proxy can bounce someone back here. */
const REDIRECT_REASONS: Record<string, string> = {
  no_profile:
    "That account is signed in but has no staff profile. Ask the owner to add it under Settings → Users.",
  inactive: "That account has been deactivated. Ask the owner to re-enable it.",
  forbidden: "You don't have access to the back office.",
  till_moved: "The till runs on the tablet now. Sign in there to serve customers.",
}

export default async function LoginPage({
  searchParams,
}: {
  // Repeated query keys ("?next=/a&next=/b") arrive as arrays, so the honest
  // type is the union. `safeRedirectPath` takes `unknown` and rejects non-strings.
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>
}) {
  const { next, error } = await searchParams
  const redirectTo = safeRedirectPath(next)

  // Already signed in with a usable profile? Skip the form. Only the back-office
  // roles have a home to go to — a cashier is signed in but the till they used
  // is on the tablet, so they get a terminal notice here rather than a bounce
  // that would loop back to this page.
  const profile = await getSessionProfile()
  if (profile?.isActive) {
    if (isAdminRole(profile.role)) {
      redirect(redirectTo ?? landingPathForRole(profile.role))
    }
    return <TillMovedNotice />
  }

  const reason = typeof error === "string" ? REDIRECT_REASONS[error] : undefined

  return (
    <div className="space-y-6">
      <BrandLock size="lg" subtitle="Point of sale & back office" />

      {isSupabaseConfigured ? null : <SetupNotice />}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            Use the shop account for this device. Cashiers switch by PIN once
            the till is open.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reason ? (
            <p className="bg-warning-muted text-foreground/80 rounded-md px-3 py-2 text-sm">
              {reason}
            </p>
          ) : null}
          <LoginForm next={redirectTo ?? undefined} disabled={!isSupabaseConfigured} />
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Shown to a cashier who reaches the web app. Selling moved to the tablet till,
 * so there is nothing for them here — a plain explanation and a way to sign out,
 * rather than a redirect that would bounce straight back to this page.
 */
function TillMovedNotice() {
  return (
    <div className="space-y-6">
      <BrandLock size="lg" subtitle="Back office" />
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">The till is on the tablet</CardTitle>
          <CardDescription>
            You&rsquo;re signed in as a cashier. Sales are rung up on the tablet
            till now — sign in there by PIN. The web app is for the owner and
            managers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signOut}>
            <Button type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
