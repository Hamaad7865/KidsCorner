import { describe, expect, it } from "vitest"

import { settleDiscounts, type TillClient } from "./sale-core"

/**
 * `settleDiscounts` — how much comes off a sale, and who has to authorise it.
 *
 * Three real bugs have lived in here. A category rule settled against the whole
 * basket gave away far more than the category was worth; a line-scoped rule
 * naming no category had no honest base at all; and a stack of rules could in
 * principle exceed the basket. Each has a case below, so none can come back
 * quietly.
 *
 * The Supabase client is stubbed rather than mocked wholesale: these tests care
 * about the arithmetic and the gate, not about PostgREST. Every case avoids the
 * approval path except the ones that are specifically about it — a rule with
 * `requires_manager` false, no manual discount, no line discount and no custom
 * line means `verifyApproval` is never reached.
 */

type Row = Record<string, unknown>

/** Just enough client to answer the one query `settleDiscounts` makes. */
function stubClient(rules: Row[]): TillClient {
  return {
    from(table: string) {
      if (table !== "discounts") throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          in: (_column: string, ids: number[]) => ({
            data: rules.filter((r) => ids.includes(r.id as number)),
            error: null,
          }),
        }),
      }
    },
  } as unknown as TillClient
}

function ruleRow(over: Row = {}): Row {
  return {
    id: 1,
    name: "Staff discount",
    code: null,
    kind: "percent",
    value: 10,
    scope: "sale",
    category_id: null,
    min_spend: 0,
    max_amount: null,
    starts_on: null,
    ends_on: null,
    requires_manager: false,
    is_active: true,
    ...over,
  }
}

/** A priced line as `priceItems` would have produced it. */
function line(over: Partial<{
  variantId: number | null
  qty: number
  unitPrice: number
  discount: number
  lineTotal: number
  categoryId: number
}> = {}) {
  const base = {
    variantId: 101 as number | null,
    qty: 1,
    unitPrice: 1_000,
    discount: 0,
    lineTotal: 1_000,
    categoryId: 7,
  }
  return { ...base, ...over }
}

const posted = (over: Record<string, unknown> = {}) => ({
  discountId: 1,
  label: "ignored — the server uses the rule's own name",
  kind: "percent" as const,
  value: 99,
  amount: 9_999,
  approvedBy: null,
  ...over,
})

