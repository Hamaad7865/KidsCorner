import Link from "next/link"
import { CircleAlert, Wallet } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { AGING_COLUMNS } from "@/lib/credit/aging"
import type { Receivables } from "@/lib/credit/queries"
import { formatDate, formatRs } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Who owes the shop money, and how late it is.
 *
 * Ordered by the oldest trouble rather than the biggest balance, because that
 * is the order the calls get made in: Rs 400 that is four months late is a
 * worse sign than Rs 4,000 billed last week.
 *
 * The date range at the top of the reports page does not apply here, and the
 * heading says so. A balance is a position, not a flow.
 */
export function ReceivablesTable({ report }: { report: Receivables }) {
  const { totals } = report
  const overdue = report.rows.filter((row) => row.aging.total > 0 && row.aging.current < row.aging.total)

  if (report.rows.length === 0) {
    return (
      <div className="space-y-4">
        <Summary report={report} />
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Wallet className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">Nothing owed</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {report.settledCount > 0
              ? `${report.settledCount} account${report.settledCount === 1 ? "" : "s"} open and fully settled.`
              : "No customer has a credit account yet. Open one from a customer's page."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Summary report={report} />

      {report.truncated ? (
        <p className="text-warning text-sm">
          This shop has more accounts or ledger entries than one view reads, so
          the figures below are partial.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              {AGING_COLUMNS.map((column) => (
                <TableHead key={column.key} className="w-32 text-right">
                  {column.label}
                </TableHead>
              ))}
              <TableHead className="w-32 text-right">Owed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map((row) => (
              <TableRow key={row.customerId}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/customers/${row.customerId}`}
                      className="text-brand-700 font-medium hover:underline"
                    >
                      {row.fullName}
                    </Link>
                    {row.onHold ? <Badge variant="outline">On hold</Badge> : null}
                    {!row.creditEnabled ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Closed
                      </Badge>
                    ) : null}
                  </div>
                  {row.phone ? (
                    <p className="text-muted-foreground mt-0.5 text-xs">{row.phone}</p>
                  ) : null}
                </TableCell>
                {AGING_COLUMNS.map((column) => {
                  const value = row.aging[column.key]
                  return (
                    <TableCell
                      key={column.key}
                      className={cn(
                        "text-right tabular-nums",
                        column.key !== "current" && value > 0
                          ? "text-destructive font-medium"
                          : value === 0
                            ? "text-muted-foreground"
                            : "",
                      )}
                    >
                      {value === 0 ? "—" : formatRs(value)}
                    </TableCell>
                  )
                })}
                <TableCell className="text-right font-semibold tabular-nums">
                  {row.aging.inCredit > 0 && row.aging.total === 0
                    ? `(${formatRs(row.aging.inCredit)})`
                    : formatRs(row.aging.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">
                {report.rows.length} account{report.rows.length === 1 ? "" : "s"}
              </TableCell>
              {AGING_COLUMNS.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    column.key !== "current" && totals[column.key] > 0
                      ? "text-destructive"
                      : "",
                  )}
                >
                  {totals[column.key] === 0 ? "—" : formatRs(totals[column.key])}
                </TableCell>
              ))}
              <TableCell className="text-right font-semibold tabular-nums">
                {formatRs(totals.total)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {overdue.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border p-3">
          <CircleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-sm">
            {overdue.length} account{overdue.length === 1 ? " has" : "s have"}{" "}
            money past its due date. A parenthesised figure is money the shop is
            holding for the customer, not a debt.
          </p>
        </div>
      ) : null}

      <p className="text-muted-foreground text-xs">
        Payments are applied oldest-first, so a customer who keeps paying roughly
        what they spend shows no old debt even if they have owed something
        continuously. The shop&rsquo;s exposure is the Owed column; the bands
        describe the age of the money it has not been given.
      </p>
    </div>
  )
}

function Summary({ report }: { report: Receivables }) {
  const overdueTotal =
    report.totals.days1to30 + report.totals.days31to60 + report.totals.days60plus

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="border-brand-200 from-brand-50 bg-gradient-to-br to-white">
        <CardContent className="py-4">
          <div className="text-brand-800 text-sm font-medium">
            Owed as at {formatDate(report.asAt)}
          </div>
          <div className="text-brand-900 mt-1 text-3xl font-semibold tabular-nums">
            {formatRs(report.outstanding)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <div
            className={cn(
              "text-2xl font-semibold tabular-nums",
              overdueTotal > 0 && "text-destructive",
            )}
          >
            {formatRs(overdueTotal)}
          </div>
          <div className="text-muted-foreground text-sm">Past its due date</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <div
            className={cn(
              "text-2xl font-semibold tabular-nums",
              report.totals.days60plus > 0 && "text-destructive",
            )}
          >
            {formatRs(report.totals.days60plus)}
          </div>
          <div className="text-muted-foreground text-sm">Over 60 days</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="py-4">
          <div className="text-2xl font-semibold tabular-nums">
            {formatRs(report.heldInCredit)}
          </div>
          <div className="text-muted-foreground text-sm">
            Held for customers
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
