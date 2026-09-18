"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"

/**
 * Whether a click starts an App Router transition worth showing the bar for.
 *
 * Pure — no DOM, no router — so the matrix below is unit-tested, not
 * eyeballed. A new tab, a download, an external address and a same-document
 * jump (hash, or re-clicking the active module) all resolve without a page
 * transition, so none of them may start a bar that nothing will finish.
 */
export function startsTransition(
  href: string | null,
  current: string,
  modified: boolean,
): boolean {
  if (!href || modified) return false
  if (!href.startsWith("/") || href.startsWith("//")) return false
  let target: URL
  let here: URL
  try {
    target = new URL(href, "http://x")
    here = new URL(current, "http://x")
  } catch {
    return false
  }
  return target.pathname !== here.pathname || target.search !== here.search
}

/** Long enough for the slowest report on a bad connection; the bar finishing
 *  on the URL change is the normal exit, this only unsticks it. */
const STICK_GUARD_MS = 8_000
/** Covers the 100% snap plus the fade that follows it. */
const PARK_MS = 550

type Phase = "idle" | "running" | "done"

/**
 * The thin brand line under the viewport's top edge while a module loads.
 *
 * Back-office pages are server-rendered per click, and on a slow connection
 * the old screen sits unchanged for seconds with nothing saying the click
 * landed. The bar starts on any link that resolves to a new URL and finishes
 * when that URL arrives — the arrival, not a timer, is what completes it, so
 * it cannot flash-done while the page is still loading.
 *
 * Fixed-positioned and pointer-transparent, so it rides above the header,
 * the sidebar and open dialogs without moving any of them, and hidden on
 * paper so a label sheet never carries a stray red hairline.
 */
export function NavigationProgress() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [phase, setPhase] = useState<Phase>("idle")
  const guard = useRef<number | null>(null)
  const first = useRef(true)
  // The last URL the bar watched land. Compared against raw location reads,
  // which update before React re-renders — that ordering gap is exactly what
  // lets a back-button press start the bar without a click.
  const landed = useRef("")

  const key = `${pathname}?${searchParams.toString()}`

  // A new URL means the transition landed: snap to full, fade, park.
  // Skipped on mount, and inert when nothing is running (a server-action
  // redirect lands a URL with no bar to finish).
  useEffect(() => {
    landed.current = key
    if (first.current) {
      first.current = false
      return
    }
    setPhase((previous) => (previous === "running" ? "done" : previous))
    const park = window.setTimeout(() => setPhase("idle"), PARK_MS)
    return () => window.clearTimeout(park)
  }, [key])

  useEffect(() => {
    const clearGuard = () => {
      if (guard.current !== null) {
        window.clearTimeout(guard.current)
        guard.current = null
      }
    }
    const start = () => {
      setPhase("running")
      clearGuard()
      guard.current = window.setTimeout(() => setPhase("idle"), STICK_GUARD_MS)
    }
    const onClick = (event: MouseEvent) => {
      const anchor =
        event.target instanceof HTMLElement ? event.target.closest("a[href]") : null
      if (!anchor) return
      if (anchor.getAttribute("target") === "_blank" || anchor.hasAttribute("download")) {
        return
      }
      const modified =
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
      if (
        startsTransition(
          anchor.getAttribute("href"),
          window.location.pathname + window.location.search,
          modified,
        )
      ) {
        start()
      }
    }
    // Back and forward buttons transition with no click. The location has
    // already moved when this fires; a same-document jump is ignored.
    const onPopState = () => {
      if (window.location.pathname + window.location.search !== landed.current) start()
    }
    document.addEventListener("click", onClick)
    window.addEventListener("popstate", onPopState)
    return () => {
      document.removeEventListener("click", onClick)
      window.removeEventListener("popstate", onPopState)
      clearGuard()
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] print:hidden"
    >
      <div
        className="bg-brand-600 h-full"
        style={{
          width: phase === "idle" ? "0%" : phase === "running" ? "82%" : "100%",
          opacity: phase === "idle" ? 0 : 1,
          transition:
            phase === "done"
              ? "width 180ms ease-out, opacity 350ms ease-in 120ms"
              : "width 1.6s cubic-bezier(0.05, 0.4, 0.2, 1), opacity 200ms ease-out",
        }}
      />
    </div>
  )
}
