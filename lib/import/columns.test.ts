import { describe, expect, it } from "vitest"

import { parseMoney, parseQty } from "./columns"

/**
 * Number parsing for the CSV importer.
 *
 * A shop in Mauritius receives spreadsheets in both conventions — an
 * English-locale export writes "1,234.50" and a French-locale one writes
 * "1 234,50" for the same money. Getting this wrong does not fail loudly: it
 * produces a finite number, passes validation, and puts a hundredfold price on
 * the shelf.
 */
describe("parseMoney", () => {
  it("reads the English convention", () => {
    expect(parseMoney("1,234.50")).toBe(1234.5)
    expect(parseMoney("Rs 1,250.00")).toBe(1250)
    expect(parseMoney("999.99")).toBe(999.99)
  })

  it("reads the French convention, which is just as common here", () => {
    // The bug this replaces read these as 123450 and 123450 — a shelf price of
    // Rs 123,450 on a Rs 1,234.50 garment.
    expect(parseMoney("1 234,50")).toBe(1234.5)
    expect(parseMoney("1.234,50")).toBe(1234.5)
    expect(parseMoney("999,99")).toBe(999.99)
  })

  it("strips the non-breaking and narrow spaces Excel actually emits", () => {
    expect(parseMoney("1 234,50")).toBe(1234.5)
    expect(parseMoney("1 234,50")).toBe(1234.5)
  })

  it("treats a separator grouping exactly three digits as thousands", () => {
    // Ambiguous in isolation, but money here is quoted to two decimals, so a
    // three-decimal price is a misread grouping far more often than a figure.
    expect(parseMoney("1,234")).toBe(1234)
    expect(parseMoney("1.234")).toBe(1234)
    expect(parseMoney("1,234,567")).toBe(1234567)
  })

  it("treats one or two trailing digits as a decimal, either way round", () => {
    expect(parseMoney("1,5")).toBe(1.5)
    expect(parseMoney("1.5")).toBe(1.5)
    expect(parseMoney("1,50")).toBe(1.5)
    expect(parseMoney("1.50")).toBe(1.5)
  })

  it("keeps a negative", () => {
    expect(parseMoney("-250,75")).toBe(-250.75)
    expect(parseMoney("-1,234.50")).toBe(-1234.5)
  })

  it("returns null for a blank or unparseable cell rather than zero", () => {
    // Null means "not given"; zero would be a free product.
    expect(parseMoney("")).toBeNull()
    expect(parseMoney(undefined)).toBeNull()
    expect(parseMoney("n/a")).toBeNull()
    expect(parseMoney("-")).toBeNull()
  })
})

describe("parseQty", () => {
  it("truncates to whole units", () => {
    expect(parseQty("12")).toBe(12)
    expect(parseQty("12.9")).toBe(12)
    expect(parseQty("12,9")).toBe(12)
  })

  it("does not turn a French one-and-a-half into fifteen", () => {
    // "1,5" stripped of its comma is 15 — fifteen units of stock booked in
    // where the sheet said one.
    expect(parseQty("1,5")).toBe(1)
  })

  it("reads a grouped thousand as a thousand", () => {
    expect(parseQty("1,200")).toBe(1200)
    expect(parseQty("1 200")).toBe(1200)
  })

  it("returns null for a blank cell", () => {
    expect(parseQty("")).toBeNull()
    expect(parseQty(undefined)).toBeNull()
  })
})
