import { describe, expect, it } from "vitest"

import { buildTrace } from "./traceability"

/** Only the arrays a test cares about; the rest stay empty. */
const trace = (input: Partial<Parameters<typeof buildTrace>[0]>) =>
  buildTrace({
    shifts: [],
    payments: [],
    discounts: [],
    prints: [],
    refunds: [],
    movements: [],
    ...input,
  })

const shift = (over: Record<string, unknown> = {}) => ({
  id: 1,
  openedAt: "2026-07-29T04:00:00.000Z",
  closedAt: "2026-07-29T14:00:00.000Z",
  openingFloat: 1000,
  openedByName: "Priya",
  closedByName: "Priya",
  variance: 0,
  nonCash: [] as { method: string; amount: number }[],
  ...over,
})

describe("buildTrace — shift bookends", () => {
  it("gives the float its own line, not a suffix on the opening", () => {
    const events = trace({ shifts: [shift({ closedAt: null })] })

    expect(events.map((e) => e.title)).toEqual(["Float in", "Till opened"])
    expect(events.find((e) => e.kind === "float_in")?.detail).toBe("Rs 1,000.00 · Priya")
  })

  it("says nothing about an opening that happened outside the window", () => {
    // A shift that opened on Monday and closed on Tuesday belongs on Tuesday's
    // feed for its closing only — an "opened" line here would be dated to a day
    // the viewer did not ask about.
    const events = trace({ shifts: [shift({ openedAt: null })] })

    expect(events.map((e) => e.title)).toEqual(["Till closed"])
  })

  it("reports the variance and what went to the bank on closing", () => {
    const events = trace({
      shifts: [shift({ variance: -50, nonCash: [{ method: "card", amount: 1200 }] })],
    })

    expect(events.find((e) => e.kind === "till_close")?.detail).toBe(
      "Variance Rs -50.00 · Card Rs 1,200.00 to bank · Priya",
    )
  })

  it("emits nothing for a shift with neither end in the window", () => {
    expect(trace({ shifts: [shift({ openedAt: null, closedAt: null })] })).toEqual([])
  })
})

describe("buildTrace — money", () => {
  const payment = {
    id: 9,
    at: "2026-07-29T06:00:00.000Z",
    method: "myt_money",
    amount: 450,
    saleId: 3,
    saleNo: "S260729-4",
    cashierName: "Ravi",
    voided: false,
  }

  it("names the method the way the rest of the app does", () => {
    const [event] = trace({ payments: [payment] })
    expect(event?.title).toBe("Payment · my.t money")
    expect(event?.detail).toBe("Rs 450.00 · S260729-4 · Ravi")
    expect(event?.href).toBe("/sales/3")
  })

  it("marks a payment on a voided sale rather than hiding it", () => {
    const [event] = trace({ payments: [{ ...payment, voided: true }] })
    expect(event?.title).toBe("Payment on a voided sale")
  })

  it("names who approved a discount", () => {
    const [event] = trace({
      discounts: [
        {
          id: 2,
          at: "2026-07-29T06:00:00.000Z",
          saleId: 3,
          saleNo: "S260729-4",
          label: "Staff 10%",
          amount: 75.5,
          approvedByName: "Priya",
        },
      ],
    })
    expect(event?.detail).toBe("S260729-4 · Staff 10% — Rs 75.50 off · approved by Priya")
  })

  it("quotes the reason on a refund", () => {
    const [event] = trace({
      refunds: [
        {
          id: 4,
          at: "2026-07-29T06:00:00.000Z",
          creditNo: "CN-12",
          saleId: 3,
          total: 300,
          method: "cash",
          reason: "Wrong size",
          cashierName: "Ravi",
        },
      ],
    })
    expect(event?.title).toBe("Refund · Cash")
    expect(event?.detail).toBe("CN-12 · Rs 300.00 · “Wrong size” · Ravi")
  })

  it("says an exchange moved no money instead of printing an amount", () => {
    const [event] = trace({
      refunds: [
        {
          id: 5,
          at: "2026-07-29T06:00:00.000Z",
          creditNo: "CN-13",
          saleId: 3,
          total: 500,
          method: "exchange",
          reason: "Swapped red",
          cashierName: "Ravi",
        },
      ],
    })
    expect(event?.title).toBe("Exchange")
    expect(event?.detail).toContain("goods swapped, no money moved")
    expect(event?.detail).not.toContain("500")
  })

  it("tells a pay-in from a pay-out by the sign", () => {
    const at = "2026-07-29T06:00:00.000Z"
    const out = trace({
      movements: [{ id: 1, at, amount: -450, reason: "Cleaner paid", byName: "Priya" }],
    })
    const inn = trace({
      movements: [{ id: 2, at, amount: 800, reason: "Change from safe", byName: "Priya" }],
    })

    expect(out[0]).toMatchObject({ title: "Disbursement", kind: "cash_out" })
    expect(inn[0]).toMatchObject({ title: "Paid in", kind: "float_in" })
  })
})

describe("buildTrace — ordering", () => {
  it("puts the newest first", () => {
    const events = trace({
      movements: [
        { id: 1, at: "2026-07-29T04:00:00.000Z", amount: -1, reason: "early", byName: null },
        { id: 2, at: "2026-07-29T12:00:00.000Z", amount: -1, reason: "late", byName: null },
      ],
    })
    expect(events.map((e) => e.detail?.split(" · ")[1])).toEqual(["late", "early"])
  })

  it("orders by instant, not by the text of the timestamp", () => {
    // Two moments 44 minutes apart, written at different offsets. The later one
    // is 21:14 UTC on the 29th; the earlier one is 20:30 UTC written as 00:30
    // on the 30th in Mauritius. As text the earlier one sorts higher — it says
    // "30" — so a string sort puts the feed in the wrong order.
    const events = trace({
      movements: [
        { id: 1, at: "2026-07-29T21:14:00.000Z", amount: -1, reason: "later", byName: null },
        { id: 2, at: "2026-07-30T00:30:00.000+04:00", amount: -1, reason: "earlier", byName: null },
      ],
    })
    expect(events.map((e) => e.detail?.split(" · ")[1])).toEqual(["later", "earlier"])
  })

  it("keeps a stable order for events sharing a timestamp", () => {
    const at = "2026-07-29T06:00:00.000Z"
    const build = () =>
      trace({
        movements: [
          { id: 2, at, amount: -1, reason: "b", byName: null },
          { id: 1, at, amount: -1, reason: "a", byName: null },
        ],
      }).map((e) => e.key)

    expect(build()).toEqual(build())
  })
})
