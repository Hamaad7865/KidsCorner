import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { ReturnForm } from "@/components/returns/return-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { requireProfile } from "@/lib/auth/session"
import { formatDateTime, formatRs } from "@/lib/format"
import { listCashiers } from "@/lib/pos/actions"
import { getOpenShift } from "@/lib/pos/queries"
import { getSaleForReturn } from "@/lib/returns/queries"

export const metadata: Metadata = { title: "Return" }

/**
 * Taking something back, at the till.
 *
 * The back office has had this screen since returns were built; the web till
 * had not, so a cashier standing in front of somebody holding a jumper and a
 * receipt had to go and find the owner. The tablet till has its own refund
 * screen and always has — this is the web till catching up with it.
 *
 * `requireProfile`, not `requireAdminProfile`: this is a till screen and
 * every role belongs on it. Whether a cashier may finish the job is not
 * decided here — `create_credit_note` reads `refund_requires_manager` and
 * refuses without an approver when the shop has asked for one, which is the
 * shop's setting doing its job rather than a second rule in the UI.
 */
export default async function TillReturnPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireProfile()

  const { id } = await params
  const saleId = Number(id)
  if (!Number.isInteger(saleId) || saleId <= 0) notFound()

  const [sale, shift, cashiers] = await Promise.all([
    getSaleForReturn(saleId),
    getOpenShift(),
    listCashiers(),
  ])
  if (!sale) notFound()

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" render={<Link href="/pos/sales" />}>
          <ArrowLeft aria-hidden />
          Past sales
        </Button>
        <h1 className="font-heading text-lg font-semibold">Return</h1>
      </div>

      <div className="bg-card rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-medium">{sale.saleNo}</span>
          {sale.status === "refunded" ? (
            <Badge variant="outline" className="text-muted-foreground">
              Refunded
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {formatDateTime(sale.saleDate)} · {formatRs(sale.total)}
          {sale.cashierName ? ` · sold by ${sale.cashierName}` : ""}
          {sale.customerName ? ` · ${sale.customerName}` : " · walk-in"}
        </p>
      </div>

      {sale.creditNotes.length > 0 ? (
        <div className="bg-card space-y-2 rounded-lg border p-4">
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

      <div className="bg-card rounded-lg border p-4">
        <ReturnForm
          sale={sale}
          shiftId={shift?.id ?? null}
          // Only the shop's own owners and managers, and only when it has
          // asked for approval — the form shows the keypad on the server's
          // say-so, not on a guess made here.
          managers={cashiers.filter(
            (c) => c.role === "owner" || c.role === "manager",
          )}
        />
      </div>
    </div>
  )
}
