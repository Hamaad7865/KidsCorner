import type { Viewport } from "next"
import type { ReactNode } from "react"

import { PosTopBar } from "@/components/pos/pos-top-bar"
import { TillLock } from "@/components/pos/till-lock"
import { RouteGate } from "@/components/route-gate"
import { requireProfile } from "@/lib/auth/session"
import { listCashiers } from "@/lib/pos/actions"

/**
 * `(pos)` layout — fullscreen, no sidebar, sized for a landscape tablet
 * (1280x800 first).
 *
 * `data-density="pos"` flips the shared `--density-*` tokens to the touch
 * scale. Components opt in through the utilities those tokens back —
 * `h-control` (48px here, 36px in admin), `h-tap`, `text-density` — so there
 * is one design system with two densities rather than two systems.
 *
 * Every role may be here, including cashiers: the till is the one screen the
 * whole shop shares.
 */
/** Session-dependent: never prerender or cache a till screen. */
export const dynamic = "force-dynamic"

/**
 * Zoom is locked on the till only. A pinch mid-sale is a mis-tap waiting to
 * happen, but the same restriction on the back office would fail WCAG 1.4.4,
 * so it is scoped to this route group rather than set in the root layout.
 */
export const viewport: Viewport = {
  maximumScale: 1,
}

export default async function PosLayout({ children }: { children: ReactNode }) {
  const profile = await requireProfile()
  const cashiers = await listCashiers()

  return (
    <div
      data-density="pos"
      className="bg-muted/40 flex h-dvh flex-1 flex-col overflow-hidden"
    >
      {/* The receipt is a standalone document opened from the back office. It
          lives under `(pos)` only for its URL and must not wear the till top
          bar or sit behind the cashier lock, so both are gated off it. */}
      <RouteGate hideOnPrefix="/pos/receipt/">
        <PosTopBar profile={profile} />
      </RouteGate>
      {/* A flex column, not a plain block. The sell screen needs to fill this
          pane, and asking a percentage height to do it does not work here: the
          pane's own height comes from `flex-1`, and a child's `height: 100%`
          against a flex-resolved parent falls back to content height — which
          left the cart card ending mid-screen. Stretching the child with flex
          sidesteps the percentage entirely. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>

      {/* Sits over the whole till, including the top bar, so a locked screen
          offers nothing to press but the keypad. Rendered last rather than
          around `children` so the sell screen keeps its state while locked —
          a cart part-way through a sale survives a re-lock. */}
      <RouteGate hideOnPrefix="/pos/receipt/">
        <TillLock cashiers={cashiers} />
      </RouteGate>
    </div>
  )
}
