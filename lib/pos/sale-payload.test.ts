import { describe, expect, it } from "vitest"

import { completeSaleSchema } from "./sale-core"

/**
 * The bytes the Android till actually posts.
 *
 * This file exists because of a four-day outage nobody saw. `saleItemSchema`
 * had `unitPrice: z.number().min(0).optional()`, and `.optional()` accepts
 * `undefined` while REFUSING `null`. The tablet serialises with kotlinx's
 * `explicitNulls = true` — TillApi.kt explains why, at length, because turning
 * it off had previously dropped `discount` and `customerId` out of the payload
 * — so every catalogue line goes out as `"unitPrice": null`.
 *
 * Result: the route answered 400 "Invalid input: expected number, received
 * null" to every sale the tablet made, live and queued alike. Two real sales
 * sat in the device queue from 2026-07-30, retried 102 and 99 times against
 * the same rejection, Rs 1,634.44 that never reached the books. The last sale
 * in the whole database was 2026-07-29.
 *
 * Every other test in this suite builds its input in TypeScript, where a field
 * you forget is `undefined` and passes. That is exactly the blind spot: the
 * shape under test was never the shape on the wire. So the fixture below is
 * the VERBATIM payload recovered from the stuck queue — copied, not retyped —
 * and any schema change that stops accepting it fails here.
 */

/** From `queued_sales`, key 10a2dd1f-7cdb-4fab-9214-62f93ce4f9ee. */
const STUCK_PAYLOAD = {
  shiftId: 1,
  customerId: null,
  cashierId: "7691c64f-c80c-44a8-9777-f0adccd43753",
  items: [
    { variantId: 304, qty: 1, discount: 0.0, description: null, unitPrice: null },
    { variantId: 182, qty: 1, discount: 0.0, description: null, unitPrice: null },
    { variantId: 244, qty: 1, discount: 50.0, description: null, unitPrice: null },
  ],
  payments: [{ method: "cash", amount: 1324.83, tendered: 5000.0 }],
  discounts: [],
  approval: null,
  idempotencyKey: "10a2dd1f-7cdb-4fab-9214-62f93ce4f9ee",
}

describe("the payload the tablet really sends", () => {
  it("accepts the sale that was stuck in the queue for four days", () => {
    const parsed = completeSaleSchema.safeParse(STUCK_PAYLOAD)
    expect(
      parsed.success ? null : parsed.error.issues[0]?.message,
    ).toBeNull()
  })

  it("treats an explicit null the same as an absent field, everywhere", () => {
    // The rule this suite is really defending: for any field this server calls
    // optional, `null` and absent must mean the same thing. A client that
    // spells "nothing" the other way is not sending an invalid sale.
    //
    // Asserted on what the sale is priced from, not by deep equality of the
    // parsed objects: one leaves `approval: null` where the other leaves
    // `undefined`, and one carries a `unitPrice` key holding nothing where the
    // other has no key at all. Those are implementation details of zod. The
    // contract is that neither spelling changes what gets committed.
    const spelledOut = completeSaleSchema.safeParse(STUCK_PAYLOAD)
    const omitted = completeSaleSchema.safeParse({
      ...STUCK_PAYLOAD,
      customerId: undefined,
      approval: undefined,
      items: STUCK_PAYLOAD.items.map(({ variantId, qty, discount }) => ({
        variantId,
        qty,
        discount,
      })),
    })

    expect(spelledOut.success && omitted.success).toBe(true)
    if (spelledOut.success && omitted.success) {
      // A catalogue line carries no price either way — `priceItems` reloads it
      // from `product_variants`, which is the whole reason the till may leave
      // it out. Both readings reach that same branch.
      for (const parsed of [spelledOut.data, omitted.data]) {
        expect(parsed.items.map((i) => i.unitPrice ?? null)).toEqual([null, null, null])
        expect(parsed.items.map((i) => i.variantId)).toEqual([304, 182, 244])
        expect(parsed.items.map((i) => i.discount)).toEqual([0, 0, 50])
        expect(parsed.approval ?? null).toBeNull()
        expect(parsed.customerId).toBeNull()
      }
    }
  })

  it("still refuses a custom line with no price", () => {
    // The null tolerance must not become "any missing price is fine". A line
    // with no variant has no catalogue row to be priced from, so its own price
    // is the only one there is.
    const parsed = completeSaleSchema.safeParse({
      ...STUCK_PAYLOAD,
      items: [{ variantId: null, qty: 1, description: "Gift wrap", unitPrice: null }],
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("A custom line needs a price.")
    }
  })

  it("takes a real custom line", () => {
    const parsed = completeSaleSchema.safeParse({
      ...STUCK_PAYLOAD,
      items: [{ variantId: null, qty: 1, description: "Gift wrap", unitPrice: 75 }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.items[0].unitPrice).toBe(75)
  })
})
