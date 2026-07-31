"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"

/**
 * The header search box.
 *
 * A plain form that navigates to /search rather than a live-filtering popover:
 * a barcode scanner types the whole code and presses Enter, which submits this
 * exactly as a person would, and the result is a real URL somebody can keep on
 * a second tab while they work.
 *
 * Controlled, and synced to the URL by effect rather than by a `key`. Keying the
 * input on the query remounts it after every search, which drops focus — and a
 * scanner cannot click the box to get it back, so the second scan of a run would
 * go nowhere. This is the one screen where that matters most.
 *
 * The form also carries a real `action`, so it still searches before hydration.
 *
 * Ctrl/Cmd-K focuses it, since this side of the shop is keyboard-driven.
 */
export function GlobalSearch() {
  const router = useRouter()
  const params = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const query = params.get("q") ?? ""
  const [value, setValue] = useState(query)
  const [syncedTo, setSyncedTo] = useState(query)

  // Follows the URL when it changes under us — a back button, or a result page
  // opened from a link. Adjusted during render rather than in an effect: React
  // re-runs this component immediately without committing the first pass, so
  // there is no flash of the stale term and no cascading render. Crucially it
  // also does not remount the input, which is what a `key` would do — and a
  // remount drops focus, which a barcode scanner cannot get back.
  if (query !== syncedTo) {
    setSyncedTo(query)
    setValue(query)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <form
      role="search"
      // A genuine GET to /search, so the box works from the server-rendered HTML
      // before React has hydrated. The handler below takes over once it has, to
      // get a client-side navigation instead of a full page load.
      action="/search"
      method="get"
      onSubmit={(event) => {
        const term = value.trim()
        // One or two characters matches most of the catalogue and helps nobody.
        // Prevented rather than submitted, so a stray Enter does not reload.
        if (term.length < 2) {
          event.preventDefault()
          return
        }
        event.preventDefault()
        router.push(`/search?q=${encodeURIComponent(term)}`)
      }}
      className="relative flex w-full max-w-md items-center"
    >
      <Search
        className="text-muted-foreground pointer-events-none absolute left-3 size-4"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search products, barcodes, suppliers…"
        aria-label="Search the back office"
        className="border-input bg-muted/50 focus:bg-background focus:border-ring focus:ring-ring/25 h-9 w-full rounded-lg border pr-16 pl-9 text-sm outline-none focus:ring-2"
      />
      {/* Says the scanner works here too — the most useful thing to know about
          this box, and invisible otherwise. */}
      <span className="text-muted-foreground bg-muted pointer-events-none absolute right-2 hidden rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium sm:block">
        SCAN
      </span>
    </form>
  )
}
