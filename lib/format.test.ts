import { describe, expect, it } from "vitest"

import { round5, shopDayOf, shopTimeOf } from "./format"

describe("shopDayOf", () => {
  it("files a late-night sale under the shop's day, not UTC's", () => {
    // 01:14 on the 30th in Mauritius, stored as 21:14 on the 29th in UTC.
    // `iso.slice(0, 10)` — the obvious thing — files it under the 29th, which
    // would break the day bands on the traceability feed and put a sale on the
    // wrong day's takings.
    expect(shopDayOf("2026-07-29T21:14:09.488744+00:00")).toBe("2026-07-30")
  })

  it("keeps the last moment before midnight on the right day", () => {
    expect(shopDayOf("2026-07-29T19:59:59.999Z")).toBe("2026-07-29")
    expect(shopDayOf("2026-07-29T20:00:00.000Z")).toBe("2026-07-30")
  })

  it("reads the same instant written at either offset as one day", () => {
    expect(shopDayOf("2026-07-30T00:00:00.000+04:00")).toBe(
      shopDayOf("2026-07-29T20:00:00.000Z"),
    )
  })

  it("accepts a Date as readily as a string", () => {
    expect(shopDayOf(new Date("2026-07-29T21:14:00Z"))).toBe("2026-07-30")
  })

  it("returns an empty string for something unparseable rather than throwing", () => {
    expect(shopDayOf("not a date")).toBe("")
  })
})

describe("shopTimeOf", () => {  it("gives the shop's wall clock, not UTC's", () => {
    // 21:14 UTC is 01:14 in Mauritius. The journal CSV used to slice the ISO
    // string and print 21:14 — the day and the time both wrong on the one
    // document an accountant reads.
    expect(shopTimeOf("2026-07-29T21:14:09.488744+00:00")).toBe("01:14")
  })

  it("agrees with shopDayOf about which side of midnight an instant is", () => {
    const at = "2026-07-29T20:00:00.000Z"
    expect(shopDayOf(at)).toBe("2026-07-30")
    expect(shopTimeOf(at)).toBe("00:00")
  })

  it("returns an empty string for garbage rather than throwing", () => {
    expect(shopTimeOf("not a date")).toBe("")
  })
})

describe("round5", () => {
  it("snaps to the nearest Rs 5 both ways", () => {
    // 1,137 down to 1,135 and 1,138 up to 1,140 — the counter's two cases.
    expect(round5(1137)).toBe(1135)
    expect(round5(1138)).toBe(1140)
  })

  it("rounds an exact half up, matching SQL round() on the till's domain", () => {
    // 1,137.50 / 5 is exactly 227.5 in float64, so Math.round sees the true
    // half — the same answer numeric round() gives in migration 049's asserts.
    expect(round5(1137.5)).toBe(1140)
    expect(round5(1132.5)).toBe(1135)
  })

  it("leaves exact multiples and zero alone", () => {
    expect(round5(1135)).toBe(1135)
    expect(round5(0)).toBe(0)
    expect(round5(-3)).toBe(0)
  })
})
