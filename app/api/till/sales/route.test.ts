import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The till's sales-history route, specifically the customer-profile mode.
 *
 * Without `customerId` this endpoint is the quick-reprint list and must not
 * move — the till renders it on every visit to history. With `customerId` it
 * becomes one customer's purchase history: filtered to them, capped higher,
 * because a profile wants completeness where a reprint wants recency.
 */

const session = {
  supabase: { from: vi.fn() },
}

vi.mock("@/lib/api/till-session", () => ({
  requireTillSession: async () => session,
  apiError: (message: string, status: number) =>
    new Response(JSON.stringify({ ok: false, error: message }), { status }),
}))

const { GET } = await import("./route")

/**
 * A chainable stub that records every builder call; the chain is thenable so
 * whichever call the route awaits last resolves the run.
 */
function readChain(result: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: Array<[string, unknown[]]> = []
  const chain: Record<string, unknown> = {}
  const step = (name: string) => (...args: unknown[]) => {
    calls.push([name, args])
    return chain
  }
  for (const name of ["select", "eq", "ilike", "order", "limit"]) chain[name] = step(name)
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return { chain: chain as never, calls }
}

const SALE_ROWS = [
  {
    id: 91,
    sale_no: "S260822-3",
    sale_date: "2026-08-22T10:00:00Z",
    total: 450,
    status: "completed",
    profiles: { full_name: "Ana" },
    customers: { full_name: "Rita Appadoo" },
    sale_items: [{ qty: 2 }, { qty: 1 }],
  },
]

const getBody = async (url: string) => (await GET(new Request(url))).json()

beforeEach(() => {
  session.supabase.from = vi.fn()
})

describe("the quick-reprint path (no customerId)", () => {
  it("stays exactly as it was: recent-first, capped at 40, no customer filter", async () => {
    const { chain, calls } = readChain({ data: SALE_ROWS, error: null })
    session.supabase.from.mockReturnValue(chain)

    const json = await getBody("http://t/api/till/sales")

    expect(json).toEqual({
      ok: true,
      sales: [
        {
          id: 91,
          saleNo: "S260822-3",
          saleDate: "2026-08-22T10:00:00Z",
          total: 450,
          status: "completed",
          itemCount: 3,
          cashierName: "Ana",
          customerName: "Rita Appadoo",
        },
      ],
    })
    expect(calls).toEqual(
      expect.arrayContaining([
        ["limit", [40]],
        ["order", ["id", { ascending: false }]],
      ]),
    )
    expect(calls.some(([name]) => name === "eq")).toBe(false)
  })

  it("still searches by receipt number", async () => {
    const { calls } = (() => {
      const built = readChain({ data: [], error: null })
      session.supabase.from.mockReturnValue(built.chain)
      return built
    })()

    await getBody("http://t/api/till/sales?q=S2608")

    expect(calls).toEqual(expect.arrayContaining([["ilike", ["sale_no", "%S2608%"]]]))
  })
})

describe("one customer's history (?customerId=)", () => {
  it("filters to the customer and raises the cap for completeness", async () => {
    const { calls } = (() => {
      const built = readChain({ data: SALE_ROWS, error: null })
      session.supabase.from.mockReturnValue(built.chain)
      return built
    })()

    const json = await getBody("http://t/api/till/sales?customerId=7")

    expect(json.ok).toBe(true)
    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", ["customer_id", 7]],
        ["limit", [200]],
      ]),
    )
  })

  it("composes with the receipt-number search", async () => {
    const { calls } = (() => {
      const built = readChain({ data: [], error: null })
      session.supabase.from.mockReturnValue(built.chain)
      return built
    })()

    await getBody("http://t/api/till/sales?customerId=7&q=S260822-3")

    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", ["customer_id", 7]],
        ["ilike", ["sale_no", "%S260822-3%"]],
      ]),
    )
  })

  it.each(["abc", "0", "-3", "7.5", ""])(
    "treats %j as no customer at all rather than crashing",
    async (bad) => {
      const { calls } = (() => {
        const built = readChain({ data: [], error: null })
        session.supabase.from.mockReturnValue(built.chain)
        return built
      })()

      await getBody(`http://t/api/till/sales?customerId=${encodeURIComponent(bad)}`)

      expect(calls.some(([name]) => name === "eq")).toBe(false)
      expect(calls).toEqual(expect.arrayContaining([["limit", [40]]]))
    },
  )
})
