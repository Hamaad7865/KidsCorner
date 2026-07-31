import { NextResponse, type NextRequest } from "next/server"

import { getSessionProfile } from "@/lib/auth/session"
import { isAdminRole } from "@/lib/auth/roles"
import { getDiscountReport } from "@/lib/discounts/queries"
import { shopToday } from "@/lib/format"
import {
  getBestSellers,
  getMarginReport,
  getSalesSummary,
  getShiftReports,
} from "@/lib/reports/queries"
import { toCsv } from "@/lib/reports/csv"
import { getSalesJournal } from "@/lib/reports/sales-journal"

/**
 * CSV export for each report, mirroring the Carfectionist module's
 * /api/reports/[slug]/csv.
 *
 * A route handler rather than a server action because the browser needs a plain
 * GET it can download; actions are POSTs with an RSC response.
 *
 * Auth is re-checked here, not assumed. The proxy protects pages, but this is
 * an API route reachable directly — an unauthenticated fetch must not return
 * the shop's takings.
 */


function isoDate(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const profile = await getSessionProfile()
  if (!profile || !profile.isActive || !isAdminRole(profile.role)) {
    return new NextResponse("Not authorised", { status: 401 })
  }

  const { slug } = await params
  const search = request.nextUrl.searchParams
  const to = isoDate(search.get("to")) ?? shopToday()
  const from =
    isoDate(search.get("from")) ??
    new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 86_400_000)
      .toISOString()
      .slice(0, 10)

  let csv: string

  switch (slug) {
    // The accountant's document. Columns in the order a VAT return wants
    // them, credit notes negative, and a totals row at the foot so the file
    // reconciles on its own without anybody re-adding it.
    case "journal": {
      const j = await getSalesJournal(from, to)
      csv = toCsv(
        [
          "Date",
          "Time",
          "Type",
          "Reference",
          "Against",
          "Customer",
          "Cashier",
          "Method",
          "Net",
          "VAT",
          "Gross",
          "Status",
        ],
        [
          ...j.rows.map((r) => [
            r.at.slice(0, 10),
            r.at.slice(11, 16),
            r.kind === "credit" ? "Credit note" : "Sale",
            r.reference,
            r.againstReference ?? "",
            r.customerName ?? "Walk-in",
            r.cashierName ?? "",
            r.methods.join(" + "),
            r.net.toFixed(2),
            r.vat.toFixed(2),
            r.gross.toFixed(2),
            r.status,
          ]),
          [
            "",
            "",
            "TOTAL",
            `${j.counts.sales} sales, ${j.counts.credits} credit notes`,
            "",
            "",
            "",
            "",
            j.totals.net.toFixed(2),
            j.totals.vat.toFixed(2),
            j.totals.gross.toFixed(2),
            j.truncated ? "TRUNCATED — narrow the dates" : "",
          ],
        ],
      )
      break
    }
    case "summary": {
      const s = await getSalesSummary(from, to)
      csv = toCsv(
        ["Day", "Sales", "Total"],
        s.byDay.map((d) => [d.date, d.saleCount, d.total.toFixed(2)]),
      )
      break
    }
    case "methods": {
      const s = await getSalesSummary(from, to)
      csv = toCsv(
        ["Method", "Taken"],
        s.byMethod.map((m) => [m.method, m.amount.toFixed(2)]),
      )
      break
    }
    case "cashiers": {
      const s = await getSalesSummary(from, to)
      csv = toCsv(
        ["Cashier", "Sales", "Total"],
        s.byCashier.map((c) => [c.name, c.saleCount, c.total.toFixed(2)]),
      )
      break
    }
    case "bestsellers": {
      const rows = await getBestSellers(from, to, 500)
      csv = toCsv(
        ["Product", "Variant", "Qty", "Revenue"],
        rows.map((b) => [b.productName, b.variant, b.qty, b.revenue.toFixed(2)]),
      )
      break
    }
    case "margin": {
      const rows = await getMarginReport(from, to, 500)
      csv = toCsv(
        ["Product", "Qty", "Revenue", "Cost", "Margin", "Margin %"],
        rows.map((m) => [
          m.productName,
          m.qty,
          m.revenue.toFixed(2),
          m.cost.toFixed(2),
          m.margin.toFixed(2),
          m.marginPct.toFixed(1),
        ]),
      )
      break
    }
    case "discounts": {
      const rows = await getDiscountReport(
        `${from}T00:00:00+04:00`,
        `${to}T23:59:59.999+04:00`,
      )
      csv = toCsv(
        ["Discount", "Times used", "Given away"],
        rows.map((d) => [d.label, d.timesUsed, d.totalGiven.toFixed(2)]),
      )
      break
    }
    case "shifts": {
      const rows = await getShiftReports(from, to)
      csv = toCsv(
        ["Shift", "Opened", "Closed", "Opened by", "Closed by", "Float",
         "Expected", "Counted", "Variance", "Notes"],
        rows.map((s) => [
          s.id,
          s.openedAt,
          s.closedAt ?? "",
          s.openedBy ?? "",
          s.closedBy ?? "",
          s.openingFloat.toFixed(2),
          s.expectedCash?.toFixed(2) ?? "",
          s.countedCash?.toFixed(2) ?? "",
          s.variance?.toFixed(2) ?? "",
          s.notes ?? "",
        ]),
      )
      break
    }
    default:
      return new NextResponse("Unknown report", { status: 404 })
  }

  return new NextResponse(
    // BOM so Excel opens it as UTF-8 rather than mangling accented product names.
    `﻿${csv}`,
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="kids-corner-${slug}-${from}-to-${to}.csv"`,
        // Takings are not something a shared cache should hold on to.
        "Cache-Control": "no-store",
      },
    },
  )
}
