"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"

import {
  MONTHS,
  WEEKDAYS,
  addMonths,
  formatRange,
  inRange,
  monthMatrix,
  orderRange,
  parseYmd,
  presets,
  type Ymd,
} from "@/lib/reports/date-range"
import { cn } from "@/lib/utils"

/**
 * The journal's period picker — a range calendar in place of two native date
 * inputs, so a shopkeeper can jump to any month and drag out a span the way
 * Carfectionist does. The range lives in the URL, so the choice stays
 * shareable; picking a range or a preset navigates there.
 */
export function JournalDateRange({
  from,
  to,
  today,
  report,
  method,
}: {
  from: Ymd
  to: Ymd
  today: Ymd
  report: string
  method?: string
}) {
  const router = useRouter()
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState<"day" | "month">("day")
  const [view, setView] = useState(() => {
    const p = parseYmd(to)
    return { year: p.year, month0: p.month0 }
  })
  // The first click of a new range; the second click applies and closes.
  const [anchor, setAnchor] = useState<Ymd | null>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = () => {
      setOpen(false)
      setAnchor(null)
      setLevel("day")
    }
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) dismiss()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss()
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  function close() {
    setOpen(false)
    setAnchor(null)
    setLevel("day")
  }

  function apply(f: Ymd, t: Ymd) {
    close()
    const m = method ? `&m=${method}` : ""
    router.push(`/reports?report=${report}&from=${f}&to=${t}${m}`)
  }

  function pickDay(iso: Ymd) {
    if (anchor === null) {
      setAnchor(iso)
      return
    }
    const { from: f, to: t } = orderRange(anchor, iso)
    apply(f, t)
  }

  const weeks = monthMatrix(view.year, view.month0)
  const step = (delta: number) =>
    setView((v) => addMonths(v.year, v.month0, delta))
  const stepYear = (delta: number) =>
    setView((v) => ({ ...v, year: v.year + delta }))

  const headClass =
    "text-muted-foreground flex size-9 items-center justify-center rounded-md hover:bg-muted"

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="border-input hover:bg-muted/50 flex items-center gap-3 rounded-lg border bg-transparent px-3 py-1.5 text-left"
      >
        <CalendarDays aria-hidden className="text-primary size-5 shrink-0" />
        <span className="flex flex-col">
          <span className="text-muted-foreground text-xs">Period date</span>
          <span className="text-sm font-medium tabular-nums">
            {formatRange(from, to)}
          </span>
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a period"
          className="bg-background absolute left-0 top-full z-50 mt-2 flex w-[min(38rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border p-3 shadow-lg sm:flex-row"
        >
          <div className="flex flex-row flex-wrap gap-1 sm:w-40 sm:flex-col">
            {presets(today).map((p) => {
              const on = p.from === from && p.to === to
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => apply(p.from, p.to)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-left text-sm hover:bg-muted",
                    on && "bg-primary/10 text-primary font-medium",
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          <div className="min-w-0 flex-1 sm:border-l sm:pl-3">
            <div className="mb-1 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setLevel(level === "day" ? "month" : "day")}
                className="hover:bg-muted rounded-md px-2 py-1 text-sm font-semibold"
              >
                {level === "day"
                  ? `${MONTHS[view.month0]} ${view.year}`
                  : view.year}
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous"
                  onClick={() => (level === "day" ? step(-1) : stepYear(-1))}
                  className={headClass}
                >
                  <ChevronLeft aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next"
                  onClick={() => (level === "day" ? step(1) : stepYear(1))}
                  className={headClass}
                >
                  <ChevronRight aria-hidden className="size-4" />
                </button>
              </div>
            </div>

            {level === "month" ? (
              <div className="grid grid-cols-4 gap-1">
                {MONTHS.map((label, m) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      setView((v) => ({ ...v, month0: m }))
                      setLevel("day")
                    }}
                    className={cn(
                      "rounded-md py-3 text-sm hover:bg-muted",
                      m === view.month0 && "bg-primary text-primary-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {WEEKDAYS.map((d, i) => (
                  <div
                    key={i}
                    className="text-muted-foreground py-1 text-xs font-medium"
                  >
                    {d}
                  </div>
                ))}
                {weeks.flat().map((cell) => {
                  const selected = anchor
                    ? cell.iso === anchor
                    : cell.iso === from || cell.iso === to
                  const within = anchor
                    ? false
                    : from !== to && inRange(cell.iso, from, to)
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => pickDay(cell.iso)}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-md text-sm tabular-nums hover:bg-muted",
                        !cell.inMonth && "text-muted-foreground/50",
                        within && !selected && "bg-primary/15 rounded-none",
                        selected &&
                          "bg-primary text-primary-foreground hover:bg-primary",
                      )}
                    >
                      {cell.day}
                    </button>
                  )
                })}
              </div>
            )}

            {anchor ? (
              <p className="text-muted-foreground mt-2 text-xs">
                From {anchor} — pick the end date.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
