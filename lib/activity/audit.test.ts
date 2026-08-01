import { describe, expect, it, vi } from "vitest"

import { changedFields, logAudit, logAudits, moneyChange } from "./audit"

describe("changedFields", () => {
  it("reports only what actually moved", () => {
    const changes = changedFields(
      { name: "Staff discount", value: 10, is_active: true },
      { name: "Staff discount", value: 15, is_active: true },
    )
    expect(changes).toEqual([{ field: "value", before: 10, after: 15 }])
  })

  it("treats Postgres's string numerics as equal to the form's numbers", () => {
    // NUMERIC comes back as "10.00" and the form parses it to 10. Compared as
    // raw values every save of an untouched discount would log a change, and a
    // trail full of non-events is one nobody reads.
    expect(changedFields({ value: "10" }, { value: 10 })).toEqual([])
    expect(changedFields({ min_spend: "0.00" }, { min_spend: 0 })).toHaveLength(1)
  })

  it("treats null, undefined and blank as the same absence", () => {
    expect(changedFields({ code: null }, { code: undefined })).toEqual([])
    expect(changedFields({ code: null }, { code: "" })).toEqual([])
    expect(changedFields({ code: null }, { code: "SUMMER" })).toHaveLength(1)
  })

  it("ignores fields the update did not mention", () => {
    const changes = changedFields({ a: 1, b: 2 }, { a: 1 })
    expect(changes).toEqual([])
  })

  it("calls a field changed when the BEFORE row never carried it", () => {
    // Not a quirk — a trap for the caller. This walks the keys of the new row,
    // so a column left out of the `select` reads as absent-before and is
    // reported as changed on every save. Read back every column you compare.
    expect(changedFields({}, { code: "SUMMER" })).toEqual([
      { field: "code", before: null, after: "SUMMER" },
    ])
    expect(changedFields({}, { code: null })).toEqual([])
  })
})

describe("moneyChange", () => {
  it("says what a price went from and to", () => {
    expect(moneyChange("450.00", 399)).toEqual({
      before: 450,
      after: 399,
      summary: "Rs 450.00 → Rs 399.00",
    })
  })

  it("returns nothing when the price did not move", () => {
    expect(moneyChange("450.00", 450)).toBeNull()
    expect(moneyChange(450, 450.001)).toBeNull()
  })

  it("treats an unreadable previous value as zero rather than throwing", () => {
    expect(moneyChange(null, 25)).toMatchObject({ before: 0, after: 25 })
  })
})

describe("logAudit", () => {
  it("passes the event through to the log_audit RPC", async () => {
    const rpc = vi.fn(() => Promise.resolve({ error: null }))
    await logAudit({ rpc } as never, {
      type: "price.changed",
      refType: "variant",
      refId: 7,
      summary: "KC-0007 · Rs 450.00 → Rs 399.00",
      detail: { before: 450, after: 399 },
    })

    expect(rpc).toHaveBeenCalledWith("log_audit", {
      p_event_type: "price.changed",
      p_ref_type: "variant",
      // Stringified: `audit_events.ref_id` is TEXT, so an int id would arrive
      // as a number and PostgREST would reject the call.
      p_ref_id: "7",
      p_summary: "KC-0007 · Rs 450.00 → Rs 399.00",
      p_detail: { before: 450, after: 399 },
      p_device_id: null,
    })
  })

  it("never lets a failed write bubble out", async () => {
    // Saving a price must not bounce because the log hiccupped. Both shapes of
    // failure are covered: a rejected promise and a thrown call.
    const rejects = vi.fn(() => Promise.reject(new Error("network")))
    await expect(logAudit({ rpc: rejects } as never, event())).resolves.toBeUndefined()

    const throws = vi.fn(() => {
      throw new Error("client is gone")
    })
    await expect(logAudit({ rpc: throws } as never, event())).resolves.toBeUndefined()
  })

  it("writes every event even when one of them fails", async () => {
    let call = 0
    const rpc = vi.fn(() => {
      call += 1
      return call === 1 ? Promise.reject(new Error("nope")) : Promise.resolve({ error: null })
    })

    await expect(
      logAudits({ rpc } as never, [event("price.changed"), event("cost.changed")]),
    ).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})

function event(type = "price.changed") {
  return { type, refType: "variant", refId: 1, summary: "x" }
}