describe("settleDiscounts", () => {
  it("does nothing when there is nothing to settle", async () => {
    const result = await settleDiscounts(stubClient([]), [], [line()], null)
    expect(result).toEqual({ applied: [], total: 0 })
  })

  it("recomputes from the rule, ignoring what the client claimed", async () => {
    // The posted entry says 99% / 9,999. The rule says 10%.
    const result = await settleDiscounts(
      stubClient([ruleRow()]),
      [posted()],
      [line({ lineTotal: 1_451.42 })],
      null,
    )
    expect("applied" in result).toBe(true)
    if (!("applied" in result)) return
    expect(result.total).toBe(145.14)
    expect(result.applied[0]?.label).toBe("Staff discount")
    expect(result.applied[0]?.value).toBe(10)
  })

  it("settles a category rule against that category's lines only", async () => {
    // Babywear (7) is 1,000 of a 1,320 basket. 10% must be 100, not 132.
    const result = await settleDiscounts(
      stubClient([ruleRow({ category_id: 7 })]),
      [posted()],
      [line({ categoryId: 7, lineTotal: 1_000 }), line({ categoryId: 9, lineTotal: 320 })],
      null,
    )
    if (!("applied" in result)) throw new Error(result.error)
    expect(result.total).toBe(100)
  })

  it("refuses a category rule that matches nothing in the basket", async () => {
    // Refused rather than silently dropped: the cashier put it on the screen
    // and quoted it to the customer.
    const result = await settleDiscounts(
      stubClient([ruleRow({ category_id: 99 })]),
      [posted()],
      [line({ categoryId: 7 })],
      null,
    )
    expect("error" in result).toBe(true)
  })

  it("refuses a line-scoped rule that names no category", async () => {
    const result = await settleDiscounts(
      stubClient([ruleRow({ scope: "line", category_id: null })]),
      [posted()],
      [line()],
      null,
    )
    if (!("error" in result)) throw new Error("should have refused")
    expect(result.error).toContain("per-line discount")
  })

  it("refuses a rule that no longer exists", async () => {
    const result = await settleDiscounts(stubClient([]), [posted()], [line()], null)
    if (!("error" in result)) throw new Error("should have refused")
    expect(result.error).toContain("no longer exists")
  })

  it("never lets a stack of rules exceed the basket", async () => {
    const rules = [
      ruleRow({ id: 1, name: "Sixty", kind: "percent", value: 60 }),
      ruleRow({ id: 2, name: "Eighty", kind: "percent", value: 80 }),
    ]
    const result = await settleDiscounts(
      stubClient(rules),
      [posted({ discountId: 1 }), posted({ discountId: 2 })],
      [line({ lineTotal: 1_000 })],
      null,
    )
    if (!("applied" in result)) throw new Error(result.error)
    // 60% then 80% of the ORIGINAL would be 1,400. The second is settled
    // against what is left, so the total stops at the basket.
    expect(result.total).toBeLessThanOrEqual(1_000)
    expect(result.total).toBe(1_000)
  })

  it("applies the same rule once, however many times it is posted", async () => {
    const result = await settleDiscounts(
      stubClient([ruleRow()]),
      [posted(), posted(), posted()],
      [line({ lineTotal: 1_000 })],
      null,
    )
    if (!("applied" in result)) throw new Error(result.error)
    expect(result.applied).toHaveLength(1)
    expect(result.total).toBe(100)
  })

  it("stops two rules on one category exceeding that category", async () => {
    // Both name Babywear, which is only 400 of the basket.
    const rules = [
      ruleRow({ id: 1, category_id: 7, kind: "amount", value: 300 }),
      ruleRow({ id: 2, category_id: 7, kind: "amount", value: 300 }),
    ]
    const result = await settleDiscounts(
      stubClient(rules),
      [posted({ discountId: 1 }), posted({ discountId: 2 })],
      [line({ categoryId: 7, lineTotal: 400 }), line({ categoryId: 9, lineTotal: 600 })],
      null,
    )
    if (!("applied" in result)) throw new Error(result.error)
    expect(result.total).toBe(400)
  })

  describe("the manager gate", () => {
    it("demands one for a manual discount, which has no rule behind it", async () => {
      const result = await settleDiscounts(
        stubClient([]),
        [posted({ discountId: null, amount: 50 })],
        [line()],
        null,
      )
      if (!("error" in result)) throw new Error("should have demanded approval")
      expect(result.needsApproval).toBe(true)
    })

    it("demands one for money off a single line", async () => {
      // Same act as a manual discount, on a smaller scale — same bar.
      const result = await settleDiscounts(
        stubClient([]),
        [],
        [line({ discount: 100, lineTotal: 900 })],
        null,
      )
      if (!("error" in result)) throw new Error("should have demanded approval")
      expect(result.needsApproval).toBe(true)
    })

    it("demands one for a custom line, where the cashier named the price", async () => {
      const result = await settleDiscounts(
        stubClient([]),
        [],
        [line({ variantId: null, categoryId: 0 })],
        null,
      )
      if (!("error" in result)) throw new Error("should have demanded approval")
      expect(result.needsApproval).toBe(true)
    })

    it("demands one when the rule itself asks for it", async () => {
      const result = await settleDiscounts(
        stubClient([ruleRow({ requires_manager: true })]),
        [posted()],
        [line()],
        null,
      )
      if (!("error" in result)) throw new Error("should have demanded approval")
      expect(result.needsApproval).toBe(true)
    })

    it("does not demand one for an ordinary rule-backed discount", async () => {
      const result = await settleDiscounts(
        stubClient([ruleRow({ requires_manager: false })]),
        [posted()],
        [line()],
        null,
      )
      expect("applied" in result).toBe(true)
    })
  })
})
