import { describe, expect, it } from "vitest"

import {
  addMonths,
  daysInMonth,
  formatRange,
  inRange,
  monthMatrix,
  orderRange,
  presets,
  yearBlock,
  ymd,
} from "./date-range"

describe("monthMatrix", () => {
  it("lays a month out Sunday-first with spill days flagged", () => {
    const weeks = monthMatrix(2026, 8) // September 2026
    expect(weeks).toHaveLength(6)
    expect(weeks[0]).toHaveLength(7)
    // 1 Sep 2026 is a Tuesday, so the row opens with two spill days.
    expect(weeks[0][0]).toEqual({ iso: "2026-08-30", day: 30, inMonth: false })
    expect(weeks[0][2]).toEqual({ iso: "2026-09-01", day: 1, inMonth: true })
    const first = weeks.flat().find((c) => c.inMonth)
    expect(first!.iso).toBe("2026-09-01")
  })

  it("handles a leap February without drifting", () => {
    expect(daysInMonth(2028, 1)).toBe(29)
    const days = monthMatrix(2028, 1)
      .flat()
      .filter((c) => c.inMonth)
      .map((c) => c.day)
    expect(days.at(-1)).toBe(29)
  })
})

describe("addMonths", () => {
  it("crosses year boundaries in both directions", () => {
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month0: 11 })
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month0: 0 })
  })
})

describe("presets", () => {
  it("builds ranges around a given today", () => {
    const p = presets("2026-09-14")
    expect(p.find((x) => x.label === "Today")).toEqual({
      label: "Today",
      from: "2026-09-14",
      to: "2026-09-14",
    })
    expect(p.find((x) => x.label === "Last 7 days")).toMatchObject({
      from: "2026-09-08",
      to: "2026-09-14",
    })
    expect(p.find((x) => x.label === "This month")).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-14",
    })
    expect(p.find((x) => x.label === "Last month")).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-31",
    })
    expect(p.find((x) => x.label === "This year")).toMatchObject({
      from: "2026-01-01",
      to: "2026-09-14",
    })
  })
})

describe("range helpers", () => {
  it("orders two picks regardless of click order", () => {
    expect(orderRange("2026-09-20", "2026-09-10")).toEqual({
      from: "2026-09-10",
      to: "2026-09-20",
    })
  })

  it("includes both ends of the range", () => {
    expect(inRange("2026-09-10", "2026-09-10", "2026-09-20")).toBe(true)
    expect(inRange("2026-09-20", "2026-09-10", "2026-09-20")).toBe(true)
    expect(inRange("2026-09-21", "2026-09-10", "2026-09-20")).toBe(false)
  })

  it("formats a single day and a span", () => {
    expect(formatRange("2026-09-04", "2026-09-04")).toBe("4/9/2026")
    expect(formatRange("2026-09-04", "2026-09-14")).toBe("4/9/2026 – 14/9/2026")
    expect(ymd(2026, 8, 1)).toBe("2026-09-01")
  })
})

describe("yearBlock", () => {
  it("covers twelve aligned years containing the viewed one", () => {
    // 2026 sits in the 2016–2027 block (2026 − 2026 % 12).
    expect(yearBlock(2026)).toEqual({
      start: 2016,
      years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027],
    })
  })

  it("holds the block steady while stepping inside it", () => {
    // Month/year chevrons must not reshuffle the grid under the cursor —
    // only crossing an edge moves it.
    expect(yearBlock(2016).start).toBe(2016)
    expect(yearBlock(2027).start).toBe(2016)
    expect(yearBlock(2028).start).toBe(2028)
    expect(yearBlock(2015).start).toBe(2004)
  })
})
