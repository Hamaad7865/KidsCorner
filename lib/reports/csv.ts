/**
 * CSV for the report downloads.
 *
 * One implementation rather than a copy in each route. The escaping here is a
 * security control as much as a formatting one, and two copies of a security
 * control is one that can drift out of step without anybody noticing.
 */

/**
 * Defuses a value a spreadsheet would treat as a formula.
 *
 * Not a theoretical path here: product names arrive through `/import` from a
 * supplier's own spreadsheet, so the shop does not control them. A name
 * beginning `=` or `@` is executed by Excel, Sheets and LibreOffice when the
 * owner opens the export.
 *
 * A leading apostrophe is the standard fix — every spreadsheet strips it on
 * display and treats the rest as text.
 */
export function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/**
 * One field, escaped to RFC 4180.
 *
 * Numbers are written bare. They cannot carry a formula, quoting them would
 * make Excel read the whole column as text, and neutralising them would turn a
 * negative figure like -145.14 into the literal string '-145.14 — which is
 * exactly the sort of quiet corruption a reconciliation cannot survive.
 */
export function csvEscape(value: string | number): string {
  if (typeof value === "number") return String(value)

  const s = neutralise(String(value))
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** A whole sheet. CRLF between records, as the RFC specifies. */
export function toCsv(head: string[], rows: (string | number)[][]): string {
  return [head, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n")
}
