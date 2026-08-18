import { describe, expect, it } from "vitest"

import { groupStockByLocation } from "./stock-check"

describe("groupStockByLocation", () => {
  it("keeps every active location when only one has a balance", () => {
    const result = groupStockByLocation(
      [
        { id: 1, name: "Shop floor" },
        { id: 2, name: "Warehouse" },
      ],
      [{ location_id: 1, variant_id: 101, qty_on_hand: 10 }],
    )

    expect(result).toEqual([
      {
        id: 1,
        name: "Shop floor",
        quantities: [{ variantId: 101, qty: 10 }],
      },
      { id: 2, name: "Warehouse", quantities: [] },
    ])
  })

  it("ignores incomplete view rows and treats a null balance as zero", () => {
    const result = groupStockByLocation(
      [
        { id: 1, name: "Shop" },
        { id: null, name: "Broken" },
      ],
      [
        { location_id: 1, variant_id: 101, qty_on_hand: null },
        { location_id: null, variant_id: 102, qty_on_hand: 5 },
        { location_id: 1, variant_id: null, qty_on_hand: 8 },
      ],
    )

    expect(result).toEqual([
      {
        id: 1,
        name: "Shop",
        quantities: [{ variantId: 101, qty: 0 }],
      },
    ])
  })
})
