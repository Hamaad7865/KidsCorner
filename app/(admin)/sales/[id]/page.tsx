import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Printer, RotateCcw, ShieldCheck } from "lucide-react"

import { ColourSwatch } from "@/components/settings/colour-swatch"
import { Badge } from "@/components/ui/badge"
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
import { getSaleDetail } from "@/lib/sales/queries"

export const metadata: Metadata = { title: "Sale" }

/**
 * One sale, in full.
 *
 * The receipt route already existed, but it is laid out for 80mm thermal paper
 * — the wrong shape for answering "what exactly did this person buy, what did
 * they pay with, and what has come back since". This is that view: the record
 * as it stands, with the receipt one click away for reprinting.
 */
export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminProfile()

  const { id } = await params
  const saleId = Number(id)
  if (!Number.isInteger(saleId) || saleId <= 0) notFound()

  const sale = await getSaleDetail(saleId)
  if (!sale) notFound()

  const refunded = sale.creditNotes.reduce((sum, c) => sum + c.total, 0)
  const paid = sale.payments.reduce((sum, p) => sum + p.amount, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/sales" />}>
          <ArrowLeft aria-hidden />
          All sales
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold">{sale.saleNo}</h1>
            {sale.status === "refunded" ? (
              <Badge variant="outline" className="text-muted-foreground">
                Refunded
              </Badge>
            ) : sale.status === "void" ? (
              <Badge variant="outline" className="text-muted-foreground">
                Void
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-sm">
            {formatDateTime(sale.saleDate)}
            {sale.cashierName ? ` · rung up by ${sale.cashierName}` : ""}
            {" · "}
            {sale.customerId && sale.customerName ? (
              <Link
                href={`/customers/${sale.customerId}`}
                className="hover:text-brand-700 underline-offset-2 hover:underline"
              >
                {sale.customerName}
              </Link>
            ) : (
              "Walk-in"
            )}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {sale.status !== "void" ? (
            <Button
              variant="outline"
              render={<Link href={`/sales/${sale.id}/return`} />}
            >
              <RotateCcw aria-hidden />
              Return
            </Button>
          ) : null}
          {/* New tab: the receipt is a print-shaped page, and a cashier
              reprinting one should not lose their place in the history. */}
          <Button
            render={
              <a href={`/pos/receipt/${sale.id}`} target="_blank" rel="noreferrer" />
            }
          >
            <Printer aria-hidden />
            Reprint receipt
          </Button>
        </div>
      </header>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="w-40">Code</TableHead>
              <TableHead className="w-16 text-right">Qty</TableHead>
              <TableHead className="w-28 text-right">Unit</TableHead>
              <TableHead className="w-28 text-right">Off</TableHead>
              <TableHead className="w-28 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sale.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ColourSwatch hex={line.colourHex} name={line.colourName} />
                    <span className="font-medium">{line.productName}</span>
                    <span className="text-muted-foreground text-xs">
                      {line.colourName} · {line.sizeLabel}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {line.barcode ?? line.sku}
                </TableCell>
                <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRs(line.unitPrice)}
                </TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {line.discount > 0 ? `− ${formatRs(line.discount)}` : "—"}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatRs(line.lineTotal)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <h2 className="font-heading text-base font-medium">Payment</h2>
          <dl className="space-y-2 text-sm">
            {sale.payments.map((payment) => (
              <div key={payment.id} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {isPaymentMethod(payment.method)
                    ? PAYMENT_METHOD_LABELS[payment.method]
                    : payment.method}
                  {payment.tendered !== null ? (
                    <span className="text-muted-foreground/70">
                      {" "}
                      · {formatRs(payment.tendered)} given
                    </span>
                  ) : null}
                </dt>
                <dd className="tabular-nums">{formatRs(payment.amount)}</dd>
              </div>
            ))}
            {/* Only worth saying when it is not simply the total — a split that
                does not add up is the kind of thing you want to notice here. */}
            {Math.abs(paid - sale.total) > 0.009 ? (
              <div className="text-warning-foreground flex justify-between gap-4">
                <dt>Payments recorded</dt>
                <dd className="tabular-nums">{formatRs(paid)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="space-y-3">
          <h2 className="font-heading text-base font-medium">Totals</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatRs(sale.subtotal)}</dd>
            </div>

            {sale.discounts.map((discount, index) => (
              <div key={index} className="flex justify-between gap-4">
                <dt className="text-muted-foreground flex items-center gap-1.5">
                  {discount.label}
                  {discount.kind === "percent" ? ` (${discount.value}%)` : ""}
                  {discount.approvedByName ? (
                    <span
                      className="text-brand-700 inline-flex items-center gap-1 text-xs"
                      title={`Approved by ${discount.approvedByName}`}
                    >
                      <ShieldCheck className="size-3.5" aria-hidden />
                      {discount.approvedByName}
                    </span>
                  ) : null}
                </dt>
                <dd className="tabular-nums">− {formatRs(discount.amount)}</dd>
              </div>
            ))}

            {/* Shown when the sale carries a discount with no rule rows behind
                it — an older sale from before discounts were itemised. */}
            {sale.discounts.length === 0 && sale.discount > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular-nums">− {formatRs(sale.discount)}</dd>
              </div>
            ) : null}

            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">VAT (included)</dt>
              <dd className="tabular-nums">{formatRs(sale.vatAmount)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t pt-2 text-base font-medium">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatRs(sale.total)}</dd>
            </div>
            {refunded > 0 ? (
              <div className="text-destructive flex justify-between gap-4">
                <dt>Credited back</dt>
                <dd className="tabular-nums">− {formatRs(refunded)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      {sale.prints.length > 0 ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-base font-medium">Receipt prints</h2>
            {/* The number is the point. One receipt printed repeatedly over
                several days is the shape of a refund being justified twice. */}
            <p className="text-muted-foreground text-sm">
              Printed {sale.prints.length} time
              {sale.prints.length === 1 ? "" : "s"}
              {sale.prints.length > 1 ? ` · ${sale.prints.length - 1} reprint${sale.prints.length > 2 ? "s" : ""}` : ""}
            </p>
          </div>
          <ul className="divide-y rounded-lg border text-sm">
            {sale.prints.map((print, index) => (
              <li key={print.id} className="flex justify-between gap-4 px-4 py-2">
                <span className="text-muted-foreground">
                  {formatDateTime(print.printedAt)}
                  {print.by ? ` · ${print.by}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {index === sale.prints.length - 1 ? "Original" : "Reprint"}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            The account shown is the one signed in on that till, not necessarily
            the cashier — match the time against the shift to see who was on.
          </p>
        </div>
      ) : null}

      {sale.creditNotes.length > 0 ? (
        <div className="space-y-3">
          <h2 className="font-heading text-base font-medium">Returns</h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Credit note</TableHead>
                  <TableHead className="w-44">When</TableHead>
                  <TableHead className="w-32">Refunded by</TableHead>
                  <TableHead className="w-28 text-right">Amount</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sale.creditNotes.map((note) => (
                  <TableRow key={note.id}>
                    <TableCell className="font-mono text-xs">{note.creditNo}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(note.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs capitalize">
                      {note.refundMethod.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRs(note.total)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {note.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
