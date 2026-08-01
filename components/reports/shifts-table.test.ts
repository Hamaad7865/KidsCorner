import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ShiftsTable, lateTotal } from "./shifts-table"
import type { ShiftReport } from "@/lib/reports/queries"

const shift = (over: Partial<ShiftReport> = {}): ShiftReport => ({
  id: 15,
  openedAt: "2026-07-29T07:07:00.000Z",
  closedAt: "2026-07-29T21:15:06.000Z",
  openedBy: "Priya",
  closedBy: "Priya",
  openingFloat: 1000,
  expectedCash: 10889.48,
  countedCash: 10889.48,
  variance: 0,
  notes: null,
  zNo: "Z00001",
  zId: 1,
  unreported: 0,
  lateCount: 0,
  lateSales: [],
  ...over,
})

const render = (shifts: ShiftReport[]) =>
  renderToStaticMarkup(createElement(ShiftsTable, { shifts }))

describe("lateTotal", () => {
  it("adds up only the rows on screen", () => {
    // Never the badge's figure. A capped list must not claim a total bigger
    // than what it is showing.
    expect(
      lateTotal({ lateSales: [{ total: 250 }, { total: 480.5 }] }),
    ).toBeCloseTo(730.5, 2)
    expect(lateTotal({ lateSales: [] })).toBe(0)
  })
})

describe("a healthy shift", () => {
  it("shows its Z with no alarm and no extra row", () => {
    const html = render([shift()])
    expect(html).toContain("Z00001")
    expect(html).not.toContain("after")
    expect(html).not.toContain("landed")
  })

  it("says so when no shifts opened at all", () => {
    expect(render([])).toContain("No shifts opened in this range")
  })
})

describe("money that landed after the Z was frozen", () => {
  const late = shift({
    unreported: 730.5,
    lateCount: 2,
    lateSales: [
      { saleId: 91, saleNo: "S260729-14", at: "2026-07-29T21:35:06.000Z", total: 480.5 },
      { saleId: 90, saleNo: "S260729-13", at: "2026-07-29T21:16:06.000Z", total: 250 },
    ],
  })

  it("flags the amount on the Z cell", () => {
    expect(render([late])).toContain("+Rs 730.50 after")
  })

  it("names every sale, with a link to it", () => {
    const html = render([late])
    expect(html).toContain("S260729-14")
    expect(html).toContain("S260729-13")
    expect(html).toContain("/sales/91")
    expect(html).toContain("Rs 480.50")
  })

  it("states the total of what it listed", () => {
    expect(render([late])).toContain(
      "2 sales landed after Z Z00001 was frozen, totalling Rs 730.50",
    )
  })

  it("stays silent about a discrepancy when there isn't one", () => {
    expect(render([late])).not.toContain("something else in this shift")
  })
})

describe("a Z that disagrees with its drawer for another reason", () => {
  it("does not present the listed total as the slip's shortfall", () => {
    // `unreported` is the whole shift's sales less what the Z claimed, so a
    // sale voided AFTER the close moves it without touching the late list.
    // Saying the two are the same would be right most of the time, which is
    // the worst kind of wrong on a reconciliation screen.
    const html = render([
      shift({
        unreported: 230.5,
        lateCount: 2,
        lateSales: [
          { saleId: 91, saleNo: "S260729-14", at: "2026-07-29T21:35:06.000Z", total: 480.5 },
          { saleId: 90, saleNo: "S260729-13", at: "2026-07-29T21:16:06.000Z", total: 250 },
        ],
      }),
    ])
    expect(html).toContain("totalling Rs 730.50")
    expect(html).toContain("out by Rs 230.50 overall")
    expect(html).toContain("voided or refunded after the close")
  })

  it("reads a shift that ended up SHORT as a reversal, not as an arrival", () => {
    // This used to render "+Rs -500.00 after", which is not a sentence.
    const html = render([shift({ unreported: -500 })])
    expect(html).toContain("Rs 500.00 reversed after")
    expect(html).not.toContain("-Rs")
    expect(html).not.toContain("+Rs -")
  })
})

describe("a list longer than one view", () => {
  it("says how many of how many it is showing", () => {
    const html = render([
      shift({
        unreported: 900,
        lateCount: 240,
        lateSales: Array.from({ length: 200 }, (_, i) => ({
          saleId: i + 1,
          saleNo: `S26-${i}`,
          at: "2026-07-29T21:35:06.000Z",
          total: 4.5,
        })),
      }),
    ])
    expect(html).toContain("Showing the 200 most recent of 240")
    // The discrepancy note is suppressed while capped: the listed total is
    // knowingly partial, so comparing it to the badge would raise a false alarm.
    expect(html).not.toContain("something else in this shift")
  })
})

describe("shifts from before Z reports existed", () => {
  it("shows the gap rather than reconstructing a slip", () => {
    const html = render([shift({ zNo: null, zId: null })])
    expect(html).toContain("none")
  })

  it("marks a shift that is still open", () => {
    const html = render([
      shift({ closedAt: null, zNo: null, zId: null, variance: null, countedCash: null }),
    ])
    expect(html).toContain("Open")
  })
})
