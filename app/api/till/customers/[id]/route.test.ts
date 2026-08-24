import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The till's edit-customer-details route (`PATCH /api/till/customers/:id`).
 *
 * Correcting a name or number moves no money and opens no credit, so unlike
 * creation-with-account it must never ask for approval — that contract is the
 * reason this exists beside POST rather than inside it. The answer must carry
 * the account state back so the tablet can swap its profile card wholesale,
 * and the duplicate-phone violation must read as a sentence.
 */

const session = {
  supabase: { from: vi.fn() },
}

let updateResult: { data: unknown; error: { code?: string; message: string } | null }
let accountRow: Record<string, unknown> | null
let accountReadError: { message: string } | null = null
let updatePayload: Record<string, unknown> | undefined
const logAuditSpy = vi.fn()

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: async () => session,
  apiError: (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), { status }),
}))
vi.mock("@/lib/activity/audit", () => ({
  logAudit: (...args: unknown[]) => logAuditSpy(...args),
}))

const { PATCH } = await import("./route")

const patch = async (
  customerId: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> => {
  const response = await PATCH(
    new Request("http://t/api/till/customers/" + customerId, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id: customerId }) },
  )
  return { status: response.status, json: await response.json() }
}

const ACCOUNT_ROW = {
  customer_id: 7,
  full_name: "Rita Appadoo",
  phone: "5712 3456",
  credit_enabled: true,
  credit_on_hold: false,
  balance: 120.5,
}

beforeEach(() => {
  updateResult = { data: null, error: null }
  accountRow = { ...ACCOUNT_ROW }
  accountReadError = null
  logAuditSpy.mockReset().mockResolvedValue(undefined)
  updatePayload = undefined

  session.supabase.from = vi.fn((table: string) => {
    if (table === "customers") {
      return {
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload
          return { eq: async () => updateResult }
        },
      }
    }
    // customer_credit_accounts: select -> eq -> maybeSingle
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: accountRow, error: accountReadError }),
        }),
      }),
    }
  })
})

describe("editing a customer's details", () => {
  it("saves the trimmed name and answers with the full account state", async () => {
    const { status, json } = await patch("7", { name: " Rita Appadoo ", phone: "5712 3456" })

    expect(status).toBe(200)
    expect(json).toMatchObject({
      ok: true,
      customer: {
        id: 7,
        fullName: "Rita Appadoo",
        phone: "5712 3456",
        creditEnabled: true,
        creditBalance: 120.5,
        creditOnHold: false,
      },
    })
  })

  it("writes both columns to customers", async () => {
    const { json } = await patch("7", { name: "Rita B Appadoo", phone: "5800 1122" })

    expect(json.ok).toBe(true)
    expect(updatePayload).toEqual({
      full_name: "Rita B Appadoo",
      phone: "5800 1122",
    })
  })

  it("turns a blank phone into 'no number' rather than an empty string", async () => {
    const { json } = await patch("7", { name: "Rita Appadoo", phone: "" })

    expect(json.ok).toBe(true)
    expect(updatePayload).toEqual({ full_name: "Rita Appadoo", phone: null })
  })

  it("audits the edit against the customer", async () => {
    await patch("7", { name: "Rita Appadoo", phone: "5712 3456" })

    expect(logAuditSpy).toHaveBeenCalledWith(
      session.supabase,
      expect.objectContaining({
        type: "customer.updated",
        refType: "customer",
        refId: 7,
      }),
    )
  })
})

describe("refusals", () => {
  it("rejects a too-short name before touching the database", async () => {
    const { json } = await patch("7", { name: "R", phone: null })

    expect(json.ok).toBe(false)
    expect(session.supabase.from).not.toHaveBeenCalled()
    expect(logAuditSpy).not.toHaveBeenCalled()
  })

  it("reads a duplicate phone as a sentence, not a constraint name", async () => {
    updateResult = {
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "customers_phone_key"' },
    }

    const { json } = await patch("7", { name: "Rita Appadoo", phone: "5712 3456" })

    expect(json).toEqual({
      ok: false,
      error: "A customer with that phone number already exists.",
    })
    expect(logAuditSpy).not.toHaveBeenCalled()
  })

  it("says not found when the edited customer does not exist", async () => {
    accountRow = null

    const { status, json } = await patch("9999", { name: "Nobody Nowhere", phone: null })

    expect(status).toBe(404)
    expect(json.ok).toBe(false)
  })

  it("refuses ids that are not numbers at all", async () => {
    const { status, json } = await patch("abc", { name: "Rita Appadoo", phone: null })

    expect(status).toBe(400)
    expect(json.ok).toBe(false)
    expect(session.supabase.from).not.toHaveBeenCalled()
  })
})
