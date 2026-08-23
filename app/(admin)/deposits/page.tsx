import type { Metadata } from "next"
import Link from "next/link"
import { HandCoins } from "lucide-react"

import { TabLink } from "@/components/admin/tab-link"
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
import { formatDate, formatDateTime, formatRs } from "@/lib/format"
import { getDepositsStats, listDeposits } from "@/lib/deposits/queries"

export const metadata: Metadata = { title: "Deposits" }

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  collected: "Collected",
  cancelled: "Cancelled",
}

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()

  const params = await searchParams
  const status = first(params.status) ?? "open"
  const search = first(params.q)?.trim() || undefined

  const [{ rows, truncated }, stats] = await Promise.all([
    listDeposits({ status, search }),
    getDepositsStats(),
  ])

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Deposits</h1>
        <p className="text-muted-foreground text-sm">
          Goods held for customers against money down. The till reserves the
          stock and takes the payments; a pickup visit writes an ordinary sale.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Open deposits"
          value={String(stats.openCount)}
          sub={`${formatRs(stats.openBalance)} still owed`}
          mono
        />
        <Stat
          label="Overdue to chase"
          value={String(stats.overdueCount)}
          sub={stats.overdueCount > 0 ? "Past their collect-by date" : "Nothing overdue"}
          muted={stats.overdueCount === 0}
        />
        <Stat
          label="Collected this month"
          value={formatRs(stats.collectedThisMonth)}
          sub="Total picked up this month"
          mono
        />
        <Stat label="Prices" value="Frozen" sub="At the day the deposit opened" />
      </div>

      {/* URL-addressable tabs, per Purchases/Stock — bookmarkable views. */}
      <nav className="border-b-border flex items-center gap-1 border-b">
        {([
          ["open", "Open", stats.openCount],
          ["collected", "Collected"],
          ["cancelled", "Cancelled"],
          ["all", "All"],
        ] as const).map(([value, label, count]) => (
          <TabLink
            key={value}
            href={`/deposits?status=${value}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            active={status === value}
            count={typeof count === "number" ? count : undefined}
          >
            {label}
          </TabLink>
        ))}
      </nav>

      {/* Plain GET form — shareable URL, no client JS needed. */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="status" value={status} />
        <div className="space-y-2">
          <label htmlFor="q" className="text-sm font-medium">
            Order, customer or phone
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={search ?? ""}
            placeholder="D260823-1 · 5757 1234"
            className="border-input block h-9 w-64 rounded-lg border bg-transparent px-3 text-sm"
          />
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {search ? (
          <Button variant="ghost" render={<Link href={`/deposits?status=${status}`} />}>
            Clear
          </Button>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <HandCoins className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">
            {search
              ? `Nothing matches “${search}”`
              : status === "open"
                ? "No open deposits"
                : `No ${STATUS_LABELS[status] ?? ""} deposits`.trim()}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Deposits are taken on the till: build the basket, attach a customer,
            then choose “Take deposit”.
          </p>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {rows.length} deposit{rows.length === 1 ? "" : "s"} shown.
            {truncated ? " Narrow the search to see older ones." : ""}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Opened</TableHead>
                  <TableHead className="w-32">Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="w-20 text-right">Units</TableHead>
                  <TableHead className="w-28 text-right">Total</TableHead>
                  <TableHead className="w-28 text-right">Balance</TableHead>
                  <TableHead className="w-36">Collect by</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/deposits/${row.id}`}
                        className="hover:text-brand-700 hover:underline"
                      >
                        {row.orderNo}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span>{row.customerName}</span>
                      <span className="text-muted-foreground ml-2 tabular-nums">
                        {row.customerPhone ?? ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.qtyCollected}/{row.qtyTotal}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatRs(row.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.balance > 0 ? formatRs(row.balance) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.collectBy ? (
                        <span className={row.overdue ? "text-destructive" : undefined}>
                          {formatDate(row.collectBy)}
                          {row.overdue ? " · overdue" : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.status === "open" ? (
                        <Badge variant="outline">Open</Badge>
                      ) : row.status === "collected" ? (
                        <Badge variant="secondary">Collected</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Cancelled
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({
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
