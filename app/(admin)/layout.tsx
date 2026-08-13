import type { ReactNode } from "react"
import Link from "next/link"

import { AppSidebar, MobileNav } from "@/components/admin/app-sidebar"
import { GlobalSearch } from "@/components/admin/global-search"
import { LowStockPill } from "@/components/admin/low-stock-pill"
import { UserMenu } from "@/components/admin/user-menu"
import { BrandLock } from "@/components/brand/logo"
import { getAccessMap } from "@/lib/access/queries"
import { requireAdminProfile } from "@/lib/auth/session"
import { countLowStock } from "@/lib/stock/queries"

/**
 * `(admin)` layout — sidebar chrome, comfortable density, sticky header.
 *
 * `requireAdminProfile()` re-checks the role the proxy already enforced. Two
 * layers on purpose: the proxy handles redirects cheaply, this guarantees no
 * back-office page ever renders for a cashier.
 */
/**
 * Every back-office page depends on who is asking, so none of them may be
 * prerendered or cached. Declared on the layout so it covers the whole segment.
 */
export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const profile = await requireAdminProfile()

  // Hidden modules are dropped from the nav. The proxy blocks the routes too —
  // this is so nobody is shown a door they cannot open.
  const access = await getAccessMap(profile.role)
  const allowed = Object.entries(access)
    .filter(([, visible]) => visible)
    .map(([module]) => module)

  // Read in the layout so the count is right on every screen, not just the
  // dashboard. It is one indexed view read against a small table.
  const lowStockCount = await countLowStock()

  return (
    /* A fixed-height app shell rather than a page that grows: the sidebar and
       header have to stay put while the main column scrolls, and `min-h-dvh`
       let the whole thing scroll as one document instead. `print:` unwinds it
       — a clipped scroll container prints one screenful, which would quietly
       ruin the barcode label sheet. */
    <div className="flex h-dvh overflow-hidden print:h-auto print:overflow-visible">
      <AppSidebar allowed={allowed} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible">
        {/* No longer sticky: it sits outside the scrolling element now, so it
            stays by construction rather than by offset. */}
        <header className="bg-background flex h-14 shrink-0 items-center gap-3 border-b px-4 print:hidden">
          <Link href="/dashboard" className="shrink-0 lg:hidden">
            <BrandLock size="sm" />
          </Link>

          {/* Deliberately NOT wrapped in Suspense. A boundary here re-suspends
              on every route change, which unmounts the search box and drops
              focus — and a barcode scanner cannot click it to get focus back,
              so the second scan of a run goes nowhere. The usual reason for the
              boundary is useSearchParams forcing a static route to render
              dynamically, which does not apply: this segment is already
              force-dynamic (above). Left bare, the box stays mounted for the
              whole session. */}
          <GlobalSearch />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <LowStockPill count={lowStockCount} />
            <UserMenu profile={profile} />
          </div>
        </header>

        <MobileNav allowed={allowed} />

        {/* The only scrolling element. Everything else is chrome and stays. */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 print:overflow-visible">
          {children}
        </main>
      </div>
    </div>
  )
}
