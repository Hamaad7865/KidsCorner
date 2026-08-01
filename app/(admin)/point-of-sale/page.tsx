import type { Metadata } from "next"
import Link from "next/link"
import { Download, Monitor, Store } from "lucide-react"

import { DeviceCard } from "@/components/pos/device-card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireAdminProfile } from "@/lib/auth/session"
import { formatDateTime, formatRs } from "@/lib/format"
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
            {data.shopName} · {data.devices.filter((d) => d.drawer).length} of{" "}
            {data.devices.filter((d) => d.isActive).length} open
          </p>
        </div>
        <Button variant="outline" render={<Link href="/pos" />}>
          <Monitor aria-hidden />
          Open the till
        </Button>
      </header>

      <section className="space-y-3">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
          <Store className="size-4" aria-hidden />
          Tills · {data.devices.filter((d) => d.isActive).length} registered
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {data.devices
            .filter((d) => d.isActive)
            .map((device) => (
              <DeviceCard key={device.code} device={device} canClose={canClose} />
            ))}
        </div>

        {data.devices.some((d) => !d.isActive) ? (
          <details className="text-muted-foreground text-sm">
            <summary className="cursor-pointer">
              {data.devices.filter((d) => !d.isActive).length} retired till
              {data.devices.filter((d) => !d.isActive).length === 1 ? "" : "s"}
            </summary>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {data.devices
                .filter((d) => !d.isActive)
                .map((device) => (
                  <DeviceCard key={device.code} device={device} canClose={false} />
                ))}
            </div>
          </details>
        ) : null}
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
                <TableHead className="w-36">Till</TableHead>
                <TableHead className="w-40">Opened</TableHead>
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
                  <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                    No shift has been closed yet.
                  </TableCell>
                </TableRow>
              ) : null}

              {data.recent.map((row) => (
                <TableRow key={row.shiftId}>
                  <TableCell className="text-sm">
                    {row.deviceName ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
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
                      row.variance === null
                        ? "text-muted-foreground text-right"
                        : row.variance === 0
                          ? "text-right font-semibold tabular-nums text-emerald-600"
                          : row.variance < 0
                            ? "text-destructive text-right font-semibold tabular-nums"
                            : "text-right font-semibold tabular-nums text-amber-600"
                    }
                  >
                    {/* Never counted reads as "—", not as a balanced drawer. */}
                    {row.variance === null ? "Not counted" : formatRs(row.variance)}
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
