import { describe, expect, it } from "vitest"

import { csvEscape, neutralise, toCsv } from "./csv"

/**
 * CSV escaping, which is a security control here and not only a format.
 *
 * Product names reach these exports through `/import`, from a supplier's own
 * spreadsheet — so a name beginning `=` or `@` is attacker-controlled text that
 * Excel will execute when the owner opens the download.
 */

describe("neutralise", () => {
  it.each(["=1+1", "+1", "-1+1", "@SUM(A1)", "\tsomething", "\rsomething"])(
    "defuses a value beginning %j",
    (value) => {
      expect(neutralise(value)).toBe(`'${value}`)
    },
  )

  it("leaves ordinary text alone", () => {
    expect(neutralise("Cotton romper")).toBe("Cotton romper")
    expect(neutralise("Size 3-6m")).toBe("Size 3-6m")
    expect(neutralise("")).toBe("")
  })

  it("defuses the classic command payload", () => {
    const attack = `=cmd|'/c calc'!A1`
    expect(neutralise(attack).startsWith("'")).toBe(true)
  })
})

describe("csvEscape", () => {
  it("writes numbers bare so the column stays numeric", () => {
    // Neutralising a negative would produce the literal '-145.14 and quietly
    // corrupt a reconciliation — the exact failure this must not cause.
    expect(csvEscape(-145.14)).toBe("-145.14")
    expect(csvEscape(0)).toBe("0")
    expect(csvEscape(1_306.28)).toBe("1306.28")
  })

  it("quotes a field containing a comma, quote or newline", () => {
    expect(csvEscape("Ramdin, Priya")).toBe('"Ramdin, Priya"')
    expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""')
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"')
    expect(csvEscape("carriage\rreturn")).toBe('"carriage\rreturn"')
  })

  it("doubles quotes rather than escaping them with a backslash", () => {
    // RFC 4180: a backslash means nothing to a spreadsheet.
    expect(csvEscape('a"b')).toBe('"a""b"')
  })

  it("leaves a plain field unquoted", () => {
    expect(csvEscape("Cotton romper")).toBe("Cotton romper")
  })

  it("both neutralises AND quotes when a field needs both", () => {
    // A formula that also contains a comma must not escape either treatment.
    const out = csvEscape("=SUM(A1,B1)")
    expect(out).toBe(`"'=SUM(A1,B1)"`)
  })
})

describe("toCsv", () => {
  it("separates records with CRLF, as the RFC specifies", () => {
    const csv = toCsv(["a", "b"], [["1", "2"]])
    expect(csv).toBe("a,b\r\n1,2")
  })

  it("carries the header even with no rows", () => {
    expect(toCsv(["Product", "Qty"], [])).toBe("Product,Qty")
  })

  it("escapes every cell, not only the first", () => {
    const csv = toCsv(["name", "note"], [["ok", "=BAD()"]])
    expect(csv).toContain("'=BAD()")
  })
})
