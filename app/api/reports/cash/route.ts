import { NextResponse } from "next/server"

import { isAdminRole } from "@/lib/auth/roles"
import { getSessionProfile } from "@/lib/auth/session"
import { getPosOverview } from "@/lib/pos/overview"
import { toCsv } from "@/lib/reports/csv"

/**
 * Recent cash-ups, for whoever reconciles the takings.
 *
 * Every closed shift with what the drawer should have held, what was counted,
 * and the difference — the record that answers "was the till right on the
 * 14th" without anybody reconstructing it from sales.
 */
export async function GET() {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive || !isAdminRole(profile.role)) {
    return new NextResponse("Not authorised.", { status: 403 })
  }

  const data = await getPosOverview()

  const csv = toCsv(
    ["Opened", "Closed", "Opened by", "Closed by", "Expected", "Counted", "Variance"],
    data.recent.map((r) => [
      r.openedAt,
      r.closedAt ?? "",
      r.openedByName ?? "",
      r.closedByName ?? "",
      r.expected.toFixed(2),
      r.counted.toFixed(2),
      // Signed, so a short drawer reads as short in a spreadsheet rather than
      // needing the sign inferred from a column of absolute values.
      r.variance.toFixed(2),
    ]),
  )

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="kids-corner-cash-ups.csv"`,
    },
  })
}
