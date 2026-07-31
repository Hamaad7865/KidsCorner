import type { Metadata } from "next"
import Link from "next/link"
import { Receipt } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
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
import { PAYMENT_METHOD_LABELS, isPaymentMethod } from "@/lib/db-enums"
import { formatDateTime, formatRs } from "@/lib/format"
import { getSalesWeekStats, listSales } from "@/lib/sales/queries"

export const metadata: Metadata = { title: "Sales" }

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function isoDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireAdminProfile()

  // The design gates cost and margin to "Owner and Manager only". Role, not a
  // module flag: `module_access` controls which screens exist, not which
  // columns inside one a person may read.
  const canSeeCost = profile.role === "owner" || profile.role === "manager"

  const params = await searchParams
  const from = isoDate(first(params.from))
  const to = isoDate(first(params.to))
  const search = first(params.q)?.trim() || undefined
  const [{ rows: sales, truncated }, week] = await Promise.all([
    listSales({ from, to, search }),
    getSalesWeekStats(canSeeCost),
  ])

  const total = sales
    .filter((s) => s.status === "completed")
    .reduce((sum, s) => sum + s.total, 0)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Sales</h1>
        <p className="text-muted-foreground text-sm">
          Receipts come in from the till. Each one takes stock out
          automatically.
        </p>
      </header>

      {/* `This week` — four figures above the list, per the design. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <WeekStat
          label="Takings this week"
          value={formatRs(week.takings)}
          sub={`${week.receipts} receipt${week.receipts === 1 ? "" : "s"}`}
          mono
        />
        <WeekStat
          label="Average basket"
          value={formatRs(week.averageBasket)}
          /* Every ticket here is paid at the till, so this denominator is
             every sale — no account invoices sitting in it unpaid. */
          sub={`${week.itemsPerSale.toFixed(1)} items per sale`}
          mono
        />
        <WeekStat
          label="Busiest day"
          value={week.busiestDay?.weekday ?? "—"}
          sub={
            week.busiestDay
              ? `${formatRs(week.busiestDay.total)} · ${week.busiestDay.receipts} receipts`
              : "Nothing rung up yet"
          }
        />
        <WeekStat
          label="Gross margin"
          value={week.margin ? `${week.margin.percent}%` : "Hidden"}
          sub={
            week.margin
              ? `${formatRs(week.margin.amount)} on this week's sales`
              : "Owner and Manager only"
          }
          mono={Boolean(week.margin)}
          muted={!week.margin}
        />
      </div>

      <p className="text-muted-foreground text-sm">
        {sales.length} sale{sales.length === 1 ? "" : "s"} shown ·{" "}
        {formatRs(total)} from completed ones.
        {truncated ? " Narrow the dates to see older sales." : ""}
      </p>

      {/* Plain GET form — shareable URL, no client JS needed. */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <label htmlFor="q" className="text-sm font-medium">
            Receipt number
          </label>
          {/* A customer comes to the counter holding the receipt, so the number
              is what gets typed. Kept alongside the dates rather than replacing
              them: the other way people find a sale is "sometime last week". */}
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search ?? ""}
            placeholder="S260728-14"
            className="border-input block h-9 w-48 rounded-lg border bg-transparent px-3 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="from" className="text-sm font-medium">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from ?? ""}
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
            defaultValue={to ?? ""}
            className="border-input block h-9 rounded-lg border bg-transparent px-3 text-sm"
          />
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {from || to || search ? (
          <Button variant="ghost" render={<Link href="/sales" />}>
            Clear
          </Button>
        ) : null}
      </form>

      {sales.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Receipt className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">
            {search ? `Nothing matches “${search}”` : "No sales in this range"}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {search
              ? "Check the number on the receipt, or clear the filters and browse by date."
              : "Sales appear here as soon as the till completes one."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">When</TableHead>
                <TableHead className="w-40">Sale</TableHead>
                <TableHead className="w-16 text-right">Items</TableHead>
                <TableHead className="w-32 text-right">Total</TableHead>
                <TableHead className="w-40">Paid by</TableHead>
                <TableHead className="w-36">Cashier</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDateTime(sale.saleDate)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/sales/${sale.id}`}
                      className="hover:text-brand-700 hover:underline"
                    >
                      {sale.saleNo}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {sale.itemCount}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatRs(sale.total)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {sale.methods
                      .map((m) => (isPaymentMethod(m) ? PAYMENT_METHOD_LABELS[m] : m))
                      .join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {sale.cashierName ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground truncate text-xs">
                    {sale.customerName ?? "Walk-in"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {sale.status === "refunded" ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Refunded
                        </Badge>
                      ) : sale.status === "void" ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Void
                        </Badge>
                      ) : null}
                      {/* A refunded sale can still be opened: partial returns
                          leave it completed, and the screen shows what has
                          already been credited either way. */}
                      {sale.status !== "void" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          render={<Link href={`/sales/${sale.id}/return`} />}
                        >
                          Return
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        render={
                          <a
                            href={`/pos/receipt/${sale.id}`}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        Receipt
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/**
 * One figure in the strip above the list.
 *
 * `mono` puts the value in IBM Plex Mono, which the design reserves for money
 * and counts — a weekday name is prose and stays in the UI face. `muted`
 * carries the cost-hidden state: smaller and dimmer, so "Hidden" reads as an
 * absence rather than as a value.
 */
function WeekStat({
  label,
  value,
  sub,
  mono = false,
  muted = false,
}: {
  label: string
  value: string
  sub: string
  mono?: boolean
  muted?: boolean
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {label}
        </div>
        <div
          className={[
            "mt-1.5 font-semibold",
            mono ? "font-mono tabular-nums" : "",
            muted ? "text-muted-foreground text-[15px]" : "text-xl",
          ].join(" ")}
        >
          {value}
        </div>
        <div className="text-muted-foreground mt-1 text-xs">{sub}</div>
      </CardContent>
    </Card>
  )
}
