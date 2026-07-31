import { describe, expect, it } from "vitest"

import {
  EAN13_MODULES,
  ean13CheckDigit,
  ean13Modules,
  isValidEan13,
  maxSerialFor,
  serialWidthFor,
} from "./ean13"

/**
 * EAN-13, against the specification rather than against itself.
 *
 * A barcode that is subtly wrong is worse than one that is obviously wrong: the
 * labels print, the sheet looks right, and the failure surfaces at a counter
 * when a scanner beeps up the wrong product — or a competitor's.
 *
 * The decoder below is written from the GS1 tables, deliberately NOT imported
 * from the module under test. That is what makes the round trip meaningful: if
 * the encoder's tables were wrong, an encoder-derived decoder would agree with
 * it and both would be wrong together.
 */

const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"]
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"]
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"]
const PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"]

function decode(modules: string): string {
  expect(modules).toHaveLength(95)
  expect(modules.slice(0, 3)).toBe("101")
  expect(modules.slice(45, 50)).toBe("01010")
  expect(modules.slice(92)).toBe("101")

  let parity = ""
  let left = ""
  for (let i = 0; i < 6; i += 1) {
    const chunk = modules.slice(3 + i * 7, 10 + i * 7)
    const asL = L.indexOf(chunk)
    const asG = G.indexOf(chunk)
    if (asL >= 0) {
      parity += "L"
      left += asL
    } else if (asG >= 0) {
      parity += "G"
      left += asG
    } else {
      throw new Error(`left chunk ${chunk} is in neither table`)
    }
  }

  // The first digit is not drawn — it is carried entirely by which of the six
  // left digits use odd parity and which use even.
  const first = PARITY.indexOf(parity)
  expect(first).toBeGreaterThanOrEqual(0)

  let right = ""
  for (let i = 0; i < 6; i += 1) {
    const chunk = modules.slice(50 + i * 7, 57 + i * 7)
    const digit = R.indexOf(chunk)
    if (digit < 0) throw new Error(`right chunk ${chunk} is not an R code`)
    right += digit
  }

  return `${first}${left}${right}`
}

const withCheck = (payload: string) => payload + String(ean13CheckDigit(payload))

describe("ean13CheckDigit", () => {
  // Codes in real circulation, each with its published check digit.
  it.each([
    ["590123412345", 7, "EAN-13 reference"],
    ["400638133393", 1, "Faber-Castell"],
    ["978030640615", 7, "ISBN-13 Bookland"],
    ["007567816412", 5, "UPC-A as EAN-13"],
    ["871234567890", 6, "GS1 sample"],
  ])("matches the published check digit for %s (%s)", (payload, expected) => {
    expect(ean13CheckDigit(payload)).toBe(expected)
  })

  it("refuses a payload that is not 12 digits", () => {
    expect(() => ean13CheckDigit("12345")).toThrow()
    expect(() => ean13CheckDigit("59012341234a")).toThrow()
  })
})

describe("isValidEan13", () => {
  it("accepts a correct code", () => {
    expect(isValidEan13("5901234123457")).toBe(true)
  })

  it("rejects a single altered digit — the whole point of a check digit", () => {
    expect(isValidEan13("5901234123456")).toBe(false)
  })

  it("rejects a transposition it can see", () => {
    expect(isValidEan13("5901234132457")).toBe(false)
  })

  it("rejects the wrong length and non-digits", () => {
    expect(isValidEan13("59012341234")).toBe(false)
    expect(isValidEan13("59012341234a7")).toBe(false)
    expect(isValidEan13("")).toBe(false)
  })
})

describe("ean13Modules", () => {
  it("draws exactly 95 modules: 3 + 42 + 5 + 42 + 3", () => {
    expect(ean13Modules("5901234123457")).toHaveLength(EAN13_MODULES)
  })

  it("refuses to draw a code whose check digit is wrong", () => {
    // Drawing it anyway would print a label no scanner accepts.
    expect(() => ean13Modules("5901234123456")).toThrow()
  })

  it("round-trips through an independent decoder, across all 10 parity tables", () => {
    // The first digit selects the parity pattern, so every one of the ten must
    // be exercised — a single wrong row would be invisible otherwise.
    const tails = [
      "00000000000",
      "12345678901",
      "99999999999",
      "10101010101",
      "56789012345",
      "98765432109",
    ]
    let checked = 0
    for (let first = 0; first <= 9; first += 1) {
      for (const tail of tails) {
        const code = withCheck(`${first}${tail}`)
        expect(decode(ean13Modules(code))).toBe(code)
        checked += 1
      }
    }
    expect(checked).toBe(60)
  })
})

describe("serial room", () => {
  it("leaves the rest of the 12 payload digits for the serial", () => {
    expect(serialWidthFor("600")).toBe(9)
    expect(maxSerialFor("600")).toBe(999_999_999)
  })
})
