"use client"

import { useState } from "react"

import { formatDate, formatRs } from "@/lib/format"

type Daily = { date: string; total: number }
type Weekly = { start: string; end: string; total: number }

/**
 * The dashboard's bar chart — `grid-template-columns:repeat(7,1fr); gap:12px`
 * over a 132px track, each bar `radius:5px 5px 2px 2px`.
 *
 * No charting dependency for seven bars. The design draws a Week/Month toggle
 * as two static spans; here it switches between the last seven days and the
 * last five weeks, because a control that does nothing is a bug in a real app
 * even when it is fine in a mock.
 */
export function SalesChart({
  daily,
  weekly,
  weekTotal,
}: {
  daily: Daily[]
  weekly: Weekly[]
  weekTotal: number
}) {
  const [view, setView] = useState<"week" | "month">("week")

  const bars =
    view === "week"
      ? daily.map((d, i) => ({
          key: d.date,
          total: d.total,
          label: i === daily.length - 1 ? "Today" : weekdayOf(d.date),
          title: `${formatDate(d.date)}: ${formatRs(d.total)}`,
          accent: i === daily.length - 1,
        }))
      : weekly.map((w, i) => ({
          key: w.start,
          total: w.total,
          label:
            i === weekly.length - 1 ? "This week" : `${dayOfMonth(w.start)}–${dayOfMonth(w.end)}`,
          title: `${formatDate(w.start)} – ${formatDate(w.end)}: ${formatRs(w.total)}`,
          accent: i === weekly.length - 1,
        }))

  // Against the tallest bar in the view being shown, not across both: a month
  // of weekly totals dwarfs a day, and scaling them together would flatten
  // every daily bar to nothing the moment someone pressed Month.
  const peak = Math.max(1, ...bars.map((b) => b.total))
  const total = view === "week" ? weekTotal : weekly.reduce((s, w) => s + w.total, 0)
  const range =
    view === "week"
      ? `${formatDate(daily[0]?.date)} – ${formatDate(daily[daily.length - 1]?.date)}`
      : `${formatDate(weekly[0]?.start)} – ${formatDate(weekly[weekly.length - 1]?.end)}`

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-sm font-semibold">
            {view === "week" ? "Sales this week" : "Sales this month"}
          </h2>
          <p className="text-muted-foreground text-xs">
            {range} · total {formatRs(total)}
          </p>
        </div>

        {/* `background:#F1F5F5; radius:7px; padding:2px` with the selected pill
            raised on white — the design's own segmented control. */}
        <div className="bg-muted flex shrink-0 gap-0.5 rounded-md p-0.5">
          {(["week", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={
                view === option
                  ? "bg-background rounded-sm px-2.5 py-1 text-[11px] font-semibold shadow-sm"
                  : "text-muted-foreground rounded-sm px-2.5 py-1 text-[11px] font-semibold"
              }
            >
              {option === "week" ? "Week" : "Month"}
            </button>
          ))}
        </div>
      </div>

      {/* Note the absence of `items-end`. It reads like the right thing for a
          bar chart and is exactly wrong: it stops each column stretching to the
          track, so the growing div inside gets no height and every bar's
          percentage resolves against zero. The columns stretch; the bar aligns
          itself to the bottom instead. */}
      <ul className="flex h-[132px] items-stretch gap-3">
        {bars.map((bar) => (
          <li key={bar.key} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-muted-foreground font-mono text-[10.5px] tabular-nums">
              {bar.total > 0 ? formatCompact(bar.total) : ""}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className={
                  bar.accent
                    ? "bg-brand-600 w-full rounded-t-[5px] transition-all"
                    : "bg-brand-200 w-full rounded-t-[5px] transition-all"
                }
                style={{ height: `${Math.max(2, (bar.total / peak) * 100)}%` }}
                title={bar.title}
              />
            </div>
            <span
              className={
                bar.accent
                  ? "text-[11px] font-semibold"
                  : "text-muted-foreground text-[11px]"
              }
            >
              {bar.label}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

/** "Mon" from a shop-calendar date. Noon-anchored — see `formatLongDate`. */
function weekdayOf(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "Indian/Mauritius",
  }).format(new Date(`${date}T12:00:00Z`))
}

function dayOfMonth(date: string): string {
  return String(Number(date.slice(8)))
}

/** "9.1k" — the design's compact figure above each bar. */
function formatCompact(value: number): string {
  if (value >= 1000) {
    const thousands = value / 1000
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`
  }
  return String(Math.round(value))
}
