import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, HandCoins } from "lucide-react"

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
import { PAYMENT_METHOD_LABELS } from "@/lib/db-enums"
import { formatDate, formatDateTime, formatRs } from "@/lib/format"
import { getDepositDetail } from "@/lib/deposits/queries"

export const metadata: Metadata = { title: "Deposit" }

export default async function DepositDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminProfile()

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const deposit = await getDepositDetail(id)
  if (!deposit) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" render={<Link href="/deposits" />}>
          <ArrowLeft className="size-4" aria-hidden />
          Deposits
        </Button>
      </div>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading font-mono text-xl font-semibold">
            {deposit.orderNo}
          </h1>
          <p className="text-muted-foreground text-sm">
            Opened {formatDateTime(deposit.createdAt)} ·{" "}
            <Link
              href={`/customers/${deposit.customerId}`}
              className="hover:text-brand-700 hover:underline"
            >
              {deposit.customerName}
            </Link>
            {deposit.customerPhone ? (
              <span className="ml-1 tabular-nums">{deposit.customerPhone}</span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {deposit.status === "open" ? (
            <Badge variant="outline">Open</Badge>
          ) : deposit.status === "collected" ? (
            <Badge variant="secondary">Collected</Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              Cancelled
            </Badge>
          )}
          {deposit.overdue ? (
            <Badge variant="outline" className="text-destructive">
              Overdue
            </Badge>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Order total" value={formatRs(deposit.total)} mono />
        <Stat label="Paid so far" value={formatRs(deposit.paymentsNet)} mono />
        <Stat
          label={deposit.status === "cancelled" ? "Refunded on cancel" : "Balance"}
          value={
            deposit.status === "cancelled"
              ? formatRs(Math.max(0, -deposit.unallocatedCredit) || deposit.paymentsNet)
              : formatRs(deposit.balance)
          }
          mono
        />
        <Stat
          label="Collect by"
          value={deposit.collectBy ? formatDate(deposit.collectBy) : "—"}
          sub={
            deposit.overdue
              ? "Past the promised date"
              : deposit.collectedAt
                ? `Collected ${formatDate(deposit.collectedAt.slice(0, 10))}`
                : "No promise date set"
          }
          muted={!deposit.collectBy && !deposit.collectedAt}
        />
      </div>

      {deposit.note ? (
        <p className="text-muted-foreground rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          {deposit.note}
        </p>
      ) : null}
      {deposit.cancelledReason ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-sm">
          Cancelled: {deposit.cancelledReason}
        </p>
      ) : null}

      {/* What is held. Frozen prices, shown with how much has gone home. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Held items</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-28 text-right">Unit price</TableHead>
                <TableHead className="w-20 text-right">Qty</TableHead>
                <TableHead className="w-24 text-right">Collected</TableHead>
                <TableHead className="w-24 text-right">Discount</TableHead>
                <TableHead className="w-28 text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposit.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-sm">{item.description}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRs(item.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.qty}</TableCell>
                  <TableCell
                    className={[
                      "text-right tabular-nums",
                      item.collectedQty === item.qty ? "text-muted-foreground" : "",
                    ].join(" ")}
                  >
                    {item.collectedQty === item.qty
                      ? `all ${item.qty}`
                      : `${item.qty - item.collectedQty} held`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.discount > 0 ? `−${formatRs(item.discount)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatRs(item.lineTotal)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* The money ledger — append-only, refunds included. */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase">Payments</h2>
          {deposit.payments.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <HandCoins className="text-muted-foreground mx-auto size-6" aria-hidden />
              <p className="text-muted-foreground mt-2 text-sm">
                Nothing taken yet — this is a pure reservation.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">When</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead className="w-24">Method</TableHead>
                    <TableHead className="w-28 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...deposit.payments].reverse().map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatDateTime(entry.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {entry.entryType === "refund" ? "Refund" : "Payment"}
                        {entry.reason ? (
                          <span className="text-muted-foreground"> — {entry.reason}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {PAYMENT_METHOD_LABELS[
                            entry.method as keyof typeof PAYMENT_METHOD_LABELS
                          ] ?? entry.method}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={[
                          "text-right tabular-nums",
                          entry.amount < 0 ? "text-brand-700" : "",
                        ].join(" ")}
                      >
                        {entry.amount < 0
                          ? `+${formatRs(-entry.amount)}`
                          : formatRs(entry.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Balance is what is left of the order; a cancellation refunds exactly
            the paid-but-unclaimed amount.
          </p>
        </section>

        {/* Pickup visits, each an ordinary sale reachable from Sales. */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            Pickup visits
          </h2>
          {deposit.pickups.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-muted-foreground text-sm">
                Nothing collected yet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">When</TableHead>
                    <TableHead>Sale</TableHead>
                    <TableHead className="w-28 text-right">Total</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deposit.pickups.map((sale) => (
                    <TableRow key={sale.saleId}>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatDateTime(sale.saleDate)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link
                          href={`/sales/${sale.saleId}`}
                          className="hover:text-brand-700 hover:underline"
                        >
                          {sale.saleNo}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRs(sale.total)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-muted-foreground capitalize">
                          {sale.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Each visit writes an ordinary sale at the frozen prices, so receipts,
            returns and reports treat it like any other ticket.
          </p>
        </section>
      </div>
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
  sub?: string
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
        {sub ? <div className="text-muted-foreground mt-1 text-xs">{sub}</div> : null}
      </CardContent>
    </Card>
  )
}
