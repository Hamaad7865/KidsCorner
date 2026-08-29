import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { SalesChart } from "@/components/admin/sales-chart"

/** The week on the user's dashboard, with the week before it behind. */
const daily = [
  { date: "2026-08-22", total: 1900, prev: 1400 },
  { date: "2026-08-23", total: 2020, prev: 2600 },
  { date: "2026-08-24", total: 980, prev: 1750 },
  { date: "2026-08-25", total: 660, prev: 900 },
  { date: "2026-08-26", total: 5300, prev: 3100 },
  { date: "2026-08-27", total: 2200, prev: 2450 },
  { date: "2026-08-28", total: 0, prev: 1200 },
]

const weekly = [
  { start: "2026-07-27", end: "2026-08-02", total: 18400, prev: 16100 },
  { start: "2026-08-03", end: "2026-08-09", total: 22150, prev: 18400 },
  { start: "2026-08-10", end: "2026-08-16", total: 15880, prev: 22150 },
  { start: "2026-08-17", end: "2026-08-23", total: 24610, prev: 15880 },
  { start: "2026-08-24", end: "2026-08-28", total: 13060, prev: 24610 },
]

const render = (props: Partial<Parameters<typeof SalesChart>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SalesChart, { daily, weekly, weekTotal: 13060, ...props }),
  )

describe("SalesChart", () => {
  it("draws a curve and the axis it hangs on", () => {
    const html = render()
    // One filled area, one stroked line, and gridlines to read them against.
    expect(html).toMatch(/<path[^>]+d="M 44 /)
    expect(html).toContain("stroke-primary")
    expect(html).toContain("6.0k") // niceCeiling(5300) -> 6000, top gridline
    expect(html).toContain("0") // floor
  })

  it("labels the last day Today and the rest by weekday", () => {
    const html = render()
    expect(html).toContain("Today")
    expect(html).toContain("Sat")
    expect(html).toContain("Wed")
  })

  it("ghosts the previous week behind the curve", () => {
    const html = render()
    expect(html).toContain('stroke-dasharray="4 4"')
    expect(html).toContain("Week before")
  })

  // A shop in its first fortnight has no week before it. A dashed line pinned
  // along the axis floor reads as a broken chart, not as an absent comparison.
  it("drops the ghost line and its legend when there is no previous week", () => {
    const html = render({ daily: daily.map((d) => ({ ...d, prev: 0 })) })
    expect(html).not.toContain('stroke-dasharray="4 4"')
    expect(html).not.toContain("Week before")
    expect(html).toContain("stroke-primary") // the current week still draws
  })

  it("says so plainly when nothing sold at all", () => {
    const html = render({
      daily: daily.map((d) => ({ ...d, total: 0, prev: 0 })),
      weekTotal: 0,
    })
    expect(html).toContain("Nothing sold in this period yet")
    expect(html).not.toContain("stroke-primary")
  })

  // The curve itself is aria-hidden, so this table is the only thing a screen
  // reader gets. If it stops carrying the figures, the panel goes silent.
  it("puts the real figures in a screen-reader table", () => {
    const html = render()
    expect(html).toContain("sr-only")
    expect(html).toContain("Rs 5,300.00")
    expect(html).toContain("Rs 1,200.00") // a `prev` column value
    expect(html).toContain('aria-hidden="true"')
  })

  it("totals the week in the subtitle", () => {
    expect(render()).toContain("Rs 13,060.00")
  })

  // The peak has to include the ghost, or a previous period that beat this one
  // would be drawn climbing out through the top of the panel.
  it("scales to the taller of the two series", () => {
    const html = render({
      daily: daily.map((d) => ({ ...d, total: 100, prev: 9000 })),
    })
    expect(html).toContain("9.0k")
  })
})
