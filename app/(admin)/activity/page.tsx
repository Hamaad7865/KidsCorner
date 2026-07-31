import type { Metadata } from "next"
import Link from "next/link"
import {
  AlertTriangle,
  Banknote,
  Circle,
  Package,
  ReceiptText,
  ShieldCheck,
  Tag,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { requireAdminProfile } from "@/lib/auth/session"
import { formatDateTime, formatRs, shopToday } from "@/lib/format"
import {
  ACTIVITY_CATEGORIES,
  getActivity,
  type ActivityTone,
} from "@/lib/activity/queries"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Activity" }

const TONE: Record<ActivityTone, { icon: LucideIcon; className: string }> = {
  sale: { icon: ReceiptText, className: "bg-accent text-accent-foreground" },
  money: { icon: Tag, className: "bg-warning-muted text-warning-foreground" },
  stock: { icon: Package, className: "bg-muted text-muted-foreground" },
  cash: { icon: Banknote, className: "bg-success-muted text-success" },
  admin: { icon: ShieldCheck, className: "bg-muted text-muted-foreground" },
  warn: { icon: AlertTriangle, className: "bg-destructive/10 text-destructive" },
  neutral: { icon: Circle, className: "bg-muted text-muted-foreground" },
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function isoDate(v: string | undefined): string | undefined {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
}

/** The last 7 shop-days. A shorter default than the reports page on purpose:
 *  this is a "what just happened" screen, not an analysis one. */
function defaultRange(): { from: string; to: string } {
  const to = shopToday()
  const from = new Date(Date.parse(`${to}T12:00:00Z`) - 6 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  return { from, to }
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()

  const params = await searchParams
  const fallback = defaultRange()
  const from = isoDate(first(params.from)) ?? fallback.from
  const to = isoDate(first(params.to)) ?? fallback.to
  const category = ACTIVITY_CATEGORIES.find((c) => c.key === first(params.cat))?.key

  const { events, capped } = await getActivity({ from, to, category })

  const link = (cat?: string) =>
    `/activity?from=${from}&to=${to}${cat ? `&cat=${cat}` : ""}`

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Activity</h1>
        <p className="text-muted-foreground text-sm">
          Who did what, built from the shop&rsquo;s own records — not a separate log.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3">
        {category ? <input type="hidden" name="cat" value={category} /> : null}
        <div className="space-y-2">
          <label htmlFor="from" className="text-sm font-medium">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="border-input block h-9 rounded-lg border bg-transparent px-3 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="to" className="text-sm font-medium">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="border-input block h-9 rounded-lg border bg-transparent px-3 text-sm"
          />
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      <div className="flex flex-wrap gap-1 border-b">
        <Link
          href={link()}
          aria-current={category === undefined ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            category === undefined
              ? "border-brand-600 text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          Everything
        </Link>
        {ACTIVITY_CATEGORIES.map((c) => (
          <Link
            key={c.key}
            href={link(c.key)}
            aria-current={category === c.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              category === c.key
                ? "border-brand-600 text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {c.label}
          </Link>
        ))}
      </div>

      {capped ? (
        <p className="text-muted-foreground text-sm">
          Showing the most recent {events.length}. Narrow the dates to see more.
        </p>
      ) : null}

      {events.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          Nothing happened in this range.
        </p>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => {
            const tone = TONE[event.tone]
            const Icon = tone.icon
            const body = (
              <div className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    tone.className,
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{event.title}</span>
                    <span className="text-muted-foreground truncate text-sm">
                      {event.detail}
                    </span>
                  </div>
                  <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                    <span>{formatDateTime(event.at)}</span>
                    <span aria-hidden>·</span>
                    <span>{event.actorName}</span>
                  </div>
                </div>
                {event.amount !== null ? (
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatRs(event.amount)}
                  </span>
                ) : null}
              </div>
            )

            return (
              <li key={event.id}>
                {event.href ? (
                  <Link href={event.href} className="block">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            )
          })}
        </ol>
      )}

      <p className="text-muted-foreground text-xs">
        Price changes, PINs, roles and settings are recorded by database triggers,
        so a change made outside this app still appears here.{" "}
        <Badge variant="outline">Append-only</Badge> — the trail has no update or
        delete policy, so nobody can edit it after the fact.
      </p>
    </div>
  )
}
