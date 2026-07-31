import { redirect } from "next/navigation"

import { getSessionProfile } from "@/lib/auth/session"
import { LOGIN_PATH, landingPathForRole } from "@/lib/routes"

/**
 * `/` is a router, not a page: owner and manager land in the back office,
 * cashiers land at the till.
 *
 * middleware.ts normally handles this before a render happens. This exists so the
 * behaviour still holds if the proxy is skipped — for example before
 * `.env.local` is filled in.
 */
export const dynamic = "force-dynamic"

export default async function RootPage() {
  const profile = await getSessionProfile()
  redirect(profile?.isActive ? landingPathForRole(profile.role) : LOGIN_PATH)
}
