import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The refund route's approval branch.
 *
 * Worth a test because two things here are invisible from either side on its
 * own: the Android till decodes `needsApproval` out of this JSON to decide
 * whether to raise the manager prompt, and the approver id passed to the RPC
 * must be the one `verifyApproval` returned rather than anything the client
 * sent. A rename on either side is silent until a shop turns the setting on.
 */

const session = {
  supabase: { rpc: vi.fn(), from: vi.fn() },
  user: { id: "cashier-1", name: "Marie", role: "cashier" },
}

let requiresManager = false
let approvalResult: { managerId: string } | { error: string } = { managerId: "mgr-1" }

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: async () => session,
  apiError: (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), { status }),
}))
vi.mock("@/lib/pos/queries", () => ({
  getRefundRequiresManager: async () => requiresManager,
}))
vi.mock("@/lib/pos/sale-core", () => ({
  verifyApproval: async () => approvalResult,
}))

const { POST } = await import("./route")

const body = (over: Record<string, unknown> = {}) => ({
  saleId: 7,
  shiftId: 15,
  reason: "Wrong size",
  refundMethod: "cash",
  restock: true,
  items: [{ saleItemId: 162, qty: 1 }],
  ...over,
})

const post = async (payload: Record<string, unknown>) => {
  const response = await POST(
    new Request("http://t/api/till/refund", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  )
  return response.json()
}

beforeEach(() => {
  requiresManager = false
  approvalResult = { managerId: "mgr-1" }
  session.supabase.rpc = vi.fn().mockResolvedValue({ data: 21, error: null })
  session.supabase.from = vi.fn().mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            credit_no: "CN0001",
            total: 250,
            refund_method: "cash",
            vat_policy_id: 17,
            vat_enabled: true,
            vat_rate: 0.15,
            vat_number: "VAT-123",
            vat_amount: 32.61,
          },
        }),
      }),
    }),
  })
})

describe("when the shop does not ask for a manager", () => {
  it("refunds without one, and sends no approver", async () => {
    const json = await post(body())
    expect(json.ok).toBe(true)
    expect(json.creditNo).toBe("CN0001")
    expect(session.supabase.rpc).toHaveBeenCalledWith(
      "create_credit_note",
      expect.objectContaining({ p_approved_by: null }),
    )
  })
})

describe("when the shop asks for a manager", () => {
  beforeEach(() => {
    requiresManager = true
  })

  it("refuses with the flag the till watches for", async () => {
    // `needsApproval` is the whole contract with the Android client. Renaming
    // it would leave the till showing a bare error and never prompting.
    approvalResult = { error: "A manager needs to approve this return." }
    const json = await post(body())

    expect(json).toEqual({
      ok: false,
      error: "A manager needs to approve this return.",
      needsApproval: true,
    })
  })

  it("never reaches the database when approval fails", async () => {
    // Checked before the RPC on purpose: the RPC would refuse too, but only
    // after taking the sale's row lock and reading every line.
    approvalResult = { error: "Wrong PIN." }
    await post(body())
    expect(session.supabase.rpc).not.toHaveBeenCalled()
  })

  it("passes the id verifyApproval returned, not one the client sent", async () => {
    // A real v4 UUID. `z.uuid()` checks the RFC 4122 version and variant
    // nibbles, not just the shape, so a hand-made string of 1s is rejected —
    // which is correct, and worth knowing before writing a fixture.
    approvalResult = { managerId: "mgr-1" }
    const json = await post(
      body({
        approval: { managerId: "7691c64f-c80c-44a8-9777-f0adccd43753", pin: "4321" },
      }),
    )

    expect(json.ok).toBe(true)
    expect(session.supabase.rpc).toHaveBeenCalledWith(
      "create_credit_note",
      expect.objectContaining({ p_approved_by: "mgr-1" }),
    )
  })
})

describe("the payload it accepts", () => {
  it("returns the credit note's frozen VAT snapshot to the till", async () => {
    const json = await post(body())

    expect(json).toMatchObject({
      ok: true,
      vatPolicyId: 17,
      vatEnabled: true,
      vatRate: 0.15,
      vatNumber: "VAT-123",
      vatAmount: 32.61,
    })
  })

  it("merges two lines naming the same sale item", async () => {
    // Each would pass the RPC's already-returned check alone and together
    // exceed what was sold, refunding the line twice.
    await post(
      body({
        items: [
          { saleItemId: 162, qty: 1 },
          { saleItemId: 162, qty: 2 },
        ],
      }),
    )
    expect(session.supabase.rpc).toHaveBeenCalledWith(
      "create_credit_note",
      expect.objectContaining({ p_items: [{ sale_item_id: 162, qty: 3 }] }),
    )
  })

  it("still takes a request with no approval field at all", async () => {
    // An older till build predates the setting entirely.
    const json = await post(body())
    expect(json.ok).toBe(true)
  })

  it("rejects a return with no reason", async () => {
    const json = await post(body({ reason: "  " }))
    expect(json.ok).toBe(false)
    expect(session.supabase.rpc).not.toHaveBeenCalled()
  })
})
