"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"

/**
 * Renders its children everywhere EXCEPT under a path prefix.
 *
 * The till chrome — the top bar and the cashier lock — belongs on the working
 * till, not on the 80mm receipt the back office opens in a new tab. That
 * receipt lives inside the `(pos)` route group so it can keep its `/pos/receipt`
 * URL, and without this it inherited the group's layout and rendered underneath
 * the full-screen "Who is on the till?" lock.
 *
 * The top bar is a server component; handed in as `children` it renders on the
 * server as normal, and this client gate simply decides whether to include it —
 * which is the one thing a server layout cannot do, having no pathname.
 */
export function RouteGate({
  hideOnPrefix,
  children,
}: {
  hideOnPrefix: string
  children: ReactNode
}) {
  const pathname = usePathname()
  if (pathname?.startsWith(hideOnPrefix)) return null
  return <>{children}</>
}
