import { describe, expect, it } from "vitest"

import { bankDeposits, flowTotal, periodFilter, resolveRange } from "./cash-flow"

const TODAY = "2026-08-01"

const closure = { shiftId: 7, closedAt: "2026-08-01T18:00:00Z", closedByName: "Priya" }

const pay = (method: string, amount: number, struck = false) => ({ method, amount, struck })

describe("resolveRange", () => {
  it("falls back to today when nothing was given", () => {
    expect(resolveRange({}, TODAY)).toEqual({ refDate: TODAY, from: TODAY, to: TODAY })
  })

  it("keeps a full range as typed", () => {
    expect(resolveRange({ ref: "2026-07-04", from: "2026-07-01", to: "2026-07-31" }, TODAY)).toEqual(
      { refDate: "2026-07-04", from: "2026-07-01", to: "2026-07-31" },
    )
  })

  it("borrows the other end when only one is given", () => {
    expect(resolveRange({ from: "2026-07-10" }, TODAY)).toMatchObject({
      from: "2026-07-10",
      to: "2026-07-10",
    })
    expect(resolveRange({ to: "2026-07-10" }, TODAY)).toMatchObject({
      from: "2026-07-10",
      to: "2026-07-10",
    })
  })

  it("swaps a range typed backwards rather than returning an empty period", () => {
    // The failure this prevents: from > to makes every SQL filter match
    // nothing, and a page reading "no takings" is indistinguishable from a
    // week the shop was shut.
    expect(resolveRange({ from: "2026-07-31", to: "2026-07-01" }, TODAY)).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-31",
    })
  })

  it("ignores anything that is not a date", () => {
    expect(
      resolveRange({ ref: "yesterday", from: "2026-7-1", to: "'; drop table sales--" }, TODAY),
    ).toEqual({ refDate: TODAY, from: TODAY, to: TODAY })
  })
})

describe("periodFilter", () => {
  // Postgres returns timestamps at +00:00; the shop's days are bounded at
  // +04:00. Every case here passes when instants are compared and fails when
  // the ISO strings are.
  const onJuly30 = periodFilter("2026-07-30", "2026-07-30")

  it("keeps a sale rung up just after midnight in Mauritius", () => {
    // 01:14 on the 30th locally, stored as 21:14 on the 29th UTC. As text that
    // sorts before the day even starts; as a moment it is an hour and a bit in.
    expect(onJuly30("2026-07-29T21:14:09.488744+00:00")).toBe(true)
  })

  it("keeps a till closed at 01:15 on the reference date", () => {
    expect(onJuly30("2026-07-29T21:15:06.032060+00:00")).toBe(true)
  })

  it("excludes the four hours before the shop's day begins", () => {
    // 23:59 on the 29th locally — the previous trading day.
    expect(onJuly30("2026-07-29T19:59:59.000+00:00")).toBe(false)
  })

  it("keeps the last second of the day and drops the first of the next", () => {
    expect(onJuly30("2026-07-30T19:59:59.999+00:00")).toBe(true)
    expect(onJuly30("2026-07-30T20:00:00.000+00:00")).toBe(false)
  })

  it("accepts a boundary written in either offset", () => {
    expect(onJuly30("2026-07-30T00:00:00.000+04:00")).toBe(true)
    expect(onJuly30("2026-07-29T20:00:00.000Z")).toBe(true)
  })

  it("spans a multi-day range", () => {
    const week = periodFilter("2026-07-27", "2026-07-31")
    expect(week("2026-07-26T20:00:00.000+00:00")).toBe(true) // 27th, 00:00 MU
    expect(week("2026-07-26T19:59:59.000+00:00")).toBe(false)
    expect(week("2026-07-31T19:59:59.000+00:00")).toBe(true)
    expect(week("2026-07-31T20:00:00.000+00:00")).toBe(false)
  })

  it("rejects a missing or unparseable timestamp instead of throwing", () => {
    expect(onJuly30(null)).toBe(false)
    expect(onJuly30("not a date")).toBe(false)
  })
})

describe("flowTotal", () => {
  it("adds the rows up", () => {
    expect(
      flowTotal([
        { key: "a", at: "", byName: null, method: "cash", amount: 120.5, struck: false },
        { key: "b", at: "", byName: null, method: "card", amount: 79.5, struck: false },
      ]),
    ).toBe(200)
  })

  it("leaves struck rows out", () => {
    // A voided sale's payment and an exchange both stay on screen as evidence.
    // Counting them would overstate the period by the value of a sale that was
    // undone.
    expect(
      flowTotal([
        { key: "a", at: "", byName: null, method: "cash", amount: 100, struck: false },
        { key: "b", at: "", byName: null, method: "cash", amount: 999, struck: true },
      ]),
    ).toBe(100)
  })

  it("rounds to the cent rather than accumulating float drift", () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      key: `r${i}`,
      at: "",
      byName: null,
      method: "cash",
      amount: 0.1,
      struck: false,
    }))
    expect(flowTotal(rows)).toBe(0.3)
  })

  it("is zero for an empty period", () => {
    expect(flowTotal([])).toBe(0)
  })
})

describe("bankDeposits", () => {
  it("books each non-cash method out of the register at close", () => {
    const rows = bankDeposits(closure, [pay("card", 500), pay("juice", 250)])

    expect(rows.map((r) => [r.method, r.amount])).toEqual([
      ["card", -500],
      ["juice", -250],
    ])
    expect(rows[0]).toMatchObject({
      type: "Bank deposit",
      comment: "Automatic bank deposit",
      at: closure.closedAt,
      byName: "Priya",
      struck: false,
    })
  })

  it("leaves cash alone — it is in the drawer, not at the bank", () => {
    expect(bankDeposits(closure, [pay("cash", 1000)])).toEqual([])
  })

  it("sums a method paid across several sales into one deposit", () => {
    const rows = bankDeposits(closure, [pay("card", 120.25), pay("card", 79.75)])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.amount).toBe(-200)
  })

  it("ignores a voided sale's card payment", () => {
    // The card was never actually charged, so there is nothing to deposit.
    // Depositing it would make the period's outflows exceed its inflows.
    expect(bankDeposits(closure, [pay("card", 500, true)])).toEqual([])
  })

  it("raises no deposit for a method that nets to nothing", () => {
    expect(bankDeposits(closure, [pay("card", 0)])).toEqual([])
  })

  it("gives each deposit a key unique to its shift and method", () => {
    const rows = bankDeposits(closure, [pay("card", 100), pay("myt_money", 50)])
    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
    expect(rows[0]?.key).toBe("d7:card")
  })
})
