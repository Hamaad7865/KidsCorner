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

const { POST, GET } = await import("./route")

/**
 * A chainable stub for the read paths: every builder returns the chain, and
 * the chain itself is thenable, so whichever call the route awaits last
 * resolves the whole run. Every builder call is recorded, in order, so tests
 * can assert on the filters rather than trust the shape.
 */
function readChain(result: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: Array<[string, unknown[]]> = []
  const chain: Record<string, unknown> = {}
  const step = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return chain
  }
  for (const name of ["select", "or", "ilike", "eq", "gt", "order"]) chain[name] = step(name)
  chain.limit = (...args: unknown[]) => {
    calls.push(["limit", args])
    return chain
  }
  chain.range = (...args: unknown[]) => {
    calls.push(["range", args])
    return chain
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return { chain: chain as never, calls }
}

const getBody = async (url: string) => (await GET(new Request(url))).json()

const CUSTOMER_ROWS = [
  {
    customer_id: 7,
    full_name: "Rita Appadoo",
    phone: "5712 3456",
    credit_enabled: true,
    credit_on_hold: false,
    balance: 120.5,
  },
]

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

describe("the attach-dialog search (GET ?q=)", () => {
  it("answers an empty list for an empty box, and nothing else", async () => {
    // The dialog fires this on mount. The browse screen must not hijack it.
    const json = await getBody("http://t/api/till/customers?q=")

    expect(json).toEqual({ ok: true, customers: [] })
    // Not even looked at the database.
    expect(session.supabase.from).not.toHaveBeenCalled()
  })

  it("searches names and phones, capped, with no hasMore key", async () => {
    session.supabase.from.mockReturnValue(readChain({ data: CUSTOMER_ROWS, error: null }).chain)

    const json = await getBody("http://t/api/till/customers?q=rita")

    // Byte-identical to the pre-browse contract: no pagination keys at all,
    // so an older APK parsing this response sees exactly what it always saw.
    expect(json).toEqual({
      ok: true,
      customers: [
        {
          id: 7,
          fullName: "Rita Appadoo",
          phone: "5712 3456",
          creditEnabled: true,
          creditBalance: 120.5,
          creditOnHold: false,
        },
      ],
    })
    expect("hasMore" in json).toBe(false)
  })
})

describe("debtors mode (?mode=debtors)", () => {
  // One open account, one switched off with money still owed — the row a
  // payment chases and the list must not drop. The stub cannot execute
  // filters, so "positive balances only" is asserted on the gt call below
  // rather than by feeding an in-credit row through here.
  const DEBTOR_ROWS = [
    {
      customer_id: 3,
      full_name: "Ancha Peertum",
      phone: null,
      credit_enabled: true,
      credit_on_hold: false,
      balance: 300,
    },
    {
      customer_id: 4,
      full_name: "Closed But Owes",
      phone: null,
      credit_enabled: false,
      credit_on_hold: false,
      balance: 25,
    },
  ]

  it("asks the database for positive balances, biggest first", async () => {
    const { chain, calls } = readChain({ data: DEBTOR_ROWS, error: null })
    session.supabase.from.mockReturnValue(chain)

    const json = await getBody("http://t/api/till/customers?mode=debtors")

    expect(json).toEqual({
      ok: true,
      customers: [
        expect.objectContaining({ id: 3, fullName: "Ancha Peertum", creditBalance: 300 }),
        expect.objectContaining({ id: 4, fullName: "Closed But Owes", creditEnabled: false }),
      ],
      hasMore: false,
    })
    expect(calls).toEqual(
      expect.arrayContaining([
        ["gt", ["balance", 0]],
        ["order", ["balance", { ascending: false }]],
        // Ties must not reshuffle who makes a capped page between queries.
        ["order", ["full_name"]],
        ["order", ["customer_id"]],
      ]),
    )
    expect(session.supabase.from).toHaveBeenCalledWith("customer_credit_accounts")
  })

  it("says there is more when the cap is hit, and shows only the cap", async () => {
    const overflowing = Array.from({ length: 41 }, (_, i) => ({
      ...DEBTOR_ROWS[0],
      customer_id: i,
    }))
    const { chain, calls } = readChain({ data: overflowing, error: null })
    session.supabase.from.mockReturnValue(chain)

    const json = await getBody("http://t/api/till/customers?mode=debtors")

    expect(json.customers).toHaveLength(40)
    expect(json.hasMore).toBe(true)
    // Asked for one past the cap, so `hasMore` is an observation, not a guess.
    expect(calls).toContainEqual(["limit", [41]])
  })

  it("ignores q entirely — debtors are not a search", async () => {
    const { chain, calls } = readChain({ data: [], error: null })
    session.supabase.from.mockReturnValue(chain)

    await getBody("http://t/api/till/customers?mode=debtors&q=rita")

    expect(calls.some(([name]) => name === "or" || name === "ilike")).toBe(false)
  })

  it("surfaces a database failure through apiError", async () => {
    session.supabase.from.mockReturnValue(readChain({ data: null, error: { message: "no such view" } }).chain)

    const response = await GET(new Request("http://t/api/till/customers?mode=debtors"))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
  })
})

