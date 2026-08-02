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
 * leaves the drawer looking short.
 *
 * `commitSale` now refuses an over-payment as well as an under-payment, so
 * this is no longer the only thing standing between a stray double-press and a
 * wrong Z — but it is still what keeps the panel's arithmetic right, and the
 * clamp is what makes the second press a no-op instead of an error.
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
 *
 * Measured PER ROW, which is what that sentence has always meant and what the
 * tablet till has always done. It used to total the tendered figures and
 * subtract the total cash owed, and those two differ the moment one cash row
 * carries no tendered figure: its amount was subtracted from another row's
 * note. Two cash rows of Rs 500, one taken without a tendered figure and one
 * paid with a Rs 1,000 note, came out as no change due instead of Rs 500.
 *
 * Nothing writes that shape today — both tills always record a tendered
 * figure on cash — so this is a latent disagreement rather than a wrong
 * receipt in the wild. It is still worth being the same answer as the tablet,
 * because this is the function that exists to BE the answer.
 */
export function changeDue(payments: Payment<string>[]): number {
  const given = payments
    .filter((p) => p.method === "cash" && p.tendered !== null)
    .reduce((sum, p) => sum + Math.max(0, (p.tendered ?? 0) - p.amount), 0)
  return round2(given)
}

/** What is still owed on the sale. */
export function outstandingOn(payments: Payment<string>[], saleTotal: number): number {
  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0))
  return round2(Math.max(0, saleTotal - paid))
}
