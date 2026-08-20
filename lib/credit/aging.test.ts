import { describe, expect, it } from "vitest"

import {
  ageLedger,
  daysBetween,
  EMPTY_AGING,
  sumAging,
  type LedgerEntry,
} from "@/lib/credit/aging"

const TODAY = "2026-08-20"

/** A charge raised `daysAgo`, falling due `terms` days after that. */
function charge(amount: number, daysAgo: number, terms = 30): LedgerEntry {
  const raised = new Date(Date.parse(`${TODAY}T12:00:00Z`) - daysAgo * 86_400_000)
  const raisedDay = raised.toISOString().slice(0, 10)
  const due = new Date(Date.parse(`${raisedDay}T12:00:00Z`) + terms * 86_400_000)
  return {
    amount,
    dueOn: due.toISOString().slice(0, 10),
    createdAt: raised.toISOString(),
  }
}

function payment(amount: number, daysAgo = 0): LedgerEntry {
  const at = new Date(Date.parse(`${TODAY}T12:00:00Z`) - daysAgo * 86_400_000)
  return { amount: -Math.abs(amount), dueOn: null, createdAt: at.toISOString() }
}

describe("daysBetween", () => {
  it("counts whole days forwards", () => {
    expect(daysBetween("2026-08-01", "2026-08-20")).toBe(19)
  })

  it("is negative before the date", () => {
    expect(daysBetween("2026-09-01", "2026-08-20")).toBe(-12)
  })

  it("crosses a month end without drifting", () => {
    expect(daysBetween("2026-07-31", "2026-08-01")).toBe(1)
  })

  it("survives a malformed date rather than returning NaN", () => {
    expect(daysBetween("not-a-date", "2026-08-20")).toBe(0)
  })
})

describe("ageLedger", () => {
  it("is empty for an account that has never been used", () => {
    expect(ageLedger([], TODAY)).toEqual(EMPTY_AGING)
  })

  it("puts a charge that is not yet due in current", () => {
    const aging = ageLedger([charge(500, 5, 30)], TODAY)
    expect(aging.current).toBe(500)
    expect(aging.days1to30).toBe(0)
    expect(aging.total).toBe(500)
  })

  it("buckets by how far past the DUE date it is, not how old the charge is", () => {
    // Raised 40 days ago on 30-day terms: due 10 days ago.
    const aging = ageLedger([charge(500, 40, 30)], TODAY)
    expect(aging.current).toBe(0)
    expect(aging.days1to30).toBe(500)
    expect(aging.total).toBe(500)
  })

  it("separates the three overdue bands", () => {
    const aging = ageLedger(
      [
        charge(100, 31, 30), // due 1 day ago
        charge(200, 70, 30), // due 40 days ago
        charge(400, 130, 30), // due 100 days ago
      ],
      TODAY,
    )
    expect(aging.days1to30).toBe(100)
    expect(aging.days31to60).toBe(200)
    expect(aging.days60plus).toBe(400)
    expect(aging.total).toBe(700)
  })

  it("treats a charge due exactly today as current, not overdue", () => {
    const aging = ageLedger([charge(300, 30, 30)], TODAY)
    expect(aging.current).toBe(300)
    expect(aging.days1to30).toBe(0)
  })

  it("clears the oldest charge first", () => {
    // Rs 300 of payments against an old Rs 200 and a new Rs 400 leaves Rs 300
    // of the NEW charge outstanding, and nothing of the old one.
    const aging = ageLedger(
      [charge(200, 90, 30), charge(400, 5, 30), payment(300)],
      TODAY,
    )
    expect(aging.days60plus).toBe(0)
    expect(aging.current).toBe(300)
    expect(aging.total).toBe(300)
  })

  it("part-pays only the charge the money reaches", () => {
    const aging = ageLedger(
      // Raised 120 days ago on 30-day terms: due 90 days ago, so firmly 60+.
      [charge(500, 120, 30), charge(500, 2, 30), payment(200)],
      TODAY,
    )
    // 200 came off the old one, leaving 300 of it still very late.
    expect(aging.days60plus).toBe(300)
    expect(aging.current).toBe(500)
    expect(aging.total).toBe(800)
  })

  it("puts a charge due exactly 60 days ago in the 31–60 band, not 60+", () => {
    // The boundary the test above got wrong first time round: 90 days old on
    // 30-day terms is 60 days overdue, and 60 is still inside "31–60".
    const aging = ageLedger([charge(500, 90, 30)], TODAY)
    expect(aging.days31to60).toBe(500)
    expect(aging.days60plus).toBe(0)
  })

  it("reports an over-paid account as in credit and owing nothing", () => {
    const aging = ageLedger([charge(200, 10, 30), payment(500)], TODAY)
    expect(aging.total).toBe(0)
    expect(aging.current).toBe(0)
    expect(aging.inCredit).toBe(300)
  })

  it("never lets money held in credit reduce an overdue figure", () => {
    // A settled account plus a return, then a fresh late charge. The credit
    // pool is applied by FIFO, so the new charge IS covered — but what is left
    // over must not appear as a negative bucket.
    const aging = ageLedger(
      [charge(100, 200, 30), payment(400, 100), charge(100, 90, 30)],
      TODAY,
    )
    expect(aging.total).toBe(0)
    expect(aging.days60plus).toBe(0)
    expect(aging.inCredit).toBe(200)
  })

  it("treats a charge with no due date as due when it was raised", () => {
    const aging = ageLedger(
      [{ amount: 250, dueOn: null, createdAt: "2026-06-01T09:00:00.000Z" }],
      TODAY,
    )
    // 1 June to 20 August is 80 days, so it is well past 60.
    expect(aging.days60plus).toBe(250)
    expect(aging.current).toBe(0)
  })

  it("ages by the charge's own order, not the order rows arrive in", () => {
    const old = charge(100, 120, 30)
    const recent = charge(100, 1, 30)
    const shuffled = ageLedger([recent, payment(100), old], TODAY)
    // The payment must clear the OLD charge even though it was listed last.
    expect(shuffled.days60plus).toBe(0)
    expect(shuffled.current).toBe(100)
  })

  it("keeps the total equal to the sum of the buckets", () => {
    const aging = ageLedger(
      [charge(123.45, 100, 30), charge(67.89, 40, 30), charge(10.11, 1, 30)],
      TODAY,
    )
    const summed =
      aging.current + aging.days1to30 + aging.days31to60 + aging.days60plus
    expect(Number(summed.toFixed(2))).toBe(aging.total)
  })
})

describe("sumAging", () => {
  it("is empty for no accounts", () => {
    expect(sumAging([])).toEqual(EMPTY_AGING)
  })

  it("adds the buckets across accounts", () => {
    const a = ageLedger([charge(100, 31, 30)], TODAY)
    const b = ageLedger([charge(250, 100, 30)], TODAY)
    const total = sumAging([a, b])
    expect(total.days1to30).toBe(100)
    expect(total.days60plus).toBe(250)
    expect(total.total).toBe(350)
  })

  it("does not lose cents across many accounts", () => {
    const rows = Array.from({ length: 3 }, () => ageLedger([charge(0.1, 40, 30)], TODAY))
    expect(sumAging(rows).total).toBe(0.3)
  })
})
