import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { DateRangeFilter, RefDatePicker } from "@/components/pos/flow-dates"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, formatRs } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  flowTotal,
  methodLabel,
  type CashFlow,
  type Inflow,
  type Outflow,
} from "@/lib/pos/cash-flow"

/**
 * The Cash flow tab, laid out section for section as Carfectionist has it:
 * a closure history on a reference date, then the period's movements in and
 * out with a total on each.
 *
 * Struck rows — a voided sale's payment, an exchange that moved no money — are
 * rendered muted and lined through rather than dropped. The total beside the
 * heading skips them, so the page shows both what happened and what it came to.
 */
export function CashFlowTab({
  flow,
  basePath,
  params,
  action,
}: {
  flow: CashFlow
  basePath: string
  params: Record<string, string | undefined>
  /** The Cash out button, when the viewer may use it — composed by the page
   *  so this component stays free of role checks. */
  action?: React.ReactNode
}) {
  const inflowTotal = flowTotal(flow.inflows)
  const outflowTotal = flowTotal(flow.outflows)

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-base font-semibold">History</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Cash flow information is saved at each till closure.
              </p>
            </div>
            <RefDatePicker basePath={basePath} params={params} value={flow.refDate} />
          </div>

          {flow.closures.length === 0 ? (
            <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
              No till closure on this date.
            </div>
          ) : (
            flow.closures.map((closure) => (
              <div key={closure.shiftId} className="space-y-3 border-t pt-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-semibold tabular-nums">
                    {formatDateTime(closure.closedAt)}
                  </span>
                  {closure.closedByName ? (
                    <span className="text-muted-foreground">
                      closed by {closure.closedByName}
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Tile label="Opening float" value={formatRs(closure.openingFloat)} />
                  <Tile
                    label={closure.cashOut !== 0 ? "Cash in / out" : "Cash in"}
                    value={formatRs(closure.cashIn)}
                    extra={
                      closure.cashOut !== 0 ? (
                        <span className="text-destructive"> {formatRs(closure.cashOut)}</span>
                      ) : null
                    }
                  />
                  <Tile label="Counted at close" value={formatRs(closure.counted)} />
                  <Tile
                    label="Variance"
                    value={formatRs(closure.variance)}
                    tone={
                      closure.variance === 0
                        ? "text-success"
                        : closure.variance < 0
                          ? "text-destructive"
                          : "text-warning"
                    }
                  />
                </div>

                {closure.nonCash.length > 0 ||
                closure.disbursed !== 0 ||
                closure.refunded !== 0 ? (
                  <div className="bg-brand-50 text-foreground rounded-lg px-4 py-2.5 text-sm">
                    {closure.nonCash.length > 0 ? (
                      <>
                        <span className="text-brand-700 font-semibold">Not in the drawer:</span>{" "}
                        {closure.nonCash
                          .map(
                            (n) =>
                              `${methodLabel(n.method)} ${formatRs(n.amount)} straight to the bank`,
                          )
                          .join(" · ")}
                      </>
                    ) : null}
                    {closure.refunded !== 0 ? (
                      <span>
                        {closure.nonCash.length > 0 ? " · " : ""}
                        <span className="text-destructive font-semibold">Cash refunds</span>{" "}
                        {formatRs(closure.refunded)}
                      </span>
                    ) : null}
                    {closure.disbursed !== 0 ? (
                      <span>
                        {closure.nonCash.length > 0 || closure.refunded !== 0 ? " · " : ""}
                        <span className="text-destructive font-semibold">Disbursement</span>{" "}
                        {formatRs(closure.disbursed)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-base font-semibold">Cash movements</h2>
              <p className="text-muted-foreground mt-0.5 text-sm">
                Every payment in and out of this till over the period.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {action}
              <DateRangeFilter
                basePath={basePath}
                params={params}
                from={flow.from}
                to={flow.to}
              />
            </div>
          </div>

          {flow.truncated ? (
            <p className="text-warning text-sm">
              This period covers more shifts than one view reads. Narrow the dates
              to see all of it.
            </p>
          ) : null}

          <FlowTable
            title="Cash inflows"
            total={inflowTotal}
            totalTone="text-success"
            headers={["Date", "User", "Method", "Ref", "Amount"]}
            empty={flow.inflows.length === 0}
          >
            {flow.inflows.map((row) => (
              <InflowRow key={row.key} row={row} />
            ))}
          </FlowTable>

          <FlowTable
            title="Cash outflows"
            total={outflowTotal}
            totalTone="text-destructive"
            headers={["Date", "User", "Method", "Amount", "Type", "Comment"]}
            empty={flow.outflows.length === 0}
          >
            {flow.outflows.map((row) => (
              <OutflowRow key={row.key} row={row} />
            ))}
          </FlowTable>
        </CardContent>
      </Card>
    </div>
  )
}

function Tile({
  label,
  value,
  extra,
  tone,
}: {
  label: string
  value: string
  extra?: React.ReactNode
  tone?: string
}) {
  return (
    <div className="bg-muted/50 rounded-lg p-4">
      <div className="text-muted-foreground text-xs font-semibold">{label}</div>
      <div className={cn("mt-1.5 text-base font-semibold tabular-nums", tone)}>
        {value}
        {extra}
      </div>
    </div>
  )
}

function FlowTable({
  title,
  total,
  totalTone,
  headers,
  empty,
  children,
}: {
  title: string
  total: number
  totalTone: string
  headers: string[]
  empty: boolean
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="bg-muted/50 flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {title}
        </span>
        <span className={cn("text-sm font-semibold tabular-nums", totalTone)}>
          {formatRs(total)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((header) => (
                <TableHead
                  key={header}
                  className={header === "Amount" ? "w-32 text-right" : undefined}
                >
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {empty ? (
              <TableRow>
                <TableCell
                  colSpan={headers.length}
                  className="text-muted-foreground py-8 text-center"
                >
                  No data for this period.
                </TableCell>
              </TableRow>
            ) : null}
            {children}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function InflowRow({ row }: { row: Inflow }) {
  return (
    <TableRow className={row.struck ? "bg-muted/30" : undefined}>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {formatDateTime(row.at)}
      </TableCell>
      <TableCell className={cn("text-sm", row.struck && "text-muted-foreground")}>
        {row.byName ?? "—"}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        <span className="flex items-center gap-1.5">
          {methodLabel(row.method)}
          {row.struck ? <Badge variant="secondary">Void</Badge> : null}
        </span>
      </TableCell>
      <TableCell className="text-sm font-medium">
        {row.saleId ? (
          <Link
            href={`/sales/${row.saleId}`}
            className={cn("hover:underline", row.struck ? "text-muted-foreground" : "text-brand-700")}
          >
            {row.reference ?? "—"}
          </Link>
        ) : (
          <span className="text-muted-foreground">{row.reference ?? "—"}</span>
        )}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-semibold tabular-nums",
          row.struck && "text-muted-foreground line-through",
        )}
      >
        {formatRs(row.amount)}
      </TableCell>
    </TableRow>
  )
}

function OutflowRow({ row }: { row: Outflow }) {
  return (
    <TableRow className={row.struck ? "bg-muted/30" : undefined}>
      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
        {formatDateTime(row.at)}
      </TableCell>
      <TableCell className={cn("text-sm", row.struck && "text-muted-foreground")}>
        {row.byName ?? "—"}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {methodLabel(row.method)}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-semibold tabular-nums",
          row.struck ? "text-muted-foreground line-through" : "text-destructive",
        )}
      >
        {formatRs(row.amount)}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
        {row.type}
      </TableCell>
      <TableCell className="max-w-xs truncate text-sm" title={row.comment}>
        {row.saleId ? (
          <Link
            href={`/sales/${row.saleId}`}
            className={cn(
              "font-medium hover:underline",
              row.struck ? "text-muted-foreground" : "text-brand-700",
            )}
          >
            {row.comment || "—"}
          </Link>
        ) : (
          <span className="text-muted-foreground">{row.comment || "—"}</span>
        )}
      </TableCell>
    </TableRow>
  )
}
