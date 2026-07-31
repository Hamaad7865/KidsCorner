import { round2 } from "@/lib/format"

/**
 * Split-payment arithmetic for the till.
 *
 * Pure, and out here rather than inside the payment panel, for the same reason
 * `sale-core` exists: this decides what the shop records as taken, and code
 * that decides money should be testable without rendering anything.
 */

/**
 * Generic over the method so a caller's narrow union — "cash" | "card" | … —
 * survives. Widening it to `string` here would quietly let an unknown method
 * reach `commitSale`, which validates against the union and would refuse the
 * sale at the counter instead of at the keyboard.
 */
export type Payment<M extends string = string> = {
  method: M
  amount: number
  tendered: number | null
}

/**
 * The rows after taking `amount` by `method`.
 *
 * The clamp is measured against `current` — the rows being updated — and never
 * against a balance captured earlier. Two takes landing in one React batch
 * would otherwise both measure against the same stale figure and between them
 * record more than the sale is worth, which inflates the Z's cash line and
 * leaves the drawer looking short. Nothing downstream catches that:
 * `commitSale` checks for UNDER-payment, not over.
 *
 * Returns `current` unchanged when the sale is already covered, so a stray
 * second press is a no-op rather than a phantom row.
 */
export function withPayment<M extends string>(
  current: Payment<M>[],
  saleTotal: number,
  method: M,
  amount: number,
  tendered: number | null,
): Payment<M>[] {
  if (!(amount > 0)) return current

  const paidSoFar = round2(current.reduce((sum, p) => sum + p.amount, 0))
  const remaining = round2(Math.max(0, saleTotal - paidSoFar))
  if (remaining <= 0) return current

  // Anything beyond what is owed is change, not revenue.
  return [...current, { method, amount: round2(Math.min(amount, remaining)), tendered }]
}

/**
 * Change handed back.
 *
 * Only cash produces change, and over-tendering on one row does not offset
 * another — a customer who hands over a note for part of a split does not get
 * the card portion back in coins.
 */
export function changeDue(payments: Payment<string>[]): number {
  const cash = payments.filter((p) => p.method === "cash")
  const tendered = cash
    .filter((p) => p.tendered !== null)
    .reduce((sum, p) => sum + (p.tendered ?? 0), 0)
  const owed = cash.reduce((sum, p) => sum + p.amount, 0)
  return round2(Math.max(0, tendered - owed))
}

/** What is still owed on the sale. */
export function outstandingOn(payments: Payment<string>[], saleTotal: number): number {
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0))
  return round2(Math.max(0, saleTotal - paid))
}
