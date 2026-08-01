"use client"

import { useRouter } from "next/navigation"

/**
 * The two date controls the Cash flow tab is driven by.
 *
 * The current parameters arrive as props rather than through
 * `useSearchParams`. That hook forces the whole subtree into a Suspense
 * boundary or the build fails on a prerendered route — and the server component
 * above already has the values, so passing them down costs nothing and keeps
 * the page a plain server render.
 *
 * `replace` rather than `push`: a cashier stepping through a week of dates
 * should be able to leave with one Back, not seven.
 */

type Params = Record<string, string | undefined>

function hrefWith(basePath: string, params: Params, next: Params): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...params, ...next })) {
    if (value) search.set(key, value)
  }
  const query = search.toString()
  return query ? `${basePath}?${query}` : basePath
}

const FIELD =
  "border-input h-9 rounded-lg border bg-transparent px-2.5 text-sm tabular-nums outline-none focus-visible:border-brand-600"

/** Single reference date — drives the closure history. */
export function RefDatePicker({
  basePath,
  params,
  value,
}: {
  basePath: string
  params: Params
  value: string
}) {
  const router = useRouter()

  return (
    <label className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Reference date
      </span>
      <input
        type="date"
        aria-label="Reference date"
        value={value}
        onChange={(e) => router.replace(hrefWith(basePath, params, { ref: e.target.value }))}
        className={FIELD}
      />
    </label>
  )
}

/** From–to period — drives the movement tables. */
export function DateRangeFilter({
  basePath,
  params,
  from,
  to,
}: {
  basePath: string
  params: Params
  from: string
  to: string
}) {
  const router = useRouter()
  const go = (next: Params) => router.replace(hrefWith(basePath, params, next))

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        aria-label="From date"
        value={from}
        max={to || undefined}
        onChange={(e) => go({ from: e.target.value })}
        className={FIELD}
      />
      <span className="text-muted-foreground text-sm" aria-hidden>
        →
      </span>
      <input
        type="date"
        aria-label="To date"
        value={to}
        min={from || undefined}
        onChange={(e) => go({ to: e.target.value })}
        className={FIELD}
      />
    </div>
  )
}
