import { describe, expect, it } from "vitest"

import { isJwtClockSkew, readPastClockSkew } from "./timing"

describe("isJwtClockSkew", () => {
  it("recognises the PostgREST clock-skew code", () => {
    expect(isJwtClockSkew({ code: "PGRST303", message: "JWT issued at future" })).toBe(true)
  })

  it("recognises the message even if the code is absent", () => {
    expect(isJwtClockSkew({ message: "JWT issued at future" })).toBe(true)
    expect(isJwtClockSkew({ message: "JWT not yet valid" })).toBe(true)
    // Case-insensitive — the wording is not ours to depend on exactly.
    expect(isJwtClockSkew({ message: "jwt ISSUED at future" })).toBe(true)
  })

  it("does NOT match a real auth failure — those must never be retried", () => {
    expect(isJwtClockSkew({ code: "PGRST301", message: "JWT expired" })).toBe(false)
    expect(isJwtClockSkew({ code: "42501", message: "permission denied" })).toBe(false)
    expect(isJwtClockSkew(null)).toBe(false)
    expect(isJwtClockSkew(undefined)).toBe(false)
    expect(isJwtClockSkew({})).toBe(false)
  })
})

describe("readPastClockSkew", () => {
  type Result = {
    data: unknown
    error: { code?: string | null; message?: string | null } | null
  }
  const skew = { code: "PGRST303", message: "JWT issued at future" }

  /** A read that yields the queued results in order, counting its calls. */
  const reader = (results: Result[]) => {
    let calls = 0
    return {
      read: () => {
        const result = results[Math.min(calls, results.length - 1)]
        calls += 1
        return Promise.resolve(result)
      },
      calls: () => calls,
    }
  }

  it("returns immediately on success, without retrying", async () => {
    const r = reader([{ data: { role: "owner" }, error: null }])
    const result = await readPastClockSkew(r.read, { delayMs: 0 })
    expect(result.error).toBeNull()
    expect(r.calls()).toBe(1)
  })

  it("retries the skew, then returns the read that finally lands", async () => {
    const r = reader([
      { data: null, error: skew },
      { data: null, error: skew },
      { data: { role: "manager" }, error: null },
    ])
    const result = await readPastClockSkew(r.read, { attempts: 3, delayMs: 0 })
    expect(result.data).toEqual({ role: "manager" })
    expect(result.error).toBeNull()
    expect(r.calls()).toBe(3)
  })

  it("gives up after the attempt budget and surfaces the last error", async () => {
    const r = reader([{ data: null, error: skew }])
    const result = await readPastClockSkew(r.read, { attempts: 3, delayMs: 0 })
    expect(result.error).toEqual(skew)
    expect(r.calls()).toBe(3)
  })

  it("does not retry a non-skew error", async () => {
    const denied = { code: "42501", message: "permission denied" }
    const r = reader([{ data: null, error: denied }])
    const result = await readPastClockSkew(r.read, { attempts: 3, delayMs: 0 })
    expect(result.error).toEqual(denied)
    expect(r.calls()).toBe(1)
  })
})
