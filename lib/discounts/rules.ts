import { round2 } from "@/lib/format"

/**
 * Discount evaluation, client-safe.
 *
 * A deliberate mirror of the `discount_amount_for` SQL function: the till has
 * to show a figure before the sale exists, and the database records the figure
 * that was agreed. If these two ever disagree a customer is quoted one price
 * and charged another, so the rules live in one shape and are checked against
 * each other by test rather than by hope.
 *
 * No server imports here — the POS cart is a client island.
 */

export type DiscountKind = "percent" | "amount"
export type DiscountScope = "sale" | "line"

export type DiscountRule = {
  id: number
  name: string
  code: string | null
  kind: DiscountKind
  value: number
  scope: DiscountScope
  categoryId: number | null
  minSpend: number
  maxAmount: number | null
  startsOn: string | null
  endsOn: string | null
  requiresManager: boolean
  isActive: boolean
}

/**
 * What a rule is worth against a base amount.
 *
 * Mirrors the SQL exactly: a percentage of the base, capped at the base itself
 * (a discount must never make a total negative) and at the rule's own ceiling.
 */
export function discountAmountFor(
  kind: DiscountKind,
  value: number,
  base: number,
  maxAmount: number | null = null,
): number {
  const safeBase = Number.isFinite(base) ? Math.max(0, base) : 0
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0

  const raw =
    kind === "percent" ? round2((safeBase * safeValue) / 100) : round2(safeValue)

  const cap = maxAmount === null ? Number.POSITIVE_INFINITY : maxAmount
  return Math.max(0, Math.min(raw, safeBase, cap))
}

/**
 * What a rule is measured against.
 *
 * `category_id` means "only applies to lines in this category" and `scope`
 * distinguishes a basket discount from a per-line one. Both are as old as
 * migration 005 and neither was honoured for a long time: every rule was
 * computed against the whole basket, so "10% off Babywear" took 10% off the
 * entire cart. That is the shop's money, on every sale wider than the category.
 *
 * Kept here, beside `discountAmountFor`, because the till previews a figure
 * before the sale exists and the server settles the one that is charged. If
 * those two pick different bases the customer is quoted one price and charged
 * another — so they call the same function.
 *
 * A line-scoped rule naming no category has no target at all: there is no line
 * in the payload for it to attach to and no category to stand in for one. That
 * returns null, and the caller refuses the sale rather than inventing a base.
 */
export function discountBaseFor(
  rule: Pick<DiscountRule, "scope" | "categoryId">,
  basket: number,
  categoryTotals: Map<number, number>,
): number | null {
  if (rule.categoryId === null) {
    return rule.scope === "line" ? null : Math.max(0, basket)
  }
  return Math.max(0, categoryTotals.get(rule.categoryId) ?? 0)
}

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string }

/**
 * Whether a rule may be used right now, against this basket.
 *
 * `today` is passed in rather than read from the clock so the caller controls
 * the timezone — the shop's calendar day, not the device's.
 */
export function checkEligibility(
  rule: DiscountRule,
  basketTotal: number,
  today: string,
): EligibilityResult {
  if (!rule.isActive) return { eligible: false, reason: "This discount is inactive." }

  // String comparison is safe and timezone-free: both sides are ISO dates.
  if (rule.startsOn && today < rule.startsOn) {
    return { eligible: false, reason: `Starts on ${rule.startsOn}.` }
  }
  if (rule.endsOn && today > rule.endsOn) {
    return { eligible: false, reason: `Expired on ${rule.endsOn}.` }
  }
  if (basketTotal < rule.minSpend) {
    return {
      eligible: false,
      reason: `Needs a spend of at least ${rule.minSpend.toFixed(2)}.`,
    }
  }
  return { eligible: true }
}

/** What gets frozen onto the sale when a rule is applied. */
export type AppliedDiscount = {
  discountId: number | null
  label: string
  kind: DiscountKind
  value: number
  amount: number
  approvedBy: string | null
}

export function applyRule(
  rule: DiscountRule,
  base: number,
  approvedBy: string | null = null,
): AppliedDiscount {
  return {
    discountId: rule.id,
    // Copied, not referenced: renaming the rule next month must not restate
    // what this receipt said.
    label: rule.name,
    kind: rule.kind,
    value: rule.value,
    amount: discountAmountFor(rule.kind, rule.value, base, rule.maxAmount),
    approvedBy,
  }
}

/** An off-the-cuff amount typed at the till, with no rule behind it. */
export function manualDiscount(amount: number, base: number): AppliedDiscount {
  return {
    discountId: null,
    label: "Manual discount",
    kind: "amount",
    value: round2(Math.max(0, amount)),
    amount: discountAmountFor("amount", amount, base, null),
    approvedBy: null,
  }
}