describe("browse mode (?offset= / ?limit=)", () => {
  it("a full page says there is more; a short page says it is the last", async () => {
    const full = [{ ...CUSTOMER_ROWS[0], customer_id: 1 }, { ...CUSTOMER_ROWS[0], customer_id: 2 }]
    session.supabase.from.mockReturnValue(readChain({ data: full, error: null }).chain)
    const first = await getBody("http://t/api/till/customers?offset=0&limit=2")
    expect(first.hasMore).toBe(true)

    const last = [CUSTOMER_ROWS[0]]
    session.supabase.from.mockReturnValue(readChain({ data: last, error: null }).chain)
    const second = await getBody("http://t/api/till/customers?offset=2&limit=2")
    expect(second.hasMore).toBe(false)
  })

  it("either pagination param alone is enough to enter browse mode", async () => {
    session.supabase.from.mockReturnValue(readChain({ data: [], error: null }).chain)

    const offsetOnly = await getBody("http://t/api/till/customers?offset=40")
    const limitOnly = await getBody("http://t/api/till/customers?limit=40")

    expect(offsetOnly).toMatchObject({ ok: true, customers: [], hasMore: false })
    expect(limitOnly).toMatchObject({ ok: true, customers: [], hasMore: false })
  })

  it("pages by range, ordered by name", async () => {
    const { chain, calls } = readChain({ data: [], error: null })
    session.supabase.from.mockReturnValue(chain)

    await getBody("http://t/api/till/customers?offset=40&limit=40")

    expect(calls).toEqual(
      expect.arrayContaining([
        ["order", ["full_name"]],
        ["range", [40, 79]],
      ]),
    )
    expect(session.supabase.from).toHaveBeenCalledWith("customer_credit_accounts")
  })

  it("composes the search box with pagination", async () => {
    const { chain, calls } = readChain({ data: [], error: null })
    session.supabase.from.mockReturnValue(chain)

    await getBody("http://t/api/till/customers?offset=0&limit=40&q=rita")

    expect(calls).toEqual(
      expect.arrayContaining([
        ["or", ["full_name.ilike.%rita%,phone.ilike.%rita%"]],
        ["range", [0, 39]],
      ]),
    )
  })

  it("clamps silly numbers instead of passing them through", async () => {
    const { calls } = (() => {
      const built = readChain({ data: [], error: null })
      session.supabase.from.mockReturnValue(built.chain)
      return built
    })()

    await getBody("http://t/api/till/customers?offset=-5&limit=9999")

    expect(calls).toEqual(expect.arrayContaining([["range", [0, 99]]]))
  })

  it("a read failure still reads as a 500", async () => {
    session.supabase.from.mockReturnValue(
      readChain({ data: null, error: { message: "connection refused" } }).chain,
    )

    const response = await GET(new Request("http://t/api/till/customers?offset=0&limit=40"))
    expect(response.status).toBe(500)
  })
})
