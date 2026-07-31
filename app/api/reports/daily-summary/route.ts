import { NextResponse, type NextRequest } from "next/server"

import { isAdminRole } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { shopToday } from "@/lib/format"
import { getDailySummary } from "@/lib/reports/daily-summary"
import {
  cellValue,
  columnDefs,
  parseSections,
  totalsRow,
} from "@/lib/reports/daily-summary-sections"
import { csvEscape } from "@/lib/reports/csv"

/**
 * The daily summary as a spreadsheet.
 *
 * Columns come from `columnDefs` — the same function the on-screen table uses —
 * so the file an owner sends to their accountant cannot disagree with the
 * screen they checked it against.
 *
 * A route handler rather than a server action because the browser needs a plain
 * GET it can download. Auth is re-checked here and not assumed: the proxy
 * guards pages, but this is reachable directly and returns the shop's takings.
 */


function isoDate(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

export async function GET(request: NextRequest) {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive || !isAdminRole(profile.role)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 })
  }

  const params = request.nextUrl.searchParams
  const to = isoDate(params.get("to")) ?? shopToday()
  const from =
    isoDate(params.get("from")) ??
    new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)

  const summary = await getDailySummary(from, to)
  const on = parseSections(params.get("sec") ?? undefined)
  const cols = columnDefs(summary, on)

  // Two header rows, matching the screen: the group above, the column below.
  // An accountant opening this should see the same shape they were shown.
  const groupRow = cols.map((c) => c.group)
  const headRow = cols.map((c) => c.head)
  const body = summary.rows.map((row) => cols.map((col) => cellValue(col, row)))
  const totals = totalsRow(summary, cols)

  const csv = [groupRow, headRow, ...body, totals]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kids-corner-daily-${from}-to-${to}.csv"`,
      // A report of the shop's takings must not sit in a shared cache.
      "Cache-Control": "no-store",
    },
  })
}
