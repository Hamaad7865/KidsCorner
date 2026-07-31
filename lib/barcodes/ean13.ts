/**
 * EAN-13: check digit, assembly from a shop prefix, and module encoding.
 *
 * Pure functions with no imports, so the same code runs in a server action that
 * allocates codes and in the client component that draws the label preview.
 *
 * A note on why this is hand-rolled rather than a dependency: EAN-13 is a fixed
 * 95-module symbology that has not changed since 1977. The whole specification
 * is the three tables below.
 */

/** Digits in a full code, check digit included. */
export const EAN13_LENGTH = 13

/** The prefix and the serial together must fill the 12 payload digits. */
export const EAN13_PAYLOAD_LENGTH = 12

/**
 * Left-hand digit encodings. Odd parity (L) and even parity (G) — which of the
 * two is used for each of the six left digits is what encodes the *first*
 * digit, since a 13-digit code only has room to draw 12.
 */
const L_CODES = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
] as const

const G_CODES = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
] as const

/** Right-hand digits are always even parity, and are the L codes inverted. */
const R_CODES = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
] as const

/** Parity of the six left digits, selected by the first digit of the code. */
const PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
] as const

const GUARD_START = "101"
const GUARD_CENTRE = "01010"
const GUARD_END = "101"

/** Modules in a complete symbol: 3 + 42 + 5 + 42 + 3. */
export const EAN13_MODULES = 95

function isDigits(value: string): boolean {
  return /^\d+$/.test(value)
}

/**
 * The check digit for a 12-digit payload.
 *
 * Weights alternate 1,3,1,3… from the left; the check digit is whatever takes
 * the weighted sum up to the next multiple of ten.
 */
export function ean13CheckDigit(payload: string): number {
  if (payload.length !== EAN13_PAYLOAD_LENGTH || !isDigits(payload)) {
    throw new Error(`An EAN-13 payload is ${EAN13_PAYLOAD_LENGTH} digits`)
  }

  let sum = 0
  for (let i = 0; i < EAN13_PAYLOAD_LENGTH; i += 1) {
    sum += Number(payload[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return (10 - (sum % 10)) % 10
}

/** True when `code` is 13 digits and its final digit is the correct check. */
export function isValidEan13(code: string): boolean {
  if (code.length !== EAN13_LENGTH || !isDigits(code)) return false
  return ean13CheckDigit(code.slice(0, EAN13_PAYLOAD_LENGTH)) === Number(code[12])
}

/** How many digits of serial a given prefix leaves room for. */
export function serialWidthFor(prefix: string): number {
  return EAN13_PAYLOAD_LENGTH - prefix.length
}

/** The largest serial that still fits beside `prefix`. */
export function maxSerialFor(prefix: string): number {
  return 10 ** serialWidthFor(prefix) - 1
}

/**
 * Rejects a prefix that could not produce a usable code, with a message meant
 * for the person typing it into Settings rather than for a log.
 */
export function prefixProblem(prefix: string): string | null {
  if (!prefix) return "Enter a prefix — it is what marks a code as yours."
  if (!isDigits(prefix)) return "A prefix is digits only."
  if (prefix.length > EAN13_PAYLOAD_LENGTH - 3) {
    return `Leave room for the serial — ${EAN13_PAYLOAD_LENGTH - 3} digits at most.`
  }
  return null
}

/**
 * Builds a full EAN-13 from a shop prefix and a serial number.
 *
 * Throws rather than truncating when the serial has outgrown the space the
 * prefix left it: a silently wrapped serial would re-issue a code that is
 * already on a shelf label.
 */
export function buildEan13(prefix: string, serial: number): string {
  const problem = prefixProblem(prefix)
  if (problem) throw new Error(problem)

  if (!Number.isInteger(serial) || serial < 0) {
    throw new Error("A barcode serial is a whole number, zero or greater.")
  }

  const width = serialWidthFor(prefix)
  if (serial > maxSerialFor(prefix)) {
    throw new Error(
      `Serial ${serial} does not fit in ${width} digits. Shorten the prefix.`,
    )
  }

  const payload = prefix + String(serial).padStart(width, "0")
  return payload + String(ean13CheckDigit(payload))
}

/**
 * Encodes a code to its 95 modules, as a string of "0" (space) and "1" (bar).
 *
 * Returned as a string rather than an array because every caller either
 * iterates it or measures its length, and this keeps the label renderer's inner
 * loop free of allocation.
 */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) {
    throw new Error(`Not a valid EAN-13: ${code}`)
  }

  const digits = code.split("").map(Number)
  const parity = PARITY[digits[0]]

  let left = ""
  for (let i = 0; i < 6; i += 1) {
    const digit = digits[i + 1]
    left += parity[i] === "L" ? L_CODES[digit] : G_CODES[digit]
  }

  let right = ""
  for (let i = 0; i < 6; i += 1) {
    right += R_CODES[digits[i + 7]]
  }

  return GUARD_START + left + GUARD_CENTRE + right + GUARD_END
}

/**
 * Collapses the module string into runs of bars, ready to draw as rects.
 *
 * One rect per run rather than per module: a scanner reads the same symbol
 * either way, but this turns ~30 elements into a label instead of 95, which
 * matters when a sheet holds 24 of them.
 */
export function ean13Bars(code: string): Array<{ x: number; width: number }> {
  const modules = ean13Modules(code)
  const bars: Array<{ x: number; width: number }> = []

  let run = 0
  for (let i = 0; i < modules.length; i += 1) {
    if (modules[i] === "1") {
      run += 1
      continue
    }
    if (run > 0) {
      bars.push({ x: i - run, width: run })
      run = 0
    }
  }
  if (run > 0) bars.push({ x: modules.length - run, width: run })

  return bars
}

/**
 * Splits a code the way it is printed under the symbol: the first digit sits
 * outside the bars, then two groups of six.
 */
export function ean13HumanGroups(code: string): [string, string, string] {
  return [code.slice(0, 1), code.slice(1, 7), code.slice(7)]
}
