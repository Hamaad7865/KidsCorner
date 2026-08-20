import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ settingValue: undefined as unknown }))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { value: mocks.settingValue }, error: null }),
        }),
      }),
    }),
  })),
}))

import { DEFAULT_SLOW_MOVER_DAYS, getSlowMoverDays } from "./queries"

describe("getSlowMoverDays", () => {
  afterEach(() => {
    mocks.settingValue = undefined
  })

  it("reads a stored whole-day count", async () => {
    mocks.settingValue = 45
    expect(await getSlowMoverDays()).toBe(45)
  })

  it("falls back to the default when unset", async () => {
    mocks.settingValue = undefined
    expect(await getSlowMoverDays()).toBe(DEFAULT_SLOW_MOVER_DAYS)
  })

  it("falls back when the value is zero, negative or not a whole number", async () => {
    for (const bad of [0, -3, 2.5, "abc", null]) {
      mocks.settingValue = bad
      expect(await getSlowMoverDays()).toBe(DEFAULT_SLOW_MOVER_DAYS)
    }
  })
})
