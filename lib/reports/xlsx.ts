import * as XLSX from "xlsx"

import { neutralise, type ReportCell } from "./csv"

/** A real SheetJS workbook built from the exact table used by the CSV export. */
export function toXlsx(
  head: string[],
  rows: ReportCell[][],
  sheetName: string,
): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  const safeName = sheetName.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31) || "Report"
  const safeCells = [head, ...rows].map((row) =>
    row.map((cell) => (typeof cell === "string" ? neutralise(cell) : cell)),
  )
  const sheet = XLSX.utils.aoa_to_sheet(safeCells)
  XLSX.utils.book_append_sheet(workbook, sheet, safeName)
  const bytes = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Uint8Array
  return Uint8Array.from(bytes).buffer
}
