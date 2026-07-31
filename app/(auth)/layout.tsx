import type { ReactNode } from "react"

/**
 * `(auth)` layout — a single centred card on a soft coral wash. No app chrome:
 * there is no session yet, so there is nothing to navigate to.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="from-brand-50 relative flex min-h-dvh flex-1 flex-col items-center justify-center bg-gradient-to-b via-background to-background px-4 py-10">
      <div className="w-full max-w-sm">{children}</div>
      <p className="text-muted-foreground mt-8 text-xs">
        Kids Corner &middot; Mauritius
      </p>
    </div>
  )
}
