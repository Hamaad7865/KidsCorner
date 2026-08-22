import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The till's account-statement endpoint (`GET /api/till/credit`).
 *
 * It exists so the cashier settling a tab can see the sales behind the balance.
 * Worth a test because it runs the real oldest-first FIFO (`outstandingCharges`)
 * over the ledger rows and must return per-charge remainders, oldest-first, with
 * the receipt number carried through — the exact shape the till renders.
 */

const session = {
  supabase: { from: vi.fn() },
}

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: async () => session,
  apiError: (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), { status }),
}))
vi.mock("@/lib/activity/audit", () => ({ logAudit: vi.fn() }))

const { GET } = await import("./route")

/** A chainable stub that resolves the whole select/eq/order/limit run. */
function ledger(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => result,
  }
  return chain
}

const get = async (url: string) => {
  const response = await GET(new Request(url))
  return { status: response.status, body: await response.json() }
}

const CUST = "http://t/api/till/credit?customerId=7"

beforeEach(() => {
  session.supabase.from = vi.fn()
})

describe("the statement it returns", () => {
  it("lists the unpaid sales oldest-first, applying payments to the oldest", async () => {
    session.supabase.from.mockReturnValue(
      ledger({
        data: [
          { amount: 200, due_on: null, created_at: "2026-08-01T09:00:00Z", sale_id: 11, sales: { sale_no: "S1" } },
          { amount: 400, due_on: null, created_at: "2026-08-10T09:00:00Z", sale_id: 12, sales: { sale_no: "S2" } },
          { amount: -300, due_on: null, created_at: "2026-08-12T09:00:00Z", sale_id: null, sales: null },
        ],
        error: null,
      }),
    )

    const { body } = await get(CUST)

    // 300 clears all of S1 and 100 of S2, so only S2 remains, owing 300.
    expect(body).toEqual({
      ok: true,
      balance: 300,
      charges: [{ saleId: 12, saleNo: "S2", date: "2026-08-10T09:00:00Z", amount: 300 }],
    })
  })

  it("returns an empty statement for a missing or invalid customer id", async () => {
    const { body } = await get("http://t/api/till/credit")
    expect(body).toEqual({ ok: true, balance: 0, charges: [] })
    // Never touched the database for a request with nothing to look up.
    expect(session.supabase.from).not.toHaveBeenCalled()
  })

  it("passes a read failure through as a 500 rather than a bare balance", async () => {
    session.supabase.from.mockReturnValue(ledger({ data: null, error: { message: "read replica timeout" } }))
    const { status, body } = await get(CUST)
    expect(status).toBe(500)
    expect(body).toEqual({ ok: false, error: "read replica timeout" })
  })
})
