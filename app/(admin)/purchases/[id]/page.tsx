import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { PurchaseActions } from "@/components/purchases/purchase-actions"
import { PurchaseEditor } from "@/components/purchases/purchase-editor"
import { ColourSwatch } from "@/components/settings/colour-swatch"
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
import { formatDate, formatRs } from "@/lib/format"
import { getPurchase, listSuppliers } from "@/lib/purchases/queries"

export const metadata: Metadata = { title: "Purchase" }

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminProfile()

  const { id } = await params
  const purchaseId = Number(id)
  // A non-numeric segment would otherwise reach Postgres as a 22P02 rather
  // than a clean 404.
  if (!Number.isInteger(purchaseId) || purchaseId <= 0) notFound()

  const [purchase, suppliers] = await Promise.all([
    getPurchase(purchaseId),
    listSuppliers(),
  ])
  if (!purchase) notFound()

  const totalUnits = purchase.lines.reduce((sum, line) => sum + line.qty, 0)
  const isDraft = purchase.status === "draft"

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" render={<Link href="/purchases" />}>
          <ArrowLeft aria-hidden />
          Purchases
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="font-heading text-xl font-semibold">
                {purchase.supplierName ?? "Unknown supplier"}
              </h1>
              {purchase.status === "received" ? (
                <Badge variant="secondary">Received</Badge>
              ) : purchase.status === "cancelled" ? (
                <Badge variant="outline" className="text-muted-foreground">
                  Cancelled
                </Badge>
              ) : (
                <Badge variant="outline">Draft</Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {formatDate(purchase.purchaseDate)}
              {purchase.invoiceNo ? ` · Invoice ${purchase.invoiceNo}` : ""}
              {` · ${purchase.lines.length} line${purchase.lines.length === 1 ? "" : "s"}`}
              {` · ${formatRs(purchase.totalAmount)}`}
            </p>
          </div>

          {isDraft ? (
            <PurchaseActions
              purchaseId={purchase.id}
              lineCount={purchase.lines.length}
              totalUnits={totalUnits}
            />
          ) : null}
        </div>
      </div>

      {isDraft ? (
        <Card>
          <CardContent>
            <PurchaseEditor purchase={purchase} suppliers={suppliers} />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variant</TableHead>
                  <TableHead className="w-36">SKU</TableHead>
                  <TableHead className="w-20 text-right">Qty</TableHead>
                  <TableHead className="w-32 text-right">Unit cost</TableHead>
                  <TableHead className="w-32 text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchase.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ColourSwatch hex={line.colourHex} name={line.colourName} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {line.productName}
                          </div>
                          <div className="text-muted-foreground truncate text-xs">
                            {line.sizeLabel} · {line.colourName}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {line.sku}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.qty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRs(line.unitCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRs(line.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-muted-foreground text-xs">
            {purchase.status === "received"
              ? "Received. Each line was stocked in as a movement of type “purchase”, and every variant's cost price was set to the unit cost above."
              : "Cancelled. No stock was affected."}
          </p>
        </>
      )}

      {purchase.notes ? (
        <div className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Notes</h2>
          <p className="text-muted-foreground mt-1 text-sm">{purchase.notes}</p>
        </div>
      ) : null}
    </div>
  )
}
