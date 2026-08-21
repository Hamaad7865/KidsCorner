import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The till's customer-creation route, specifically its `openAccount` branch.
 *
 * Opening a credit account here needs a manager because the shop's credit has
 * no ceiling any more — see the credit-limit-removal migration. Worth a test
 * for the same reason the refund route has one: `needsApproval` is a contract
 * with the Android client, and the approver id written to the audit log must
 * be the one `verifyApproval` returned, not whatever the client sent.
 */

const session = {
  supabase: { from: vi.fn() },
}

let approvalResult: { managerId: string } | { error: string } = { managerId: "mgr-1" }
let insertResult: {
  data: { id: number; full_name: string; phone: string | null; credit_enabled: boolean } | null
  error: { code?: string; message: string } | null
}
const verifyApprovalSpy = vi.fn()
const logAuditSpy = vi.fn()

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: async () => session,
  apiError: (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), { status }),
}))
vi.mock("@/lib/pos/sale-core", () => ({
  verifyApproval: (...args: unknown[]) => verifyApprovalSpy(...args),
}))
vi.mock("@/lib/activity/audit", () => ({
  logAudit: (...args: unknown[]) => logAuditSpy(...args),
}))

const { POST } = await import("./route")

const body = (over: Record<string, unknown> = {}) => ({
  name: "Rita Appadoo",
  phone: "5712 3456",
  ...over,
})

const post = async (payload: Record<string, unknown>) => {
  const response = await POST(
    new Request("http://t/api/till/customers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  )
  return response.json()
}

beforeEach(() => {
  approvalResult = { managerId: "mgr-1" }
  insertResult = {
    data: { id: 42, full_name: "Rita Appadoo", phone: "5712 3456", credit_enabled: false },
    error: null,
  }
  verifyApprovalSpy.mockReset().mockImplementation(async () => approvalResult)
  logAuditSpy.mockReset().mockResolvedValue(undefined)
  session.supabase.from = vi.fn().mockReturnValue({
    insert: () => ({
      select: () => ({
        maybeSingle: async () => insertResult,
      }),
    }),
  })
})

describe("creating a plain customer", () => {
  it("never asks for approval", async () => {
    const json = await post(body())

    expect(json).toMatchObject({ ok: true, customer: { creditEnabled: false } })
    expect(verifyApprovalSpy).not.toHaveBeenCalled()
  })

  it("still accepts a request with no openAccount field at all", async () => {
    // An older till build predates the credit-toggle entirely.
    const json = await post(body())
    expect(json.ok).toBe(true)
  })
})

describe("opening an account in the same request", () => {
  it("refuses with the flag the till watches for, and creates nobody", async () => {
    approvalResult = { error: "A manager needs to approve this credit." }
    const json = await post(body({ openAccount: true }))

    expect(json).toEqual({
      ok: false,
      error: "A manager needs to approve this credit.",
      needsApproval: true,
    })
    // Checked before the insert on purpose: a declined or wrong PIN must leave
    // no half-made customer behind.
    expect(session.supabase.from).not.toHaveBeenCalled()
  })

  it("passes the id verifyApproval returned, not one the client sent", async () => {
    approvalResult = { managerId: "mgr-1" }
    insertResult = {
      data: { id: 42, full_name: "Rita Appadoo", phone: "5712 3456", credit_enabled: true },
      error: null,
    }

    const json = await post(
      body({
        openAccount: true,
        approval: { managerId: "not-the-approver", pin: "1234" },
      }),
    )

    expect(json).toMatchObject({ ok: true, customer: { creditEnabled: true } })
    expect(logAuditSpy).toHaveBeenCalledWith(
      session.supabase,
      expect.objectContaining({
        type: "customer.credit_changed",
        detail: expect.objectContaining({ approvedBy: "mgr-1" }),
      }),
    )
  })

  it("logs no audit event when the account is not opened", async () => {
    await post(body())
    expect(logAuditSpy).not.toHaveBeenCalled()
  })
})

describe("the duplicate-phone error", () => {
  it("reads as a sentence, not a raw constraint violation", async () => {
    insertResult = { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "customers_phone_key"' } }

    const json = await post(body())

    expect(json).toEqual({
      ok: false,
      error: "A customer with that phone number already exists.",
    })
  })
})
