import * as XLSX from "xlsx"
import { describe, expect, it } from "vitest"

import { toXlsx } from "./xlsx"

describe("toXlsx", () => {
  it("writes the same frozen columns and values supplied to CSV", () => {
    const head = ["VAT status", "VAT rate", "Net", "VAT", "Gross"]
    const rows = [
      ["Not VAT registered", "", "115.00", "0.00", "115.00"],
      ["VAT registered", "15.00%", "100.00", "15.00", "115.00"],
    ]

    const workbook = XLSX.read(toXlsx(head, rows, "Journal"))
    const values = XLSX.utils.sheet_to_json(workbook.Sheets.Journal!, {
      header: 1,
      raw: false,
    })

    expect(values).toEqual([head, ...rows])
  })

  it("neutralises formula-like text exactly as the CSV exporter does", () => {
    const workbook = XLSX.read(toXlsx(["Product"], [["=cmd|'/c calc'!A1"]], "Safe"))
    const values = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Safe!, {
      header: 1,
      raw: false,
    })

    expect(values).toEqual([["Product"], ["'=cmd|'/c calc'!A1"]])
  })
})
