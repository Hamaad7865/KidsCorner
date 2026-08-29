"use client"

import { useEffect, useId, useRef, useState } from "react"

import { formatDate, formatRs } from "@/lib/format"
import { monotonePath, niceCeiling } from "@/lib/sales/chart-geometry"

type Daily = { date: string; total: number; prev: number }
type Weekly = { start: string; end: string; total: number; prev: number }

/** Drawing box. Width is measured; only the height is fixed. */
const HEIGHT = 210
const PAD = { top: 16, right: 12, bottom: 30, left: 44 }
const GRID_LINES = 4

/**
 * The dashboard's sales curve.
 *
 * A line rather than the seven bars this used to be: a bar chart of one week
 * shows seven totals, and what a shopkeeper actually wants off this panel is
 * the shape — which day spiked, which afternoon died. The week before is
 * drawn behind it as a dashed line, so "we took Rs 13,060" becomes "we took
 * Rs 13,060, and Wednesday doubled the usual".
 *
 * Still no charting dependency. This is one path, one gradient and four
 * gridlines; the maths that matters lives in `lib/sales/chart-geometry` where
 * it can be tested without a browser.
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
  const [hovered, setHovered] = useState<number | null>(null)

  // The SVG is drawn at its real pixel size rather than scaled from a fixed
  // viewBox. `preserveAspectRatio="none"` would stretch the axis labels along
  // with the curve, and the amount of stretch would depend on the window.
  const hostRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(260, Math.round(entry.contentRect.width)))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const rows =
    view === "week"
      ? daily.map((d, i) => ({
          key: d.date,
          total: d.total,
          prev: d.prev,
          label: i === daily.length - 1 ? "Today" : weekdayOf(d.date),
          title: formatDate(d.date),
          now: i === daily.length - 1,
        }))
      : weekly.map((w, i) => ({
          key: w.start,
          total: w.total,
          prev: w.prev,
          label:
            i === weekly.length - 1
              ? "This week"
              : `${dayOfMonth(w.start)}–${dayOfMonth(w.end)}`,
          title: `${formatDate(w.start)} – ${formatDate(w.end)}`,
          now: i === weekly.length - 1,
        }))

  // A week where nothing sold at all would otherwise scale every point to the
  // axis floor and draw a flat line along the bottom, which reads as a broken
  // chart rather than a quiet week.
  const anySales = rows.some((r) => r.total > 0 || r.prev > 0)
  // Only ghost the previous period when there is one. A shop in its first
  // fortnight has no week before, and a dashed line pinned to zero is noise.
  const showGhost = rows.some((r) => r.prev > 0)

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
          {showGhost && anySales ? (
            <p className="text-muted-foreground mt-1.5 flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className="bg-primary inline-block h-0.5 w-3.5 rounded-full" />
                {view === "week" ? "This week" : "This period"}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="border-muted-foreground/60 inline-block w-3.5 border-t border-dashed" />
                {view === "week" ? "Week before" : "Period before"}
              </span>
            </p>
          ) : null}
        </div>

        {/* `background:#F1F5F5; radius:7px; padding:2px` with the selected pill
            raised on white — the design's own segmented control. */}
        <div className="bg-muted flex shrink-0 gap-0.5 rounded-md p-0.5">
          {(["week", "month"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setView(option)
                setHovered(null)
              }}
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

      <div ref={hostRef} className="relative" style={{ height: HEIGHT }}>
        {anySales && rows.length > 1 ? (
          <Curve
            rows={rows}
            width={width}
            view={view}
            showGhost={showGhost}
            hovered={hovered}
            onHover={setHovered}
          />
        ) : (
          <p className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Nothing sold in this period yet.
          </p>
        )}
      </div>

      {/* The curve is painted for the eye and hidden from assistive tech; the
          figures behind it are given here as an actual table instead. */}
      <table className="sr-only">
        <caption>{view === "week" ? "Sales this week" : "Sales this month"}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Sales</th>
            {showGhost ? <th scope="col">Period before</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.title}</th>
              <td>{formatRs(r.total)}</td>
              {showGhost ? <td>{formatRs(r.prev)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

type Row = {
  key: string
  total: number
  prev: number
  label: string
  title: string
  now: boolean
}

function Curve({
  rows,
  width,
  view,
  showGhost,
  hovered,
  onHover,
}: {
  rows: Row[]
  width: number
  view: "week" | "month"
  showGhost: boolean
  hovered: number | null
  onHover: (index: number | null) => void
}) {
  const gradientId = `sales-fill-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  const lineRef = useRef<SVGPathElement>(null)
  const areaRef = useRef<SVGPathElement>(null)

  const inner = { w: width - PAD.left - PAD.right, h: HEIGHT - PAD.top - PAD.bottom }
  const peak = niceCeiling(
    Math.max(...rows.map((r) => (showGhost ? Math.max(r.total, r.prev) : r.total))),
  )
  const xOf = (i: number) => PAD.left + (i / (rows.length - 1)) * inner.w
  const yOf = (value: number) => PAD.top + inner.h - (value / peak) * inner.h

  const points = rows.map((r, i) => ({ x: xOf(i), y: yOf(r.total) }))
  const line = monotonePath(points)
  const floor = PAD.top + inner.h
  const area = `${line} L ${points[points.length - 1].x} ${floor} L ${points[0].x} ${floor} Z`
  const ghost = monotonePath(rows.map((r, i) => ({ x: xOf(i), y: yOf(r.prev) })))

  // Draw the line in on arrival and whenever the range changes. Done through
  // the Web Animations API rather than a CSS keyframe because the dash length
  // is the path's own measured length, which only exists at runtime — and
  // because `fill: "none"` leaves no dasharray behind to fight with a resize.
  useEffect(() => {
    const path = lineRef.current
    if (!path || typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const length = path.getTotalLength()
    path.animate(
      [
        { strokeDasharray: String(length), strokeDashoffset: length },
        { strokeDasharray: String(length), strokeDashoffset: 0 },
      ],
      { duration: 850, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "none" },
    )
    areaRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 700,
      delay: 150,
      easing: "ease-out",
      fill: "none",
    })
  }, [view])

  const focus = hovered ?? rows.length - 1
  const marker = points[focus]
  const row = rows[focus]

  function trackPointer(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - box.left
    // The viewBox is 1:1 with CSS pixels, so x is already in chart space.
    const step = inner.w / (rows.length - 1)
    const index = Math.round((x - PAD.left) / step)
    onHover(Math.min(rows.length - 1, Math.max(0, index)))
  }

  return (
    <>
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        aria-hidden="true"
        className="block touch-none overflow-visible"
        onPointerMove={trackPointer}
        onPointerLeave={() => onHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--primary)", stopOpacity: 0.26 }} />
            <stop offset="100%" style={{ stopColor: "var(--primary)", stopOpacity: 0.015 }} />
          </linearGradient>
        </defs>

        {Array.from({ length: GRID_LINES + 1 }, (_, i) => {
          const y = PAD.top + (inner.h * i) / GRID_LINES
          return (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y}
                y2={y}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground font-mono text-[10px] tabular-nums"
              >
                {formatCompact(peak * (1 - i / GRID_LINES))}
              </text>
            </g>
          )
        })}

        {showGhost ? (
          <path
            d={ghost}
            fill="none"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="stroke-muted-foreground/50"
          />
        ) : null}

        <path ref={areaRef} d={area} fill={`url(#${gradientId})`} />
        <path
          ref={lineRef}
          d={line}
          fill="none"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-primary"
        />

        {hovered !== null ? (
          <line
            x1={marker.x}
            x2={marker.x}
            y1={PAD.top}
            y2={floor}
            strokeDasharray="3 4"
            strokeWidth={1}
            className="stroke-primary/50"
          />
        ) : null}

        <circle
          cx={marker.x}
          cy={marker.y}
          r={4.5}
          strokeWidth={2.25}
          className="fill-card stroke-primary"
        />

        {rows.map((r, i) => (
          <text
            key={r.key}
            x={xOf(i)}
            y={HEIGHT - 9}
            textAnchor="middle"
            className={
              r.now
                ? "fill-foreground text-[11px] font-semibold"
                : "fill-muted-foreground text-[11px]"
            }
          >
            {r.label}
          </text>
        ))}
      </svg>

      {hovered !== null ? (
        <div
          // The figures are already in the table above; this is the sighted
          // pointer's copy of them, and a live region that re-announced on
          // every mouse move would only talk over it.
          aria-hidden="true"
          className={
            "bg-foreground text-background pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg px-2.5 py-2 shadow-lg " +
            // Above the point normally, below it near the top of the panel —
            // otherwise a tall day's tooltip lands on the heading behind it.
            (marker.y < 62 ? "translate-y-3" : "-translate-y-[calc(100%+13px)]")
          }
          style={{
            left: Math.min(Math.max(marker.x, 68), width - 68),
            top: marker.y,
          }}
        >
          <strong className="block text-[13px] font-bold tabular-nums">
            {formatRs(row.total)}
          </strong>
          <span className="block text-[11px] opacity-70">
            {row.title}
            {showGhost ? ` · before ${formatRs(row.prev)}` : ""}
          </span>
        </div>
      ) : null}
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

/** "9.1k" — the design's compact figure on the axis. */
function formatCompact(value: number): string {
  if (value >= 1000) {
    const thousands = value / 1000
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`
  }
  return String(Math.round(value))
}
