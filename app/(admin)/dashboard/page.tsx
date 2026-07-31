import type { Metadata } from "next"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowUpRight,
  Package,
  Truck,
  TrendingUp,
} from "lucide-react"

import { SalesChart } from "@/components/admin/sales-chart"
import { ColourSwatch } from "@/components/settings/colour-swatch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireAdminProfile } from "@/lib/auth/session"
import { MOVEMENT_TYPE_LABELS, isMovementType } from "@/lib/db-enums"
import {
  formatDate,
  formatDateTime,
  formatLongDate,
  formatQty,
  formatRs,
  greeting,
  shopToday,
} from "@/lib/format"
import { getShopIdentity } from "@/lib/pos/queries"
import { getDashboardStats } from "@/lib/sales/queries"
import { listMovements } from "@/lib/stock/queries"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage() {
  const profile = await requireAdminProfile()
  const [stats, movements, identity] = await Promise.all([
    getDashboardStats(),
    listMovements({}),
    getShopIdentity(),
  ])

  const recent = movements.rows.slice(0, 6)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">
            {greeting()}, {profile.fullName.split(" ")[0]}
          </h1>
          <p className="text-muted-foreground text-sm">
            {/* The design's own subtitle: which day it is and where the shop
                is. Both read from the shop's own clock and settings, so a
                tablet left on the wrong timezone cannot change the answer. */}
            {formatLongDate(shopToday())}
            {identity.address ? ` · ${identity.address}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<Link href="/stock" />}>
            New adjustment
          </Button>
          <Button render={<Link href="/import" />}>Import from Excel</Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={TrendingUp}
          label="Today's sales"
          value={formatRs(stats.todayTotal)}
          delta={stats.todayVsLastWeek}
          hint={
            stats.todayVsLastWeek
              ? `vs last ${stats.todayVsLastWeek.weekdayName}`
              : `${stats.todayCount} sale${stats.todayCount === 1 ? "" : "s"}`
          }
        />
        <Stat
          icon={Package}
          label="Items sold"
          value={String(stats.todayItems)}
          unit="units"
          hint={`Across ${stats.todayCount} transaction${stats.todayCount === 1 ? "" : "s"}`}
        />
        <Stat
          icon={AlertTriangle}
          label="Low stock"
          value={String(stats.lowStockCount)}
          unit="variants"
          hint={stats.lowStockCount > 0 ? "Review reorder list →" : "All healthy"}
          href={stats.lowStockCount > 0 ? "/stock?tab=low" : undefined}
        />
        <Stat
          icon={Truck}
          label="Awaiting delivery"
          value={String(stats.awaiting.count)}
          unit="purchases"
          hint={
            stats.awaiting.nextSupplier && stats.awaiting.nextDate
              ? `Next: ${stats.awaiting.nextSupplier}, ${formatDate(stats.awaiting.nextDate)}`
              : "Nothing on order"
          }
          href={stats.awaiting.count > 0 ? "/purchases" : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardContent className="pt-5">
            <SalesChart
              daily={stats.daily}
              weekly={stats.weekly}
              weekTotal={stats.weekTotal}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Top sellers this week</CardTitle>
            <p className="text-muted-foreground text-xs">By units sold</p>
          </CardHeader>
          <CardContent>
            {stats.topSellers.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing sold in the last seven days yet.
              </p>
            ) : (
              <ul className="divide-y">
                {stats.topSellers.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.name}</div>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                        {item.colourName ? (
                          <ColourSwatch
                            hex={item.colourHex}
                            name={item.colourName}
                            className="size-3"
                          />
                        ) : null}
                        <span className="truncate">
                          {[item.colourName, item.sizeLabel]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium tabular-nums">{item.qty}</div>
                      <div className="text-muted-foreground text-xs tabular-nums">
                        {formatRs(item.revenue)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Recent stock movements</CardTitle>
          <Button variant="ghost" size="sm" render={<Link href="/stock" />}>
            View all
            <ArrowUpRight aria-hidden />
          </Button>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {recent.length === 0 ? (
            <p className="text-muted-foreground px-6 pb-6 text-sm">
              Nothing has moved yet. Stock appears here as it is imported,
              received, sold or adjusted.
            </p>
          ) : (
            <div className="overflow-x-auto border-t">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44 pl-6">When</TableHead>
                    <TableHead>Product / variant</TableHead>
                    <TableHead className="w-32">Type</TableHead>
                    <TableHead className="w-24 text-right">Change</TableHead>
                    <TableHead className="w-36 pr-6">By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((move) => (
                    <TableRow key={move.id}>
                      <TableCell className="text-muted-foreground pl-6 text-xs">
                        {formatDateTime(move.createdAt)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <ColourSwatch
                            hex={move.colourHex}
                            name={move.colourName ?? undefined}
                            className="size-3"
                          />
                          <span className="font-medium">
                            {move.productName ?? "Deleted variant"}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {[move.colourName, move.sizeLabel]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-muted-foreground">
                          {isMovementType(move.movementType)
                            ? MOVEMENT_TYPE_LABELS[move.movementType]
                            : move.movementType}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={
                          move.qty < 0
                            ? "text-destructive text-right font-medium tabular-nums"
                            : "text-success text-right font-medium tabular-nums"
                        }
                      >
                        {move.qty > 0 ? "+" : ""}
                        {formatQty(move.qty)}
                      </TableCell>
                      <TableCell className="text-muted-foreground pr-6 text-xs">
                        {move.createdBy ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}


function Stat({
  icon: Icon,
  label,
  value,
  unit,
  delta,
  hint,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  /** "units", "variants" — the design sets these beside the figure, not under. */
  unit?: string
  /** Week-on-week movement, shown as a tinted chip beside the figure. */
  delta?: { percent: number } | null
  hint?: string
  href?: string
}) {
  const body = (
    <CardContent className="py-4">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Icon className="size-4" aria-hidden />
        {label}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {unit ? (
          <span className="text-muted-foreground text-xs">{unit}</span>
        ) : null}
        {delta ? (
          /* Green for up and red for down would be the reflex, and it is wrong
             here: takings down on one weekday is information, not an error.
             The chip states the direction and leaves the judgement alone. */
          <span
            className={
              delta.percent >= 0
                ? "rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700"
                : "rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
            }
          >
            {delta.percent >= 0 ? "+" : ""}
            {delta.percent}%
          </span>
        ) : null}
      </div>
      {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
    </CardContent>
  )

  if (href) {
    return (
      <Card className="hover:border-brand-300 transition-colors">
        <Link href={href}>{body}</Link>
      </Card>
    )
  }
  return <Card>{body}</Card>
}
