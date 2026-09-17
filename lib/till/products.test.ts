import { describe, expect, it, vi } from "vitest"

import {
  generateTillBarcodes,
  updateTillProduct,
  updateTillVariant,
} from "./products"

/**
 * A query builder that answers from a script.
 *
 * Each `from(table)` pops the next canned response for that table, so a test
 * declares exactly the round trips its call performs: reads first, then
 * writes. Anything unscripted throws, which fails the test rather than
 * passing against a silent undefined.
 */
type Canned = { data?: unknown; error?: { code?: string; message: string } | null }

function stubDb(scripts: Record<string, Canned[]>) {
  const auditCalls: { type: string; summary: string }[] = []
  let table = ""
  // Like the real builder, the chain itself is thenable: awaiting it runs
  // the query. Every intermediate method just returns the chain.
  const chain = new Proxy(
    {},
    {
      get: (_t, prop: string | symbol) => {
        if (prop === "then") {
          return (resolve: (value: unknown) => void) => {
            const next = scripts[table]?.shift()
            if (!next) throw new Error(`Unscripted query against ${table}`)
            resolve({ data: next.data ?? null, error: next.error ?? null })
          }
        }
        return () => chain
      },
    },
  )
  const db = {
    from: (name: string) => {
      table = name
      return chain
    },
    rpc: vi.fn(async () => ({ data: 41, error: null })),
  }
  const audit = {
    rpc: vi.fn(async (_fn: string, opts: Record<string, unknown>) => {
      auditCalls.push({
        type: String(opts.p_event_type),
        summary: String(opts.p_summary),
      })
      return { data: null, error: null }
    }),
  }
  return { db, audit, auditCalls }
}

const BASE_PATCH = {
  sellingPrice: 450,
  reorderLevel: 2,
  isActive: true,
}

describe("updateTillVariant", () => {
  it("refuses a negative price with the web matrix's message", async () => {
    const { db, audit } = stubDb({})
    const result = await updateTillVariant({
      db: db as never,
      audit: audit as never,
      actorName: "Marie",
      actorRole: "cashier",
      variantId: 9,
      patch: { ...BASE_PATCH, sellingPrice: -5 },
    })
    expect(result).toEqual({
      ok: false,
      error: "Price cannot be negative.",
      field: "sellingPrice",
    })
  })

  it("refuses a cashier's cost change rather than silently dropping it", async () => {
    const { db, audit } = stubDb({})
    const result = await updateTillVariant({
      db: db as never,
      audit: audit as never,
      actorName: "Marie",
      actorRole: "cashier",
      variantId: 9,
      patch: { ...BASE_PATCH, costPrice: 100 },
    })
    expect(result).toEqual({
      ok: false,
      error: "Only an owner or manager can change the cost price.",
      field: "costPrice",
    })
  })

  it("saves a manager's price and audits it under the actor's name", async () => {
    const { db, audit, auditCalls } = stubDb({
      product_variants: [
        { data: { sku: "7-RED-M", cost_price: 200, selling_price: 400, product_id: 7 } },
        { data: [{ id: 9 }] },
      ],
    })
    const result = await updateTillVariant({
      db: db as never,
      audit: audit as never,
      actorName: "Marie",
      actorRole: "manager",
      variantId: 9,
      patch: { ...BASE_PATCH, costPrice: 210 },
    })
    expect(result).toEqual({ ok: true })
    expect(auditCalls.map((c) => c.type).sort()).toEqual(["cost.changed", "price.changed"])
    expect(auditCalls[0].summary).toContain("Marie")
  })

  it("names the garment holding a clashing barcode", async () => {
    const { db, audit } = stubDb({
      product_variants: [
        { data: { sku: "7-RED-M", cost_price: 200, selling_price: 450, product_id: 7 } },
        {
          data: {
            id: 12,
            products: { name: "Robe Fleur" },
            colours: { name: "Blue" },
            sizes: { label: "4y" },
          },
        },
      ],
    })
    const result = await updateTillVariant({
      db: db as never,
      audit: audit as never,
      actorName: "Marie",
      actorRole: "manager",
      variantId: 9,
      patch: { ...BASE_PATCH, barcode: "6291041000411" },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.field).toBe("barcode")
      expect(result.error).toContain("Robe Fleur")
    }
  })
})

describe("updateTillProduct", () => {
  it("requires a name", async () => {
    const { db, audit } = stubDb({})
    const result = await updateTillProduct({
      db: db as never,
      audit: audit as never,
      actorName: "Marie",
      productId: 7,
      patch: { name: "  ", productCode: "PC-1", shelfLocation: null, isActive: true },
    })
    expect(result).toEqual({ ok: false, error: "Product name is required.", field: "name" })
  })
})

describe("generateTillBarcodes", () => {
  it("issues to blank and invalid codes, never to valid ones", async () => {
    const { db } = stubDb({
      product_variants: [
        {
          data: [
            { id: 1, barcode: null },
            { id: 2, barcode: "6291041000416" },
            { id: 3, barcode: "123" },
          ],
        },
        { data: [{ id: 1 }] },
        { data: [{ id: 3 }] },
      ],
      settings: [
        {
          data: [
            { key: "barcode_auto", value: true },
            { key: "barcode_prefix", value: "6291041" },
            { key: "barcode_next", value: 41 },
          ],
        },
      ],
    })
    const result = await generateTillBarcodes(db as never, [1, 2, 3])
    expect(result).toMatchObject({ written: 2, skippedValid: 1, error: null })
  })
})
