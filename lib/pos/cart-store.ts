import { create } from "zustand"

import type { AppliedDiscount } from "@/lib/discounts/rules"
import { round2 } from "@/lib/format"
import type { CatalogVariant } from "./queries"

/**
 * Cart state for the till.
 *
 * Entirely client-side by design: per the spec the network is only needed at
 * `complete_sale`, so a dropped connection mid-sale must not lose the basket.
 * Zustand's store is module-scoped, which also means it survives client-side
 * navigation within the POS.
 */

export type CartLine = {
  variantId: number
  productName: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  sku: string
  unitPrice: number
  qty: number
  /** Money off this line, not a percentage. */
  discount: number
  qtyOnHand: number
}

export type CartTotals = {
  subtotal: number
  lineDiscounts: number
  saleDiscount: number
  total: number
  vat: number
  itemCount: number
}

/**
 * A parked cart. Held sales are local to the device on purpose (spec): parking
 * one is a "hold this while I fetch another size" action, not something another
 * till should see.
 */
export type HeldSale = {
  id: string
  label: string
  heldAt: number
  lines: CartLine[]
  saleDiscount: number
  /**
   * Carried with the basket, not left behind.
   *
   * `saleDiscount` is only the sum of these, and `applyDiscount` recomputes it
   * from this list. Parking the money without the rules behind it meant that
   * resuming and then applying anything else recomputed the total from a list
   * that had lost its history — silently wiping the discount the customer was
   * already quoted.
   */
  appliedDiscounts: AppliedDiscount[]
  customerId: number | null
  customerName: string | null
}

type CartState = {
  lines: CartLine[]
  customerId: number | null
  customerName: string | null
  saleDiscount: number
  /**
   * Set when a sale was submitted and the till never learned the outcome.
   *
   * The sale carries an idempotency key, so pressing Confirm again replays it
   * and can never charge twice. That safety holds only while the basket is
   * IDENTICAL: a retry under the same key with different lines would replay the
   * original sale, charging the customer for what they first had while the
   * screen shows something else. So the basket freezes until the attempt is
   * resolved one way or the other.
   */
  settleFrozen: boolean
  /** PIN-selected cashier; null means the session user owns the sale. */
  cashierId: string | null
  cashierName: string | null
  held: HeldSale[]
  /**
   * Named rules applied to this basket. `saleDiscount` stays the single money
   * figure the totals use — this is the record of where that figure came from,
   * and it is what gets frozen onto the sale.
   */
  appliedDiscounts: AppliedDiscount[]
  /** Called when a settle's outcome is unknown. Blocks every basket change. */
  freezeForSettle: () => void
  /** Called when the attempt resolves — completed, or explicitly abandoned. */
  thawSettle: () => void
  applyDiscount: (discount: AppliedDiscount) => void
  removeDiscount: (index: number) => void
  addVariant: (variant: CatalogVariant) => void
  setQty: (variantId: number, qty: number) => void
  setLineDiscount: (variantId: number, discount: number) => void
  remove: (variantId: number) => void
  setSaleDiscount: (amount: number) => void
  setCustomer: (id: number | null, name: string | null) => void
  setCashier: (id: string | null, name: string | null) => void
  holdSale: (label: string) => void
  resumeSale: (id: string) => void
  dropHeld: (id: string) => void
  clear: () => void
}

