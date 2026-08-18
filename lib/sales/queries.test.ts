import { describe, expect, it } from "vitest"

import { getSaleDetail } from "./queries"

/**
 * A Supabase stub for the two reads getSaleDetail makes: the sale row and the
 * already-returned quantities. No discounts or prints, so it never reaches the
 * profiles lookup. `saleRow` is spread over a minimal skeleton so each test
 * varies only the frozen VAT fields.
 */
function clientFor(saleRow: Record<string, unknown>) {
  const sale = {
    id: 7,
    sale_no: "S0007",
    sale_date: "2026-08-18T09:30:00Z",
    status: "completed",
    subtotal: 230,
    discount: 0,
    vat_amount: 30,
    total: 230,
    customer_id: null,
    profiles: null,
    customers: null,
    sale_items: [],
    sale_payments: [],
    sale_discounts: [],
    credit_notes: [],
    receipt_prints: [],
    ...saleRow,
  }

  return {
    from(table: string) {
      if (table === "sales") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: sale, error: null }) }),
          }),
        }
      }
      if (table === "credit_note_items") {
        return { select: () => ({ eq: async () => ({ data: [] }) }) }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  } as never
}

describe("getSaleDetail frozen VAT", () => {
  it("returns the frozen VAT snapshot of a VAT-enabled sale", async () => {
    const detail = await getSaleDetail(7, clientFor({
      vat_policy_id: 6,
      vat_enabled: true,
      vat_rate: 0.15,
      vat_number: "VAT20123456",
      vat_amount: 30,
    }))
    expect(detail).not.toBeNull()
    expect(detail!.vatEnabled).toBe(true)
    expect(detail!.vatRate).toBe(0.15)
    expect(detail!.vatNumber).toBe("VAT20123456")
    expect(detail!.vatPolicyId).toBe(6)
    expect(detail!.vatAmount).toBe(30)
  })

  it("returns a disabled snapshot with no VAT number", async () => {
    const detail = await getSaleDetail(7, clientFor({
      vat_policy_id: 2,
      vat_enabled: false,
      vat_rate: 0,
      vat_number: null,
      vat_amount: 0,
    }))
    expect(detail!.vatEnabled).toBe(false)
    expect(detail!.vatRate).toBe(0)
    expect(detail!.vatNumber).toBeNull()
    expect(detail!.vatAmount).toBe(0)
  })

  it("keeps an enabled snapshot even on a zero-total sale", async () => {
    // The receipt stays a VAT invoice: status is explicit, never inferred from
    // vat_amount > 0.
    const detail = await getSaleDetail(7, clientFor({
      vat_enabled: true,
      vat_rate: 0.15,
      vat_number: "VAT20123456",
      vat_amount: 0,
      total: 0,
    }))
    expect(detail!.vatEnabled).toBe(true)
    expect(detail!.vatNumber).toBe("VAT20123456")
  })

  it("normalises a blank frozen VAT number to null", async () => {
    const detail = await getSaleDetail(7, clientFor({
      vat_enabled: true,
      vat_rate: 0.15,
      vat_number: "   ",
      vat_amount: 30,
    }))
    expect(detail!.vatNumber).toBeNull()
  })
})
