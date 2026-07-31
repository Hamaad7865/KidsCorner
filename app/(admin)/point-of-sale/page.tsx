import type { Metadata } from "next"
import Link from "next/link"
import { Download, Monitor, Store } from "lucide-react"

import { CloseTillRemotely } from "@/components/pos/close-till-remotely"
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
import { formatDateTime, formatQty, formatRs } from "@/lib/format"
import { getPosOverview } from "@/lib/pos/overview"

export const metadata: Metadata = { title: "Point of sale" }

/**
 * The back office's view of the till — Carfectionist's Point of Sale module.
 *
 * It answers the three questions an owner has about a till they are not
 * standing at: is it open, what is in the drawer, and did the last few days
 * reconcile. Everything else about the till lives on the till.
 */
export default async function PointOfSalePage() {
  const profile = await requireAdminProfile()
  const data = await getPosOverview()

  const canClose = profile.role === "owner" || profile.role === "manager"

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">Point of sale</h1>
          <p className="text-muted-foreground text-sm">
            {data.shopName} · {data.openTill ? "till open" : "till closed"}
          </p>
        </div>
        <Button variant="outline" render={<Link href="/pos" />}>
          <Monitor aria-hidden />
          Open the till
        </Button>
      </header>

      {/* ── the till itself ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
          <Store className="size-4" aria-hidden />
          Till
        </div>

        {data.openTill ? (
          <Card>
            <CardContent className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
                    <span className="font-medium">Open</span>
                    <Badge variant="secondary">
                      {formatQty(data.openTill.ticketCount)} sale
                      {data.openTill.ticketCount === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Since {formatDateTime(data.openTill.openedAt)}
                    {data.openTill.openedByName ? ` · ${data.openTill.openedByName}` : ""}
                  </p>
                </div>
                {canClose ? <CloseTillRemotely till={data.openTill} /> : null}
              </div>

              <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
                <Figure
                  label="Sales"
                  value={formatRs(data.openTill.salesTotal)}
                  hint={`${formatQty(data.openTill.ticketCount)} ticket${data.openTill.ticketCount === 1 ? "" : "s"}`}
                />
                <Figure
                  label="Cash collected"
                  value={formatRs(data.openTill.cashCollected)}
                  hint="through the drawer"
                />
                <Figure
                  label="Expected in drawer"
                  value={formatRs(data.openTill.expected)}
                  /* The arithmetic is spelled out because "collected 5,158 ·
                     expected 7,158" reads as a fault until you remember the
                     float that was put in at open. */
                  hint={[
                    `incl. ${formatRs(data.openTill.openingFloat)} float`,
                    data.openTill.tillMovements !== 0
                      ? `${formatRs(data.openTill.tillMovements)} paid in/out`
                      : null,
                    data.openTill.cashRefunded !== 0
                      ? `${formatRs(data.openTill.cashRefunded)} refunded`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="text-muted-foreground py-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="bg-muted-foreground/40 size-2 rounded-full" aria-hidden />
                Closed. The next shift starts when someone counts the float in —
                on the tablet, or from{" "}
                <Link href="/pos" className="hover:text-brand-700 underline">
                  the web till
                </Link>
                .
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── the reconciliation history ──────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Recent cash-ups
          </div>
          <div className="flex items-center gap-3">
            {data.reconciliation.closed > 0 ? (
              <span className="text-muted-foreground text-xs">
                {data.reconciliation.exact} of {data.reconciliation.closed} balanced
                {data.reconciliation.short > 0 ? ` · ${data.reconciliation.short} short` : ""}
                {data.reconciliation.over > 0 ? ` · ${data.reconciliation.over} over` : ""}
              </span>
            ) : null}
            <Button variant="ghost" size="sm" render={<a href="/api/reports/cash" download />}>
              <Download aria-hidden />
              CSV
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">Opened</TableHead>
                <TableHead className="w-44">Closed</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="w-32 text-right">Expected</TableHead>
                <TableHead className="w-32 text-right">Counted</TableHead>
                <TableHead className="w-32 text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
                    No shift has been closed yet.
                  </TableCell>
                </TableRow>
              ) : null}

              {data.recent.map((row) => (
                <TableRow key={row.shiftId}>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(row.openedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {row.closedAt ? formatDateTime(row.closedAt) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.closedByName ?? row.openedByName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRs(row.expected)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRs(row.counted)}
                  </TableCell>
                  {/* Green only for exact. A drawer that is "nearly right" every
                      day is the pattern worth noticing, and colouring small
                      variances as success hides it. */}
                  <TableCell
                    className={
                      row.variance === 0
                        ? "text-right font-semibold tabular-nums text-emerald-600"
                        : row.variance < 0
                          ? "text-destructive text-right font-semibold tabular-nums"
                          : "text-right font-semibold tabular-nums text-amber-600"
                    }
                  >
                    {formatRs(row.variance)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div>
      <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </div>
  )
}