export const useCart = create<CartState>((set) => ({
  lines: [],
  customerId: null,
  customerName: null,
  saleDiscount: 0,
  cashierId: null,
  cashierName: null,
  held: [],
  appliedDiscounts: [],
  settleFrozen: false,

  freezeForSettle: () => set({ settleFrozen: true }),
  thawSettle: () => set({ settleFrozen: false }),

  setCashier: (cashierId, cashierName) => set({ cashierId, cashierName }),

  applyDiscount: (discount) =>
    set((state) => {
      if (state.settleFrozen) return state
      // One application per rule: stacking the same offer twice is almost
      // always a mis-tap, and the manual amount has a null id so it is exempt.
      if (
        discount.discountId !== null &&
        state.appliedDiscounts.some((d) => d.discountId === discount.discountId)
      ) {
        return state
      }
      const next = [...state.appliedDiscounts, discount]
      return {
        appliedDiscounts: next,
        saleDiscount: round2(next.reduce((sum, d) => sum + d.amount, 0)),
      }
    }),

  removeDiscount: (index) =>
    set((state) => {
      if (state.settleFrozen) return state
      const next = state.appliedDiscounts.filter((_, i) => i !== index)
      return {
        appliedDiscounts: next,
        saleDiscount: round2(next.reduce((sum, d) => sum + d.amount, 0)),
      }
    }),

  holdSale: (label) =>
    set((state) => {
      // Parking a frozen basket would take it out of sight while the sale it
      // belongs to is still unresolved.
      if (state.settleFrozen || state.lines.length === 0) return state
      return {
        held: [
          ...state.held,
          {
            // Date.now plus a counter: two holds in the same millisecond would
            // otherwise collide and the second would overwrite the first.
            id: `${Date.now()}-${state.held.length}`,
            label,
            heldAt: Date.now(),
            lines: state.lines,
            saleDiscount: state.saleDiscount,
            appliedDiscounts: state.appliedDiscounts,
            customerId: state.customerId,
            customerName: state.customerName,
          },
        ],
        lines: [],
        saleDiscount: 0,
        appliedDiscounts: [],
        customerId: null,
        customerName: null,
      }
    }),

  resumeSale: (id) =>
    set((state) => {
      if (state.settleFrozen) return state
      const found = state.held.find((h) => h.id === id)
      if (!found) return state
      // The current cart is parked rather than discarded, so resuming can never
      // silently lose whatever was already scanned.
      const parked: HeldSale[] =
        state.lines.length > 0
          ? [
              {
                // Suffixed with the held count as well as the clock: two swaps
                // inside the same millisecond would otherwise share an id, and
                // the second would overwrite the first.
                id: `${Date.now()}-swap-${state.held.length}`,
                label: "Swapped out",
                heldAt: Date.now(),
                lines: state.lines,
                saleDiscount: state.saleDiscount,
                appliedDiscounts: state.appliedDiscounts,
                customerId: state.customerId,
                customerName: state.customerName,
              },
            ]
          : []

      return {
        lines: found.lines,
        saleDiscount: found.saleDiscount,
        // Restored alongside the money, so the next applyDiscount recomputes
        // from the full list rather than from an empty one.
        appliedDiscounts: found.appliedDiscounts ?? [],
        customerId: found.customerId,
        customerName: found.customerName,
        held: [...state.held.filter((h) => h.id !== id), ...parked],
      }
    }),

  dropHeld: (id) => set((state) => ({ held: state.held.filter((h) => h.id !== id) })),

  addVariant: (variant) =>
    set((state) => {
      if (state.settleFrozen) return state
      const index = state.lines.findIndex((l) => l.variantId === variant.id)
      if (index >= 0) {
        const lines = [...state.lines]
        lines[index] = { ...lines[index], qty: lines[index].qty + 1 }
        return { lines }
      }
      return {
        lines: [
          ...state.lines,
          {
            variantId: variant.id,
            productName: variant.productName,
            sizeLabel: variant.sizeLabel,
            colourName: variant.colourName,
            colourHex: variant.colourHex,
            sku: variant.sku,
            unitPrice: variant.price,
            qty: 1,
            discount: 0,
            qtyOnHand: variant.qtyOnHand,
          },
        ],
      }
    }),

  setQty: (variantId, qty) =>
    set((state) =>
      state.settleFrozen
        ? state
        : {
            // Dropping to zero removes the line — the stepper's minus button is
            // the fastest way to undo a mis-scan.
            lines:
              qty <= 0
                ? state.lines.filter((l) => l.variantId !== variantId)
                : state.lines.map((l) =>
                    l.variantId === variantId ? { ...l, qty } : l,
                  ),
          },
    ),

  setLineDiscount: (variantId, discount) =>
    set((state) =>
      state.settleFrozen
        ? state
        : {
            lines: state.lines.map((l) =>
              l.variantId === variantId
                ? // Never let a discount exceed the line, which would make the
                  // sale total go backwards.
                  {
                    ...l,
                    discount: Math.min(Math.max(0, discount), l.unitPrice * l.qty),
                  }
                : l,
            ),
          },
    ),

  remove: (variantId) =>
    set((state) =>
      state.settleFrozen
        ? state
        : { lines: state.lines.filter((l) => l.variantId !== variantId) },
    ),

  setSaleDiscount: (amount) =>
    set((state) =>
      state.settleFrozen ? state : { saleDiscount: Math.max(0, amount) },
    ),

  // The customer is on the sale too — swapping who it bills mid-settle would
  // send a different sale under the same key.
  setCustomer: (customerId, customerName) =>
    set((state) => (state.settleFrozen ? state : { customerId, customerName })),

  // Deliberately leaves `held` and the active cashier alone: finishing one sale
  // must not discard someone else's parked basket or sign the cashier out.
  //
  // Clears the freeze too, because the only callers are a completed sale and an
  // explicit abandon — both of which end the attempt this basket belonged to.
  clear: () =>
    set({
      lines: [],
      saleDiscount: 0,
      appliedDiscounts: [],
      customerId: null,
      customerName: null,
      settleFrozen: false,
    }),
}))

/**
 * Totals. Prices are VAT-inclusive (spec), so VAT is extracted from the total
 * rather than added — mirroring what `complete_sale` stores.
 */
export function cartTotals(
  lines: CartLine[],
  saleDiscount: number,
  vatRate: number,
): CartTotals {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0))
  const lineDiscounts = round2(lines.reduce((sum, l) => sum + l.discount, 0))
  // The sale-level discount cannot take the total below zero.
  const afterLines = round2(subtotal - lineDiscounts)
  const applied = Math.min(saleDiscount, afterLines)
  const total = round2(afterLines - applied)

  return {
    subtotal,
    lineDiscounts,
    saleDiscount: round2(applied),
    total,
    vat: round2(total - total / (1 + vatRate)),
    itemCount: lines.reduce((sum, l) => sum + l.qty, 0),
  }
}
