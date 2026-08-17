import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const client = { from: vi.fn() }
  return {
    client,
    sessionResult: {
      supabase: client,
      user: { id: "cashier-1", name: "Marie", role: "cashier" },
    } as unknown,
    loadProductStock: vi.fn(),
  }
})

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: vi.fn(async () => mocks.sessionResult),
  apiError: (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), {
      status,
      headers: { "content-type": "application/json" },
    }),
}))
vi.mock("@/lib/pos/stock-check", () => ({
  loadProductStock: mocks.loadProductStock,
}))

import { GET } from "./route"

const get = (query = "") =>
  GET(new Request(`http://test/api/till/stock-check${query}`))

describe("GET /api/till/stock-check", () => {
  beforeEach(() => {
    mocks.sessionResult = {
      supabase: mocks.client,
      user: { id: "cashier-1", name: "Marie", role: "cashier" },
    }
    mocks.loadProductStock.mockReset()
  })

  it.each(["", "?productId=0", "?productId=-1", "?productId=1.5"])(
    "rejects an invalid product id: %s",
    async (query) => {
      const response = await get(query)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        ok: false,
        error: "Choose a product to check.",
      })
      expect(mocks.loadProductStock).not.toHaveBeenCalled()
    },
  )

  it("passes an authentication response through unchanged", async () => {
    mocks.sessionResult = {
      response: new Response(JSON.stringify({ ok: false, error: "Sign in first." }), {
        status: 401,
      }),
    }

    const response = await get("?productId=7")

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ ok: false, error: "Sign in first." })
    expect(mocks.loadProductStock).not.toHaveBeenCalled()
  })

  it("returns the grouped stock payload for a positive integer product", async () => {
    const locations = [
      {
        id: 1,
        name: "Shop",
        quantities: [{ variantId: 101, qty: 10 }],
      },
      { id: 2, name: "Warehouse", quantities: [] },
    ]
    mocks.loadProductStock.mockResolvedValue(locations)

    const response = await get("?productId=7")

    expect(response.status).toBe(200)
    expect(mocks.loadProductStock).toHaveBeenCalledWith(mocks.client, 7)
    expect(await response.json()).toEqual({ ok: true, productId: 7, locations })
  })
})
