import type { Metadata } from "next"
import Link from "next/link"
import { Download } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireAdminProfile } from "@/lib/auth/session"
import { PAYMENT_METHOD_LABELS, isPaymentMethod } from "@/lib/db-enums"
import { getDiscountReport } from "@/lib/discounts/queries"
import { formatDate, formatDateTime, formatRs, shopToday } from "@/lib/format"
import { DailySummaryTable } from "@/components/reports/daily-summary-table"
import { getDailySummary } from "@/lib/reports/daily-summary"
import {
  ALL_SECTIONS,
  parseSections,
  type SectionKey,
} from "@/lib/reports/daily-summary-sections"
import {
  getBestSellers,
  getMarginReport,
  getSalesSummary,
  getShiftReports,
} from "@/lib/reports/queries"
import { getSalesJournal } from "@/lib/reports/sales-journal"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Reports" }

const REPORTS = [
  { key: "summary", label: "Summary" },
  { key: "daily", label: "Daily summary" },
  { key: "methods", label: "By payment method" },
  { key: "cashiers", label: "By cashier" },
  { key: "bestsellers", label: "Best sellers" },
  { key: "margin", label: "Margin" },
  { key: "discounts", label: "Discounts given" },
  { key: "shifts", label: "Shifts (Z)" },
  { key: "journal", label: "Sales journal" },
] as const

type ReportKey = (typeof REPORTS)[number]["key"]

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function isoDate(v: string | undefined): string | undefined {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
}

