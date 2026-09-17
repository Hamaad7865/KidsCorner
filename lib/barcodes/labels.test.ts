import { describe, expect, it } from "vitest"

import { buildCopies, parseCopies } from "./labels"

describe("parseCopies", () => {
  it("reads variantId:count pairs", () => {
    expect([...parseCopies("12:5,13:3").entries()]).toEqual([
      [12, 5],
      [13, 3],
    ])
  })

  it("is empty for an absent or blank param", () => {
    expect(parseCopies(undefined).size).toBe(0)
    expect(parseCopies("").size).toBe(0)
  })

  it("drops only the malformed pairs, keeping the good ones", () => {
    // A bad id, a bad count, an empty id, a zero and a negative — each dropped,
    // but the one valid pair survives.
    const map = parseCopies("12:5,abc:2,13:x,:4,7:0,9:-1")
    expect([...map.entries()]).toEqual([[12, 5]])
  })

  it("ignores non-integer ids and counts", () => {
    expect(parseCopies("1.5:2,3:2.5").size).toBe(0)
  })
})

describe("buildCopies", () => {
  it("round-trips through parseCopies", () => {
    const original = new Map([
      [12, 5],
      [13, 3],
    ])
    expect([...parseCopies(buildCopies(original)).entries()]).toEqual([
      [12, 5],
      [13, 3],
    ])
  })

  it("drops non-positive counts", () => {
    expect(buildCopies(new Map([[12, 0], [13, 3]]))).toBe("13:3")
  })
})
