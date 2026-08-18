import { describe, expect, it, vi } from "vitest"

import { commitSale, settleDiscounts, type TillClient,
  verifyApproval,
} from "./sale-core"
import { hashPin } from "./pin"

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

const MANAGER_ID = "11111111-1111-4111-8111-111111111111"

/**
 * Just enough client for the two queries `settleDiscounts` can make: the rules
 * it settles against, and — when something needs authorising — the manager
 * whose PIN is being checked.
 *
 * `managerPinHash` is passed in rather than hashed here so the tests stay
 * synchronous about it; `verifyPin` does the real PBKDF2 comparison.
 */
function stubClient(rules: Row[], managerPinHash: string | null = null): TillClient {
  return {
    from(table: string) {
      if (table === "discounts") {
        return {
          select: () => ({
            in: (_column: string, ids: number[]) => ({
              data: rules.filter((r) => ids.includes(r.id as number)),
              error: null,
            }),
          }),
        }
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => ({
                data: {
                  id: MANAGER_ID,
                  role: "manager",
                  is_active: true,
                  pin_code: managerPinHash,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
    // The lockout counter and its advance. Neither is what these tests are
    // about, so both answer "no wait".
    rpc: () => ({ data: 0, error: null }),
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
    expect(result).toEqual({
      applied: [],
      total: 0,
      // No approval was needed, so there is nobody to record.
      approvedBy: null,
      approvalReasons: [],
    })
  })

  it("reports who authorised a line discount, and what for", async () => {
    // A line discount produces no `sale_discounts` row, so this is the ONLY
    // thing that can name the manager who allowed it. Without it the shop
    // demanded a PIN and then kept no record that anyone had given one.
    const result = await settleDiscounts(
      stubClient([], await hashPin("1234")),
      [],
      [line({ discount: 200, lineTotal: 800 })],
      { managerId: MANAGER_ID, pin: "1234" },
    )

    expect("error" in result).toBe(false)
    if ("error" in result) return
    expect(result.applied).toEqual([])
    expect(result.approvedBy).toBe(MANAGER_ID)
    expect(result.approvalReasons).toEqual(["money off a line"])
  })

  it("reports a custom item as needing authorisation too", async () => {
    const result = await settleDiscounts(
      stubClient([], await hashPin("1234")),
      [],
      [line({ variantId: null })],
      { managerId: MANAGER_ID, pin: "1234" },
    )

    expect("error" in result).toBe(false)
    if ("error" in result) return
    expect(result.approvedBy).toBe(MANAGER_ID)
    expect(result.approvalReasons).toEqual(["a custom item"])
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

  /**
   * The four things an owner sets in the back office and then trusts the till
   * with. `checkEligibility` and `discountAmountFor` are each tested on their
   * own in lib/discounts/rules.test.ts — these prove the settlement actually
   * CONSULTS them, which is the wiring the shop's money depends on and which
   * a passing unit test says nothing about.
   *
   * Every one refuses rather than silently dropping the rule: the cashier put
   * it on the screen and quoted it to a customer, so the till has to say why
   * it cannot be honoured, not quietly charge full price.
   */
  describe("honours what the back office set on the rule", () => {
    it("refuses a rule under its minimum spend", async () => {
      const result = await settleDiscounts(
        stubClient([ruleRow({ name: "Back to school", min_spend: 1_000 })]),
        [posted()],
        [line({ lineTotal: 999 })],
        null,
      )
      if (!("error" in result)) throw new Error("should have refused")
      expect(result.error).toContain("Back to school")
      expect(result.error).toContain("1000.00")
    })

    it("accepts it at exactly the minimum", async () => {
      const result = await settleDiscounts(
        stubClient([ruleRow({ min_spend: 1_000 })]),
        [posted()],
        [line({ lineTotal: 1_000 })],
        null,
      )
      if (!("applied" in result)) throw new Error(result.error)
      expect(result.total).toBe(100)
    })

    it("refuses a rule that has expired", async () => {
      const result = await settleDiscounts(
        stubClient([ruleRow({ name: "Summer sale", ends_on: "2020-01-01" })]),
        [posted()],
        [line()],
        null,
      )
      if (!("error" in result)) throw new Error("should have refused")
      expect(result.error).toContain("Summer sale")
      expect(result.error).toContain("Expired on 2020-01-01")
    })

    it("refuses a rule that has not started", async () => {
      const result = await settleDiscounts(
        stubClient([ruleRow({ starts_on: "2999-01-01" })]),
        [posted()],
        [line()],
        null,
      )
      if (!("error" in result)) throw new Error("should have refused")
      expect(result.error).toContain("Starts on 2999-01-01")
    })

    it("refuses a rule switched off in the back office", async () => {
      const result = await settleDiscounts(
        stubClient([ruleRow({ is_active: false })]),
        [posted()],
        [line()],
        null,
      )
      if (!("error" in result)) throw new Error("should have refused")
      expect(result.error).toContain("inactive")
    })

    it("caps the amount at the rule's ceiling", async () => {
      // 10% of 20,000 is 2,000; the rule says never more than 500.
      const result = await settleDiscounts(
        stubClient([ruleRow({ value: 10, max_amount: 500 })]),
        [posted()],
        [line({ lineTotal: 20_000 })],
        null,
      )
      if (!("applied" in result)) throw new Error(result.error)
      expect(result.total).toBe(500)
      expect(result.applied[0].amount).toBe(500)
    })
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

// ─────────────────────────────────────────────── approving a return

/**
 * The same PIN check the till already uses for a discount, pointed at a refund.
 *
 * It matters that this is the SAME function and not a second one: a separate
 * implementation is where the lockout gets forgotten, or the PIN gets checked
 * before the role and a cashier's own PIN approves a cashier's own refund.
 */
function approverClient(
  role: string,
  pinHash: string | null,
  isActive = true,
): TillClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => ({
            data: { id: MANAGER_ID, role, is_active: isActive, pin_code: pinHash },
            error: null,
          }),
        }),
      }),
    }),
    rpc: () => ({ data: 0, error: null }),
  } as unknown as TillClient
}

describe("verifyApproval for a return", () => {
  it("names the act in words a cashier reads, not 'discount'", async () => {
    const result = await verifyApproval(approverClient("manager", null), null, "return")
    expect(result).toEqual({ error: "A manager needs to approve this return." })
  })

  it("accepts a manager's correct PIN and reports who it was", async () => {
    const hash = await hashPin("4321")
    const result = await verifyApproval(
      approverClient("manager", hash),
      { managerId: MANAGER_ID, pin: "4321" },
      "return",
    )
    expect(result).toEqual({ managerId: MANAGER_ID })
  })

  it("refuses a cashier before it ever looks at the PIN", async () => {
    // The order is the point. Checking the PIN first would let a cashier who
    // types their own PIN correctly approve their own refund.
    const hash = await hashPin("4321")
    const result = await verifyApproval(
      approverClient("cashier", hash),
      { managerId: MANAGER_ID, pin: "4321" },
      "return",
    )
    expect(result).toEqual({ error: "Only an owner or manager can approve a return." })
  })

  it("refuses a deactivated manager", async () => {
    const hash = await hashPin("4321")
    const result = await verifyApproval(
      approverClient("manager", hash, false),
      { managerId: MANAGER_ID, pin: "4321" },
      "return",
    )
    expect(result).toEqual({ error: "That account is deactivated." })
  })

  it("refuses a wrong PIN", async () => {
    const hash = await hashPin("4321")
    const result = await verifyApproval(
      approverClient("manager", hash),
      { managerId: MANAGER_ID, pin: "0000" },
      "return",
    )
    expect(result).toEqual({ error: "Wrong PIN." })
  })

  it("refuses anything that is not four digits without touching the database", async () => {
    const result = await verifyApproval(
      approverClient("manager", null),
      { managerId: MANAGER_ID, pin: "12" },
      "return",
    )
    expect(result).toEqual({ error: "Enter the manager's 4-digit PIN." })
  })

  it("still says 'discount' when that is what is being approved", async () => {
    const result = await verifyApproval(approverClient("manager", null), null)
    expect(result).toEqual({ error: "A manager needs to approve this discount." })
  })
})

// ─────────────────────────────── checkout policy snapshot

/**
 * A policy id is the only VAT fact a till is allowed to assert. The database
 * resolves the immutable row; the caller merely preserves which row and which
 * checkout instant belonged to this attempt. Regenerating that instant on a
 * retry can make a once-valid offline policy look future-dated, while calling
 * the old overloaded name silently assigns the legacy policy instead.
 */
function saleCommitClient(rpc: ReturnType<typeof vi.fn>): TillClient {
  return {
    from(table: string) {
      if (table !== "product_variants") throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          in: async () => ({
            data: [
              {
                id: 101,
                selling_price: 115,
                qty_on_hand: 5,
                is_active: true,
                products: { name: "VAT test item", category_id: 7 },
              },
            ],
            error: null,
          }),
        }),
      }
    },
    rpc,
  } as unknown as TillClient
}

