/**
 * A stand-in PostgREST client for the report tests.
 *
 * The pure helpers in `vat.ts` and `pnl.ts` are tested directly. What this
 * reaches is the part between them — the loops that read a row's fields, pick a
 * sign, and decide which month a document belongs to. That assembly is where a
 * report goes quietly wrong: a credit note added instead of subtracted still
 * produces a plausible number, and no test of a pure function would catch it.
 *
 * It records the filters each read applied, so a test can also assert the parts
 * that are invisible in the result — that draft purchases are excluded, say,
 * which is a rule you cannot see in a total that happens to look right.
 */

export type FakeTables = Record<string, unknown[]>

/** One recorded call, e.g. `["eq", "status", "received"]`. */
export type FilterCall = [string, ...unknown[]]

type Result = { data: unknown[]; error: null }

const CHAIN_METHODS = [
  "select", "eq", "in", "gte", "lte", "lt", "gt", "neq", "order", "limit",
  "returns", "not", "is", "filter",
] as const

function builder(rows: unknown[], log: FilterCall[]) {
  const chain: Record<string, unknown> = {}

  for (const method of CHAIN_METHODS) {
    chain[method] = (...args: unknown[]) => {
      log.push([method, ...args])
      return chain
    }
  }

  chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  chain.then = (resolve: (value: Result) => unknown) =>
    Promise.resolve({ data: rows, error: null } as Result).then(resolve)

  return chain
}

export type FakeClient = {
  from: (table: string) => unknown
  /** Every filter applied to reads of `table`, in call order. */
  filtersOn: (table: string) => FilterCall[]
}

/** A client whose every read returns whatever `tables` holds for that name. */
export function fakeClient(tables: FakeTables): FakeClient {
  const log = new Map<string, FilterCall[]>()

  return {
    from(table: string) {
      const calls = log.get(table) ?? []
      log.set(table, calls)
      return builder(tables[table] ?? [], calls)
    },
    filtersOn(table: string) {
      return log.get(table) ?? []
    },
  }
}
