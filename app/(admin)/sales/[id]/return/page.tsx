import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { ReturnForm } from "@/components/returns/return-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { requireAdminProfile } from "@/lib/auth/session"
import { formatDateTime, formatRs } from "@/lib/format"
import { getOpenShift } from "@/lib/pos/queries"
import { getSaleForReturn } from "@/lib/returns/queries"

export const metadata: Metadata = { title: "Return" }

export default async function ReturnPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminProfile()

  const { id } = await params
  const saleId = Number(id)
  if (!Number.isInteger(saleId) || saleId <= 0) notFound()

  const [sale, shift] = await Promise.all([
    getSaleForReturn(saleId),
    getOpenShift(),
  ])
  if (!sale) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" render={<Link href="/sales" />}>
          <ArrowLeft aria-hidden />
          Sales
        </Button>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-xl font-semibold">
              Return against {sale.saleNo}
            </h1>
            {sale.status === "refunded" ? (
              <Badge variant="outline">Refunded</Badge>
            ) : null}
            {/* The credit note follows the sale's frozen VAT, not today's
                setting — a VAT sale returns VAT even after the shop disables it. */}
            <Badge variant={sale.vatEnabled ? "default" : "secondary"}>
              {sale.vatEnabled ? "VAT invoice" : "Not VAT registered"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {formatDateTime(sale.saleDate)} · {formatRs(sale.total)}
            {sale.cashierName ? ` · sold by ${sale.cashierName}` : ""}
            {sale.customerName ? ` · ${sale.customerName}` : " · walk-in"}
          </p>
        </div>
      </div>

      {sale.creditNotes.length > 0 ? (
        <div className="space-y-2 rounded-lg border p-4">
          <h2 className="text-sm font-medium">
            Already credited ({sale.creditNotes.length})
          </h2>
          <ul className="space-y-1">
            {sale.creditNotes.map((note) => (
              <li
                key={note.id}
                className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs"
              >
                <span>
                  <span className="font-mono">{note.creditNo}</span> ·{" "}
                  {formatDateTime(note.createdAt)} · {note.reason}
                </span>
                <span className="tabular-nums">
                  {formatRs(note.total)} ({note.refundMethod})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Card>
        <CardContent>
          <ReturnForm sale={sale} shiftId={shift?.id ?? null} />
        </CardContent>
      </Card>

      <p className="text-muted-foreground border-t pt-4 text-xs">
        Raising a credit note puts the goods back on the shelf as a stock
        movement of type “return”, and a cash refund reduces the cash expected in
        the drawer at close. The original sale is never edited — it still reads
        as the customer&rsquo;s receipt does.
      </p>
    </div>
  )
}
