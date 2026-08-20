import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rpcCalls: [] as [string, Record<string, unknown>][],
  productInsert: undefined as Record<string, unknown> | undefined,
  productUpdates: [] as Record<string, unknown>[],
  existingProduct: false,
  variantExists: false,
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/session", () => ({
  getSessionProfile: vi.fn(async () => ({
    id: "owner-1",
    role: "owner",
    isActive: true,
  })),
}))
vi.mock("@/lib/auth/roles", () => ({ canManageCatalog: vi.fn(() => true) }))
vi.mock("@/lib/barcodes/settings", () => ({
  allocateBarcodes: vi.fn(async () => ({ codes: [], error: null })),
}))

function variantSelect() {
  const filters: Record<string, unknown> = {}
  const query = {
    eq(column: string, value: unknown) {
      filters[column] = value
      return query
    },
    async limit() {
      const isCellLookup =
        "product_id" in filters && "size_id" in filters && "colour_id" in filters
      return {
        data: isCellLookup && mocks.variantExists ? [{ id: 20 }] : [],
        error: null,
      }
    },
  }
  return query
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "sizes") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({ data: [{ id: 1, label: "6" }], error: null })),
          })),
        }
      }
      if (table === "colours") {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({ data: [{ id: 2, name: "Blue" }], error: null })),
          })),
        }
      }
      if (table === "stock_locations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({
              data: [
                { id: 1, name: "Shop" },
                { id: 2, name: "Warehouse" },
              ],
              error: null,
            })),
          })),
        }
      }
      if (table === "products") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              ilike: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: mocks.existingProduct ? [{ id: 10 }] : [],
                  error: null,
                })),
              })),
            })),
          })),
          insert: vi.fn((values: Record<string, unknown>) => {
            mocks.productInsert = values
            return {
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { id: 10 }, error: null })),
              })),
            }
          }),
          update: vi.fn((values: Record<string, unknown>) => ({
            eq: vi.fn(async () => {
              mocks.productUpdates.push(values)
              return { error: null }
            }),
          })),
        }
      }
      if (table === "product_variants") {
        return {
          select: vi.fn(() => variantSelect()),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => {
                mocks.variantExists = true
                return { data: { id: 20 }, error: null }
              }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      mocks.rpcCalls.push([name, args])
      return { error: null }
    }),
  })),
}))

import { importChunk, type CommitRow } from "./actions"

describe("importChunk stock locations", () => {
  beforeEach(() => {
    mocks.rpcCalls.length = 0
    mocks.productInsert = undefined
    mocks.productUpdates.length = 0
    mocks.existingProduct = false
    mocks.variantExists = false
  })

  it("reuses one variant and records Shop and Warehouse stock separately", async () => {
    const common = {
      productName: "Chemise cotton",
      productCode: "PC-1023",
      categoryId: 3,
      brandId: null,
      gender: "unisex",
      sizeId: 1,
      colourId: 2,
      costPrice: 100,
      sellPrice: 250,
      barcode: "6291041500213",
      shelfLocation: "A12",
    } satisfies Omit<CommitRow, "rowNumber" | "quantity" | "location">

    const result = await importChunk([
      { ...common, rowNumber: 2, quantity: 10, location: "Shop" },
      { ...common, rowNumber: 3, quantity: 100, location: "Warehouse" },
    ])

    expect(result).toMatchObject({
      ok: true,
      productsCreated: 1,
      variantsCreated: 1,
      stockAdded: 110,
    })
    expect(mocks.productInsert).toMatchObject({
      shelf_location: "A12",
      product_code: "PC-1023",
    })
    expect(mocks.rpcCalls).toEqual([
      [
        "record_stock_movement_at",
        expect.objectContaining({ p_qty: 10, p_location_id: 1 }),
      ],
      [
        "record_stock_movement_at",
        expect.objectContaining({ p_qty: 100, p_location_id: 2 }),
      ],
    ])
  })

  it("updates an existing product when the imported shelf is non-empty", async () => {
    mocks.existingProduct = true
    mocks.variantExists = true

    const result = await importChunk([
      {
        rowNumber: 2,
        productName: "Chemise cotton",
        productCode: "PC-1023",
        categoryId: 3,
        brandId: null,
        gender: "unisex",
        sizeId: 1,
        colourId: 2,
        costPrice: 100,
        sellPrice: 250,
        quantity: 0,
        barcode: "6291041500213",
        shelfLocation: "A12",
        location: "Shop",
      },
    ])

    expect(result.ok).toBe(true)
    expect(mocks.productUpdates).toContainEqual({ shelf_location: "A12" })
    expect(mocks.productUpdates).toContainEqual({ product_code: "PC-1023" })
  })

  it("leaves an existing product's code untouched when the file has none", async () => {
    mocks.existingProduct = true
    mocks.variantExists = true

    const result = await importChunk([
      {
        rowNumber: 2,
        productName: "Chemise cotton",
        productCode: null,
        categoryId: 3,
        brandId: null,
        gender: "unisex",
        sizeId: 1,
        colourId: 2,
        costPrice: 100,
        sellPrice: 250,
        quantity: 0,
        barcode: "6291041500213",
        shelfLocation: null,
        location: "Shop",
      },
    ])

    expect(result.ok).toBe(true)
    expect(mocks.productUpdates).toEqual([])
  })
})