describe("commitSale VAT policy handoff", () => {
  it("uses the distinct RPC and preserves the policy snapshot across a retry", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 801, error: null })
    const supabase = saleCommitClient(rpc)
    const input = {
      shiftId: 1,
      customerId: null,
      cashierId: "7691c64f-c80c-44a8-9777-f0adccd43753",
      discounts: [],
      items: [{ variantId: 101, qty: 1, discount: 0 }],
      payments: [{ method: "cash", amount: 115, tendered: 115 }],
      idempotencyKey: "vat-policy-retry-801",
      vatPolicyId: 42,
      checkedOutAt: "2026-08-18T08:30:00.000Z",
    }

    await commitSale(
      supabase,
      { id: "7691c64f-c80c-44a8-9777-f0adccd43753", name: "Marie" },
      input,
    )
    await commitSale(
      supabase,
      { id: "7691c64f-c80c-44a8-9777-f0adccd43753", name: "Marie" },
      input,
    )

    const saleCalls = rpc.mock.calls.filter(([name]) =>
      String(name).startsWith("complete_sale"),
    )
    expect(saleCalls).toEqual([
      [
        "complete_sale_keyed_at_policy",
        expect.objectContaining({
          p_key: "vat-policy-retry-801",
          p_vat_policy_id: 42,
          p_checked_out_at: "2026-08-18T08:30:00.000Z",
        }),
      ],
      [
        "complete_sale_keyed_at_policy",
        expect.objectContaining({
          p_key: "vat-policy-retry-801",
          p_vat_policy_id: 42,
          p_checked_out_at: "2026-08-18T08:30:00.000Z",
        }),
      ],
    ])
  })
})
