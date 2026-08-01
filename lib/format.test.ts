import { describe, expect, it } from "vitest"

import { shopDayOf, shopTimeOf } from "./format"

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

describe("shopTimeOf", () => {
  it("gives the shop's wall clock, not UTC's", () => {
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
