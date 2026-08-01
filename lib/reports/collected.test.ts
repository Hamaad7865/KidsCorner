import { describe, expect, it } from "vitest"

import { collectByMethod } from "./collected"

describe("collectByMethod", () => {
  it("sums each rail and sorts the biggest first", () => {
    const rows = collectByMethod(
      [
        { method: "cash", amount: 100 },
        { method: "card", amount: 700 },
        { method: "cash", amount: 50 },
      ],
      [],
    )
    expect(rows).toEqual([
      { method: "card", amount: 700 },
      { method: "cash", amount: 150 },
    ])
  })

  it("takes a refund off the rail that paid it back", () => {
    // A cash refund leaves the drawer lighter; the card figure is untouched.
    // Refunds netted off the wrong rail — or not at all — is exactly the bug
    // migration 022 fixed on the Z, so the report must agree with the Z.
    const rows = collectByMethod(
      [
        { method: "cash", amount: 1000 },
        { method: "card", amount: 500 },
      ],
      [{ method: "cash", amount: 300 }],
    )
    expect(rows).toEqual([
      { method: "cash", amount: 700 },
      { method: "card", amount: 500 },
    ])
  })

  it("nets an exchange nowhere — no money moved", () => {
    const rows = collectByMethod(
      [{ method: "cash", amount: 1000 }],
      [{ method: "exchange", amount: 500 }],
    )
    expect(rows).toEqual([{ method: "cash", amount: 1000 }])
  })

  it("lets a heavily refunded rail go negative rather than clamping", () => {
    // A day that repaid more card money than it took genuinely collected a
    // negative amount on that rail. Clamping to zero would hide money that
    // left, and the period total would stop reconciling.
    const rows = collectByMethod(
      [{ method: "card", amount: 100 }],
      [{ method: "card", amount: 250 }],
    )
    expect(rows).toEqual([{ method: "card", amount: -150 }])
  })

  it("shows a rail that only refunded, so the money out is not orphaned", () => {
    const rows = collectByMethod([], [{ method: "cash", amount: 200 }])
    expect(rows).toEqual([{ method: "cash", amount: -200 }])
  })

  it("rounds at every boundary rather than accumulating float drift", () => {
    const rows = collectByMethod(
      [
        { method: "cash", amount: 0.1 },
        { method: "cash", amount: 0.2 },
      ],
      [],
    )
    expect(rows[0]?.amount).toBe(0.3)
  })

  it("returns nothing for an empty period", () => {
    expect(collectByMethod([], [])).toEqual([])
  })
})
