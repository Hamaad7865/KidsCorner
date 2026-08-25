import { describe, expect, it, vi } from "vitest"

import type { TillClient } from "./sale-core"
import { loadCatalog } from "./queries"

describe("loadCatalog", () => {
  it("maps the product shelf location and product code onto each cached variant", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.order.mockReturnValue(query)
    query.range.mockResolvedValue({
      data: [
        {
          id: 101,
          sku: "CHEM-6-BLUE",
          barcode: "6291041500213",
          selling_price: 250,
          qty_on_hand: 110,
          products: {
            id: 7,
            name: "Chemise cotton",
            is_active: true,
            category_id: 3,
            image_url: null,
            shelf_location: "A12",
            product_code: "PC-1023",
            categories: { name: "T-Shirts" },
          },
          sizes: { label: "6", sort_order: 6 },
          colours: { name: "Blue", hex_code: "#0000FF" },
        },
      ],
      error: null,
    })

    // The promotions read resolves immediately: no live markdowns.
    const promos = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }

    const client = {
      from: vi.fn((table: string) => (table === "promotions" ? promos : query)),
    } as unknown as TillClient

    const [variant] = await loadCatalog(client)

    expect(variant).toMatchObject({
      productId: 7,
      productName: "Chemise cotton",
      shelfLocation: "A12",
      productCode: "PC-1023",
      onPromotion: false,
      promoWasPrice: null,
    })
  })

  it("marks the variants carrying a live promotion, with what they were", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      range: vi.fn(),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.order.mockReturnValue(query)
    query.range.mockResolvedValue({
      data: [
        { id: 101, sku: "A", selling_price: 199, qty_on_hand: 3, products: { id: 7 }, sizes: {}, colours: {} },
        { id: 102, sku: "B", selling_price: 340, qty_on_hand: 5, products: { id: 8 }, sizes: {}, colours: {} },
      ],
      error: null,
    })
    const promos = {
      select: vi.fn().mockReturnThis(),
      eq: vi
        .fn()
        .mockResolvedValue({
          data: [{ variant_id: 101, original_price: 250 }],
          error: null,
        }),
    }

    const client = {
      from: vi.fn((table: string) => (table === "promotions" ? promos : query)),
    } as unknown as TillClient

    const variants = await loadCatalog(client)

    expect(variants[0]).toMatchObject({ onPromotion: true, promoWasPrice: 250 })
    expect(variants[1]).toMatchObject({ onPromotion: false, promoWasPrice: null })
  })
})
