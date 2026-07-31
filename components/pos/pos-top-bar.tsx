import Link from "next/link"
import { LayoutDashboard, LogOut } from "lucide-react"

import { LogoMark } from "@/components/brand/logo"
import { signOut } from "@/lib/auth/actions"
import { ROLE_LABELS, isAdminRole } from "@/lib/auth/roles"
import type { SessionProfile } from "@/lib/auth/session"

/**
 * Slim POS chrome. The till is a full-screen tool, so this strip stays minimal:
 * identity, a way back to the back office for owner/manager, and sign-out.
 * Shift state, the cashier switcher and the offline indicator live on the sell
 * screen's own toolbar, where a cashier's hands already are.
 */
export function PosTopBar({ profile }: { profile: SessionProfile }) {
  return (
    <header className="bg-card flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
      <div className="flex items-center gap-3">
        <LogoMark size="sm" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">Kids Corner till</div>
          <div className="text-muted-foreground text-xs">
            {profile.fullName} · {ROLE_LABELS[profile.role]}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isAdminRole(profile.role) ? (
          <Link
            href="/dashboard"
            className="hover:bg-muted flex h-control items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
          >
            <LayoutDashboard className="size-4" aria-hidden />
            <span className="hidden sm:inline">Back office</span>
          </Link>
        ) : null}

        <form action={signOut}>
          <button
            type="submit"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-control items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors"
          >
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </form>
      </div>
    </header>
  )
}
