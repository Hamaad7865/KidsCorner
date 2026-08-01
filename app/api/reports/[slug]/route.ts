import { NextResponse, type NextRequest } from "next/server"

import { getSessionProfile } from "@/lib/auth/session"
import { isAdminRole } from "@/lib/auth/roles"
import { isPaymentMethod } from "@/lib/db-enums"
import { getDiscountReport } from "@/lib/discounts/queries"
import { formatDateTime, shopDayOf, shopTimeOf, shopToday } from "@/lib/format"
import { getCollectedReport } from "@/lib/reports/collected"
import {
  getBestSellers,
  getMarginReport,
  getSalesSummary,
  getShiftReports,
} from "@/lib/reports/queries"
import { toCsv } from "@/lib/reports/csv"
import { getSalesJournal } from "@/lib/reports/sales-journal"
import { getVatReport } from "@/lib/reports/vat"
import { getPnlReport } from "@/lib/reports/pnl"

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
            // The shop's day and clock, not UTC's — slicing the ISO string
            // put a 01:14 sale on the previous day, four hours early, and
            // made the export disagree with the screen it sits next to.
            shopDayOf(r.at),
            shopTimeOf(r.at),
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
    // Collected by method: the payments list plus a per-method summary, so the
    // file reconciles on its own the way the screen does. `m` narrows both.
    case "methods": {
      const m = search.get("m")
      const report = await getCollectedReport(
        from,
        to,
        m && isPaymentMethod(m) ? m : undefined,
      )
      csv = toCsv(
        ["Date", "Type", "Document", "Customer", "Method", "Amount"],
        [
          // The shop's clock, matching the screen — the raw ISO instant is UTC,
          // which files a 01:14 sale under the previous day.
          ...report.rows.map((r) => [
            formatDateTime(r.at),
            r.kind === "refund" ? "Refund" : "Payment",
            r.reference,
            r.customerName ?? "Walk-in",
            r.method,
            r.amount.toFixed(2),
          ]),
          ["", "", "", "", "COLLECTED", report.collected.toFixed(2)],
          ...report.byMethod.map((x) => ["", "", "", "", x.method, x.amount.toFixed(2)]),
          ...(report.truncated
            ? [["", "", "", "", "TRUNCATED", "narrow the dates"]]
            : []),
        ],
      )
      break
    }
    // The VAT return, month by month — the shape the MRA form is typed from,
    // with the period total on the foot so the file reconciles on its own.
    case "vat": {
      const v = await getVatReport(from, to)
      csv = toCsv(
        ["Month", "Output VAT", "Input VAT", "Net payable"],
        [
          ...v.months.map((m) => [
            m.label,
            m.output.toFixed(2),
            m.input.toFixed(2),
            m.net.toFixed(2),
          ]),
          [
            "TOTAL",
            v.output.toFixed(2),
            v.input.toFixed(2),
            v.net.toFixed(2),
          ],
          // Carried into the file, not left on the screen: whoever opens this
          // in Excel to fill in a return needs to know input VAT is derived.
          [
            `Input VAT derived at ${(v.rate * 100).toFixed(1)}% from ${v.counts.purchases} received purchase(s) — check against supplier invoices before filing`,
            "",
            "",
            v.truncated ? "TRUNCATED — narrow the dates" : "",
          ],
        ],
      )
      break
    }
    case "pnl": {
      const p = await getPnlReport(from, to)
      csv = toCsv(
        ["Line", "Detail", "Amount"],
        [
          ["Revenue", "Sales less credit notes, VAT taken out", p.revenue.toFixed(2)],
          ["Cost of goods sold", "At today's cost price", (-p.cost).toFixed(2)],
          ["Gross profit", `${p.grossPct.toFixed(1)}% of revenue`, p.gross.toFixed(2)],
          ...p.expenseRows.map((e) => [
            "Paid out",
            e.count > 1 ? `${e.reason} (×${e.count})` : e.reason,
            (-e.amount).toFixed(2),
          ]),
          ["Cash paid out of the till", `${p.counts.payouts} pay-out(s)`, (-p.expenses).toFixed(2)],
          ["Net profit", p.truncated ? "TRUNCATED — narrow the dates" : "", p.net.toFixed(2)],
        ],
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
