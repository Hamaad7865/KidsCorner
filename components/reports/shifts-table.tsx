import { Fragment } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, formatRs, shopTimeOf } from "@/lib/format"
import type { ShiftReport } from "@/lib/reports/queries"
import { cn } from "@/lib/utils"

/**
 * The Shifts (Z) tab.
 *
 * Lifted out of the reports page so the one part of it with real logic can be
 * tested: what happens when a shift's frozen Z does not agree with the money
 * the shift actually holds. That case is rare, it is the reason the tab exists,
 * and until now the screen could only say an amount was missing without saying
 * what was missing.
 */

/**
 * What the listed late sales come to.
 *
 * Summed from the rows actually on screen, so it can never claim more than it
 * shows — and when the list is capped, the notice underneath explains the rest.
 */
export function lateTotal(shift: { lateSales: { total: number }[] }): number {
  return shift.lateSales.reduce((sum, late) => sum + late.total, 0)
}

export function ShiftsTable({ shifts }: { shifts: ShiftReport[] }) {
  return (
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
              <Fragment key={s.id}>
              <TableRow>
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
                          person can decide what to do about it.

                          The sign matters and used to be ignored. A shift
                          can also end up holding LESS than its Z claimed —
                          a sale voided or refunded after the close does
                          that — and the badge read "+Rs -500.00 after",
                          which is not a sentence. The two cases are
                          different events and now say so. */}
                      {s.unreported > 0 ? (
                        <Badge variant="outline" className="text-warning">
                          +{formatRs(s.unreported)} after
                        </Badge>
                      ) : s.unreported < 0 ? (
                        <Badge variant="outline" className="text-destructive">
                          {formatRs(-s.unreported)} reversed after
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
                          : "text-warning",
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

              {/* The sales behind the badge.
                  Shown outright rather than behind a click: this row only
                  exists when the shop's own Z slip is short, which is rare
                  and is the moment an owner most needs the receipt numbers
                  — not a control to discover. */}
              {s.lateSales.length > 0 ? (
                <TableRow className="bg-warning-muted/40 hover:bg-warning-muted/40">
                  <TableCell colSpan={8} className="py-2.5">
                    {/* The listed total, not the badge's figure. They are
                        the same on an ordinary late arrival, but they are
                        computed differently — `unreported` is the whole
                        shift's sales less what the Z claimed, so a void or
                        a refund after the close moves it and does not move
                        this list. Claiming one is the other would be right
                        most of the time, which is the worst kind of wrong
                        on a reconciliation screen. */}
                    <div className="text-warning text-xs font-semibold">
                      {s.lateCount} sale{s.lateCount === 1 ? "" : "s"} landed
                      after Z {s.zNo} was frozen, totalling{" "}
                      {formatRs(lateTotal(s))}
                    </div>
                    {s.lateCount === s.lateSales.length &&
                    Math.abs(s.unreported - lateTotal(s)) > 0.005 ? (
                      <div className="text-destructive mt-1 text-xs">
                        The slip is out by {formatRs(s.unreported)} overall,
                        not {formatRs(lateTotal(s))} — something else in this
                        shift was voided or refunded after the close.
                      </div>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      {s.lateSales.map((late) => (
                        <Link
                          key={late.saleId}
                          href={`/sales/${late.saleId}`}
                          className="text-muted-foreground hover:text-foreground text-xs hover:underline"
                        >
                          <span className="font-mono font-medium">
                            {late.saleNo}
                          </span>{" "}
                          <span className="tabular-nums">
                            {formatRs(late.total)}
                          </span>{" "}
                          <span>{shopTimeOf(late.at)}</span>
                        </Link>
                      ))}
                    </div>
                    {/* The badge's count is always the true one. If the
                        list is shorter, it has to say so rather than let
                        the two figures quietly disagree. */}
                    {s.lateCount > s.lateSales.length ? (
                      <div className="text-muted-foreground mt-1.5 text-[11px]">
                        Showing the {s.lateSales.length} most recent of{" "}
                        {s.lateCount}.
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ) : null}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
