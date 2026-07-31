/**
 * The single definition of "low stock", shared by the products list, the
 * variant matrix and (later) the low-stock tab.
 *
 * This lives in its own module rather than in `queries.ts` because client
 * components need it: importing a *value* from `queries.ts` would pull the
 * server-only Supabase client into the browser bundle. Types are erased, so
 * `import type` from `queries.ts` stays fine.
 *
 * The spec defines the low-stock tab as `qty <= reorder_level`. Everything here
 * derives from that one rule so the list and the matrix can never drift apart.
 */

/** Nothing left to sell. */
export function isOutOfStock(qty: number): boolean {
  return qty <= 0
}

/**
 * The spec's low-stock rule, used for counts and the low-stock tab. Note this
 * is true for out-of-stock rows too — being at zero is the extreme case of
 * being at or below the reorder level.
 *
 * `reorder_level` defaults to 0, which means "no threshold set": such a variant
 * only qualifies once it actually hits zero.
 */
export function isAtOrBelowReorder(qty: number, reorderLevel: number): boolean {
  return qty <= reorderLevel
}

/**
 * Running low but not yet out — the amber state in the matrix. Out-of-stock is
 * shown separately (red), so the two are mutually exclusive on screen.
 */
export function isLowStock(qty: number, reorderLevel: number): boolean {
  return !isOutOfStock(qty) && isAtOrBelowReorder(qty, reorderLevel)
}
