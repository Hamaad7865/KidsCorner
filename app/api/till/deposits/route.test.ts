import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The till's deposit-list route, specifically the customer-profile mode.
 *
 * The till's own list answers "is my cot still on hold?" — live orders only.
 * A customer's profile wants their WHOLE deposit history, so `customerId`
 * widens the default to every status while an explicit ?status= still wins,
 * keeping the client's existing "always send status" contract intact either way.
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

/** Chainable, recording, thenable — same stub the other route tests use. */
function readChain(result: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: Array<[string, unknown[]]> = []
  const chain: Record<string, unknown> = {}
  const step = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return chain
  }
  for (const name of ["select", "eq", "or", "order", "limit"]) chain[name] = step(name)
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return { chain: chain as never, calls }
}

const DEPOSIT_ROWS = [
  {
    order_id: 12,
    order_no: "D260823-1",
    status: "open",
    total: 900,
    balance: 400,
    unallocated_credit: 500,
    qty_total: 3,
    qty_collected: 0,
    collect_by: "2026-09-06",
    created_at: "2026-08-23T09:00:00Z",
    customer_id: 7,
    customer_name: "Rita Appadoo",
    customer_phone: "5712 3456",
  },
]

const getBody = async (url: string) => (await GET(new Request(url))).json()

const callsOf = (result: { data: unknown[] | null; error: { message: string } | null }) => {
  const built = readChain(result)
  session.supabase.from.mockReturnValue(built.chain)
  return built.calls
}

beforeEach(() => {
  session.supabase.from = vi.fn()
})

describe("the till's own list (no customerId)", () => {
  it("still defaults to live orders only", async () => {
    const calls = callsOf({ data: [], error: null })

    await getBody("http://t/api/till/deposits")

    // No explicit status → the open-only default stands, exactly as before.
    expect(calls).toEqual(expect.arrayContaining([["eq", ["status", "open"]]]))
    expect(calls.some(([name, args]) => name === "eq" && args[0] === "customer_id")).toBe(false)
  })

  it("an explicit status still wins over the default", async () => {
    const calls = callsOf({ data: [], error: null })

    await getBody("http://t/api/till/deposits?status=collected")

    expect(calls).toEqual(expect.arrayContaining([["eq", ["status", "collected"]]]))
  })
})

describe("one customer's deposits (?customerId=)", () => {
  it("shows every status when none is asked for — a profile wants history", async () => {
    const calls = callsOf({ data: DEPOSIT_ROWS, error: null })

    const json = await getBody("http://t/api/till/deposits?customerId=7")

    expect(json.ok).toBe(true)
    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", ["customer_id", 7]],
        ["order", ["created_at", { ascending: false }]],
      ]),
    )
    // Widened default: no status filter at all, not even 'open'.
    expect(calls.filter(([name, args]) => name === "eq" && args[0] === "status")).toHaveLength(0)
  })

  it("an explicit status beats the widened default", async () => {
    const calls = callsOf({ data: [], error: null })

    await getBody("http://t/api/till/deposits?customerId=7&status=open")

    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", ["customer_id", 7]],
        ["eq", ["status", "open"]],
      ]),
    )
  })

  it("composes with the text search", async () => {
    const calls = callsOf({ data: [], error: null })

    await getBody("http://t/api/till/deposits?customerId=7&status=all&q=cot")

    expect(calls).toEqual(expect.arrayContaining([["or", [expect.stringContaining("order_no.ilike.%cot%")]]]))
    expect(calls).toEqual(expect.arrayContaining([["eq", ["customer_id", 7]]]))
  })

  it.each(["abc", "0", "-3", ""])("a nonsense customerId %j means no filter, open default", async (bad) => {
    const calls = callsOf({ data: [], error: null })

    await getBody(`http://t/api/till/deposits?customerId=${encodeURIComponent(bad)}`)

    expect(calls.some(([name, args]) => name === "eq" && args[0] === "customer_id")).toBe(false)
    expect(calls).toEqual(expect.arrayContaining([["eq", ["status", "open"]]]))
  })
})
