import { describe, expect, it, vi } from "vitest"

import { getCurrentVatPolicy } from "./policy"

/**
 * A stub Supabase client that records the query it was asked to run and returns
 * one canned `vat_policies` row. Only the calls `getCurrentVatPolicy` makes are
 * modelled — `.from().select().order().limit().maybeSingle()`.
 */
function clientReturning(row: unknown, error: unknown = null) {
  const order = vi.fn().mockReturnThis()
  const limit = vi.fn().mockReturnThis()
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error })
  const select = vi.fn(() => ({ order, limit, maybeSingle }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as never, from, select, order, limit, maybeSingle }
}

const baseRow = {
  id: 7,
  enabled: false,
  configured_rate: 0.15,
  vat_number: null as string | null,
  created_at: "2026-08-18T09:00:00Z",
}

describe("getCurrentVatPolicy", () => {
  it("reads the latest policy from the ledger, ordered by id desc", async () => {
    const stub = clientReturning(baseRow)
    await getCurrentVatPolicy(stub.client)

    expect(stub.from).toHaveBeenCalledWith("vat_policies")
    // The current policy is the highest id, deterministically, so a tie on
    // created_at can never pick the wrong row.
    expect(stub.order).toHaveBeenCalledWith("id", { ascending: false })
    expect(stub.limit).toHaveBeenCalledWith(1)
  })

  it("reports configured 15% and effective 0% when disabled", async () => {
    const stub = clientReturning({ ...baseRow, enabled: false, configured_rate: 0.15 })
    const policy = await getCurrentVatPolicy(stub.client)

    expect(policy.enabled).toBe(false)
    expect(policy.configuredRate).toBe(0.15)
    expect(policy.effectiveRate).toBe(0)
  })

  it("reports configured and effective 15% when enabled", async () => {
    const stub = clientReturning({
      ...baseRow,
      enabled: true,
      configured_rate: 0.15,
      vat_number: "VAT20123456",
    })
    const policy = await getCurrentVatPolicy(stub.client)

    expect(policy.enabled).toBe(true)
    expect(policy.configuredRate).toBe(0.15)
    expect(policy.effectiveRate).toBe(0.15)
    expect(policy.vatNumber).toBe("VAT20123456")
  })

  it("normalises a blank disabled VAT number to null", async () => {
    const stub = clientReturning({ ...baseRow, enabled: false, vat_number: "   " })
    const policy = await getCurrentVatPolicy(stub.client)
    expect(policy.vatNumber).toBeNull()
  })

  it("keeps a prepared VAT number visible while still disabled", async () => {
    // The owner can enter the number before registering; disabling must not
    // discard it from the read model.
    const stub = clientReturning({ ...baseRow, enabled: false, vat_number: "VAT20123456" })
    const policy = await getCurrentVatPolicy(stub.client)
    expect(policy.vatNumber).toBe("VAT20123456")
    expect(policy.effectiveRate).toBe(0)
  })

  it("coerces Postgres's string numeric rate to a number", async () => {
    const stub = clientReturning({ ...baseRow, enabled: true, configured_rate: "0.15" })
    const policy = await getCurrentVatPolicy(stub.client)
    expect(policy.configuredRate).toBe(0.15)
    expect(policy.effectiveRate).toBe(0.15)
  })
})
