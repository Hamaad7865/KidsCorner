import { describe, expect, it } from "vitest"

import { closeShiftFor, readZTotals } from "./shift-core"

describe("readZTotals VAT identities", () => {
  it("maps each distinct frozen enabled identity from a live X read", () => {
    const totals = readZTotals({
      vat_identities: [
        { policyId: 7, rate: 0.15, vatNumber: "VAT-15" },
        { policyId: 9, rate: 0.2, vatNumber: "VAT-20" },
      ],
    })

    expect(totals.vatIdentities).toEqual([
      { policyId: 7, rate: 0.15, vatNumber: "VAT-15" },
      { policyId: 9, rate: 0.2, vatNumber: "VAT-20" },
    ])
  })

  it("does not synthesize an identity for a disabled-only shift", () => {
    expect(readZTotals({ vat_identities: [] }).vatIdentities).toEqual([])
  })
})

describe("closeShiftFor VAT identities", () => {
  it("returns the exact identity array frozen separately by close_shift_z", async () => {
    const vatIdentitySnapshot = [
      { policyId: 21, rate: 0.15, vatNumber: "VAT-CLOSE-15" },
    ]
    const supabase = {
      rpc: async () => ({
        data: {
          counted_cash: 215,
          expected_cash: 200,
          variance: 15,
          z_no: "Z00021",
          z_id: 21,
          totals: {},
          vat_identity_snapshot: vatIdentitySnapshot,
        },
        error: null,
      }),
    }

    const result = await closeShiftFor(
      supabase as never,
      { id: "owner-1", name: "Asha" },
      { shiftId: 7, countedCash: 215, notes: null },
    )

    expect(result).toMatchObject({
      ok: true,
      value: { vatIdentities: vatIdentitySnapshot },
    })
  })
})
