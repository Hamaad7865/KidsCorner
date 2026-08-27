import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The exchange route's settlement and idempotency plumbing.
 *
 * Worth a test because both are invisible from either side on their own: the
 * gap this route reports back is read from sale_payments after the RPC
 * commits, not computed here, and the idempotency key it forwards is what
 * makes a retried exchange safe rather than a second one.
 */

const session = {
  supabase: { rpc: vi.fn(), from: vi.fn() },
  user: { id: "cashier-1", name: "Marie", role: "cashier" },
}

let shiftGate: { ok: true } | { ok: false; error: string } = { ok: true }
let approvalResult: { managerId: string } | { error: string } = { managerId: "mgr-1" }
let paymentRows: { amount: number }[] = [{ amount: 60 }]

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: async () => session,
  apiError: (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), { status }),
}))
vi.mock("@/lib/pos/shift-core", () => ({
  assertShiftOpenFor: async () => shiftGate,
}))
vi.mock("@/lib/pos/sale-core", () => ({
  verifyApproval: async () => approvalResult,
}))

const { POST } = await import("./route")

const body = (over: Record<string, unknown> = {}) => ({
  saleId: 7,
  shiftId: 15,
  paymentMethod: "cash",
  tendered: 60,
  idempotencyKey: "exchange-key-1",
  returnItems: [{ saleItemId: 162, qty: 1 }],
  newItems: [{ variantId: 34, qty: 1 }],
  ...over,
})

const post = async (payload: Record<string, unknown>) => {
  const response = await POST(
    new Request("http://t/api/till/exchange", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  )
  return response.json()
}

beforeEach(() => {
  shiftGate = { ok: true }
  approvalResult = { managerId: "mgr-1" }
  paymentRows = [{ amount: 60 }]
  session.supabase.rpc = vi.fn().mockResolvedValue({ data: 21, error: null })
  // Two tables get read: `sales`, for the 7-day-window age check (via
  // .maybeSingle()), and `sale_payments`, for the settled-gap readback (via a
  // bare, thenable .eq()). A recent sale_date here keeps every test below the
  // manager-approval branch unless it says otherwise.
  session.supabase.from = vi.fn().mockImplementation((table: string) => {
    if (table === "sales") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { sale_date: new Date().toISOString() } }),
          }),
        }),
      }
    }
    return {
      select: () => ({
        eq: async () => ({ data: paymentRows, error: null }),
      }),
    }
  })
})

describe("the idempotency key", () => {
  it("forwards it to create_exchange_keyed as p_key", async () => {
    await post(body())
    expect(session.supabase.rpc).toHaveBeenCalledWith(
      "create_exchange_keyed",
      expect.objectContaining({ p_key: "exchange-key-1" }),
    )
  })

  it("still works when an older client sends none at all", async () => {
    const json = await post(body({ idempotencyKey: undefined }))
    expect(json.ok).toBe(true)
    expect(session.supabase.rpc).toHaveBeenCalledWith(
      "create_exchange_keyed",
      expect.objectContaining({ p_key: null }),
    )
  })
})

describe("the settled gap", () => {
  it("reports a trade-up gap as a positive number", async () => {
    paymentRows = [{ amount: 60 }]
    const json = await post(body())
    expect(json).toEqual({ ok: true, saleId: 21, gap: 60 })
  })

  it("reports a trade-down refund as a negative number", async () => {
    paymentRows = [{ amount: -50 }]
    const json = await post(body({ paymentMethod: "cash", tendered: null }))
    expect(json).toEqual({ ok: true, saleId: 21, gap: -50 })
  })
})

describe("cash without a tendered figure", () => {
  it("is no longer rejected before reaching the database", async () => {
    // The route cannot know ahead of the RPC whether this settles as a
    // trade-up (needs tendered) or a refund (does not) without duplicating
    // create_exchange's own pricing - so it stops guessing and lets the RPC
    // default it.
    const json = await post(body({ paymentMethod: "cash", tendered: null }))
    expect(json.ok).toBe(true)
    expect(session.supabase.rpc).toHaveBeenCalled()
  })
})

describe("manager approval, unchanged", () => {
  it("never reaches the database when approval fails", async () => {
    approvalResult = { error: "Wrong PIN." }
    // ageDays > 7 is required to trigger the approval branch; simulate it by
    // having the sale-age lookup (session.supabase.from("sales")...) return an
    // old date instead of the payment-rows shape used elsewhere.
    session.supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === "sales") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { sale_date: "2020-01-01T00:00:00Z" } }),
            }),
          }),
        }
      }
      return { select: () => ({ eq: async () => ({ data: paymentRows, error: null }) }) }
    })

    const json = await post(body())
    expect(json).toEqual({
      ok: false,
      error: "Wrong PIN.",
      needsApproval: true,
    })
    expect(session.supabase.rpc).not.toHaveBeenCalled()
  })
})