/** Default range: the last 30 shop-days, ending today. */
function defaultRange(): { from: string; to: string } {
  const to = shopToday()
  const from = new Date(Date.parse(`${to}T12:00:00Z`) - 29 * 86_400_000)
    .toISOString()
    .slice(0, 10)
  return { from, to }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()

  const params = await searchParams
  const fallback = defaultRange()
  const from = isoDate(first(params.from)) ?? fallback.from
  const to = isoDate(first(params.to)) ?? fallback.to
  const active = (REPORTS.find((r) => r.key === first(params.report))?.key ??
    "summary") as ReportKey

  // Only the selected report is fetched — the summary is always needed for the
  // header figures, but nothing else runs unless it is on screen.
  const summary = await getSalesSummary(from, to)
  const sections = parseSections(first(params.sec))
  const daily =
    active === "daily"
      ? await getDailySummary(from, to)
      : { from, to, rows: [], methods: [], taxes: [], sellers: [], categories: [] }

  const [bestSellers, margin, discounts, shifts, journal] = await Promise.all([
    active === "bestsellers" ? getBestSellers(from, to) : Promise.resolve([]),
    active === "margin" ? getMarginReport(from, to) : Promise.resolve([]),
    active === "discounts"
      ? getDiscountReport(`${from}T00:00:00+04:00`, `${to}T23:59:59.999+04:00`)
      : Promise.resolve([]),
    active === "shifts" ? getShiftReports(from, to) : Promise.resolve([]),
    active === "journal"
      ? getSalesJournal(from, to)
      : Promise.resolve(null),
  ])

  const link = (key: string) =>
    `/reports?report=${key}&from=${from}&to=${to}`

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Reports</h1>
        <p className="text-muted-foreground text-sm">
          {formatDate(from)} to {formatDate(to)} · {summary.saleCount} sale
          {summary.saleCount === 1 ? "" : "s"} · {formatRs(summary.netTotal)} net
        </p>
      </header>

      {/* Plain GET form: the range is in the URL, so a report is shareable. */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="report" value={active} />
        <div className="space-y-2">
          <label htmlFor="from" className="text-sm font-medium">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from}
            className="border-input block h-9 rounded-lg border bg-transparent px-3 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="to" className="text-sm font-medium">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to}
            className="border-input block h-9 rounded-lg border bg-transparent px-3 text-sm"
          />
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        <Button
          variant="ghost"
          render={
            <a
              href={
                active === "daily"
                  ? `/api/reports/daily-summary?from=${from}&to=${to}&sec=${[...sections].join(",") || "none"}`
                  : `/api/reports/${active}?from=${from}&to=${to}`
              }
              download
            />
          }
        >
          <Download aria-hidden />
          CSV
        </Button>
      </form>

      <div className="flex flex-wrap gap-1 border-b">
        {REPORTS.map((r) => (
          <Link
            key={r.key}
            href={link(r.key)}
            aria-current={active === r.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active === r.key
                ? "border-brand-600 text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {active === "summary" ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Gross sales" value={formatRs(summary.grossTotal)} />
            <Stat
              label="Refunds"
              value={formatRs(summary.refundTotal)}
              hint={`${summary.refundCount} credit note${summary.refundCount === 1 ? "" : "s"}`}
            />
            <Stat label="Net" value={formatRs(summary.netTotal)} />
            <Stat
              label="Average basket"
              value={formatRs(summary.averageBasket)}
              hint={`${summary.itemCount} items sold`}
            />
            <Stat
              label="Discounts given"
              value={formatRs(summary.discountTotal)}
            />
            <Stat
              label="VAT included"
              value={formatRs(summary.vatTotal)}
              hint="contained in the totals, not added"
            />
          </div>

          <Section title="Daily takings">
            <SimpleTable
              head={["Day", "Sales", "Total"]}
              rows={summary.byDay.map((d) => [
                formatDate(d.date),
                String(d.saleCount),
                formatRs(d.total),
              ])}
              empty="No sales in this range."
            />
          </Section>
        </div>
      ) : null}

      {active === "daily" ? (
        <DailySummaryTable
          summary={daily}
          on={sections}
          href={(next: SectionKey[]) =>
            `/reports?report=daily&from=${from}&to=${to}&sec=${
              next.length === ALL_SECTIONS.length ? "" : next.join(",") || "none"
            }`
          }
        />
      ) : null}

      {active === "methods" ? (
        <SimpleTable
          head={["Method", "Taken"]}
          rows={summary.byMethod.map((m) => [
            isPaymentMethod(m.method) ? PAYMENT_METHOD_LABELS[m.method] : m.method,
            formatRs(m.amount),
          ])}
          empty="Nothing taken in this range."
        />
      ) : null}

      {active === "cashiers" ? (
        <SimpleTable
          head={["Cashier", "Sales", "Total"]}
          rows={summary.byCashier.map((c) => [
            c.name,
            String(c.saleCount),
            formatRs(c.total),
          ])}
          empty="No sales in this range."
        />
      ) : null}

      {active === "bestsellers" ? (
        <SimpleTable
          head={["Product", "Variant", "Qty", "Revenue"]}
          rows={bestSellers.map((b) => [
            b.productName,
            b.variant,
            String(b.qty),
            formatRs(b.revenue),
          ])}
          empty="Nothing sold in this range."
        />
      ) : null}

      {active === "margin" ? (
        <div className="space-y-3">
          <SimpleTable
            head={["Product", "Qty", "Revenue", "Cost", "Margin", "%"]}
            rows={margin.map((m) => [
              m.productName,
              String(m.qty),
              formatRs(m.revenue),
              formatRs(m.cost),
              formatRs(m.margin),
              `${m.marginPct.toFixed(1)}%`,
            ])}
            empty="Nothing sold in this range."
          />
          <p className="text-muted-foreground text-xs">
            Cost uses each variant&rsquo;s <em>current</em> cost price —
            <code>sale_items</code> doesn&rsquo;t record what an item cost on the
            day. If a supplier price has changed since, historical margin moves
            with it. Storing cost-at-sale would mean a new column on the sale
            line.
          </p>
        </div>
      ) : null}

      {active === "discounts" ? (
        <SimpleTable
          head={["Discount", "Times used", "Given away"]}
          rows={discounts.map((d) => [
            d.label,
            String(d.timesUsed),
            formatRs(d.totalGiven),
          ])}
          empty="No named discounts were applied in this range."
        />
      ) : null}

      {active === "journal" && journal ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Net of VAT"
              value={formatRs(journal.totals.net)}
              hint="what the VAT return calls turnover"
            />
            <Stat
              label="VAT"
              value={formatRs(journal.totals.vat)}
              hint="contained in the gross, not added to it"
            />
            <Stat label="Gross" value={formatRs(journal.totals.gross)} />
            <Stat
              label="Documents"
              value={String(journal.counts.sales + journal.counts.credits)}
              hint={`${journal.counts.sales} sales · ${journal.counts.credits} credit notes${
                journal.counts.voids > 0 ? ` · ${journal.counts.voids} void` : ""
              }`}
            />
          </div>

          {journal.truncated ? (
            <p className="text-destructive text-sm">
              More documents than this report reads. Narrow the dates — a
              truncated journal does not reconcile.
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead className="w-36">Reference</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="w-32">Method</TableHead>
                  <TableHead className="w-28 text-right">Net</TableHead>
                  <TableHead className="w-28 text-right">VAT</TableHead>
                  <TableHead className="w-32 text-right">Gross</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journal.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                      No documents in this period.
                    </TableCell>
                  </TableRow>
                ) : null}

                {journal.rows.map((row) => {
                  const isCredit = row.kind === "credit"
                  const isVoid = row.status === "void"
                  return (
                    <TableRow key={`${row.kind}-${row.reference}`}>
                      <TableCell className="text-muted-foreground text-xs">
                        <div>{formatDate(row.at)}</div>
                        <div>{row.at.slice(11, 16)}</div>
                      </TableCell>
                      <TableCell>
                        <div
                          className={cn(
                            "font-mono text-xs font-medium",
                            isCredit && "text-destructive",
                            isVoid && "text-muted-foreground line-through",
                          )}
                        >
                          {row.reference}
                        </div>
                        {/* A credit note is meaningless without the invoice it
                            reverses — that pairing is what an auditor traces. */}
                        {row.againstReference ? (
                          <div className="text-muted-foreground font-mono text-[11px]">
                            vs {row.againstReference}
                          </div>
                        ) : null}
                        {isVoid ? (
                          <div className="text-muted-foreground text-[11px]">
                            void — listed so the sequence has no gap
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {row.customerName ?? "Walk-in"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {row.methods.join(" + ") || "—"}
                      </TableCell>
                      {/* Negative figures are the point of this report, so they
                          are shown as negative rather than dressed up. */}
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          isCredit && "text-destructive",
                        )}
                      >
                        {formatRs(row.net)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-muted-foreground text-right tabular-nums",
                          isCredit && "text-destructive",
                        )}
                      >
                        {formatRs(row.vat)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          isCredit && "text-destructive",
                        )}
                      >
                        {formatRs(row.gross)}
                      </TableCell>
                    </TableRow>
                  )
                })}

                {journal.rows.length > 0 ? (
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell colSpan={4}>Total for the period</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRs(journal.totals.net)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRs(journal.totals.vat)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRs(journal.totals.gross)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      {active === "shifts" ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Opened</TableHead>
                <TableHead className="w-28">Z</TableHead>
                <TableHead className="w-36">By</TableHead>
                <TableHead className="w-28 text-right">Float</TableHead>
                <TableHead className="w-28 text-right">Expected</TableHead>
                <TableHead className="w-28 text-right">Counted</TableHead>
                <TableHead className="w-28 text-right">Variance</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground py-8 text-center">
                    No shifts opened in this range.
                  </TableCell>
                </TableRow>
              ) : (
                shifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(s.openedAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {s.zNo ? (
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium tabular-nums">{s.zNo}</span>
                          {/* Money the frozen slip does not account for. Flagged
                              rather than quietly folded in: the paper in the
                              shop's file is short by this much, and only a
                              person can decide what to do about it. */}
                          {s.unreported !== 0 ? (
                            <Badge variant="outline" className="text-warning-foreground">
                              +{formatRs(s.unreported)} after
                            </Badge>
                          ) : null}
                        </span>
                      ) : s.closedAt === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-muted-foreground" title="Closed before Z reports existed">
                          none
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {s.openedBy ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRs(s.openingFloat)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.expectedCash === null ? "—" : formatRs(s.expectedCash)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.countedCash === null ? "—" : formatRs(s.countedCash)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.closedAt === null ? (
                        <Badge variant="outline">Open</Badge>
                      ) : s.variance === null ? (
                        "—"
                      ) : (
                        <span
                          className={cn(
                            "font-medium",
                            s.variance === 0
                              ? "text-success"
                              : "text-warning-foreground",
                          )}
                        >
                          {s.variance > 0 ? "+" : ""}
                          {formatRs(s.variance)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate text-xs">
                      {s.notes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground text-sm">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
      </CardContent>
    </Card>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-base font-medium">{title}</h2>
      {children}
    </section>
  )
}

function SimpleTable({
  head,
  rows,
  empty,
}: {
  head: string[]
  rows: string[][]
  empty: string
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((h, i) => (
              <TableHead key={h} className={i === 0 ? undefined : "text-right"}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={head.length}
                className="text-muted-foreground py-8 text-center"
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => (
              <TableRow key={i}>
                {row.map((cell, j) => (
                  <TableCell
                    key={j}
                    className={
                      j === 0 ? "font-medium" : "text-right tabular-nums"
                    }
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
