import type { Metadata } from "next"
import Link from "next/link"
import { Plus, Truck } from "lucide-react"

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
import type { PurchaseStatus } from "@/lib/db-enums"
import { formatDate, formatQty, formatRs } from "@/lib/format"
import { listPurchases } from "@/lib/purchases/queries"

export const metadata: Metadata = { title: "Purchases" }

const STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: "Draft",
  received: "Received",
  cancelled: "Cancelled",
}

function StatusBadge({ status }: { status: PurchaseStatus }) {
  if (status === "received") return <Badge variant="secondary">Received</Badge>
  if (status === "cancelled") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Cancelled
      </Badge>
    )
  }
  return <Badge variant="outline">Draft</Badge>
}

export default async function PurchasesPage() {
  await requireAdminProfile()
  const { rows: purchases, truncated } = await listPurchases()

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">Purchases</h1>
          <p className="text-muted-foreground text-sm">
            Stock only goes up when you mark a purchase as received.
            {truncated
              ? ` Showing the ${purchases.length} most recent — there are older ones.`
              : ""}
          </p>
        </div>
        <Button render={<Link href="/purchases/new" />}>
          <Plus aria-hidden />
          New purchase
        </Button>
      </header>

      {purchases.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Truck className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">No purchases yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Raise one to record what you’ve ordered, then receive it when the
            delivery arrives.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button render={<Link href="/purchases/new" />}>
              <Plus aria-hidden />
              New purchase
            </Button>
            <Button variant="outline" render={<Link href="/suppliers" />}>
              Manage suppliers
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Reference</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="w-28">Ordered</TableHead>
                <TableHead className="w-28">Expected</TableHead>
                <TableHead className="w-16 text-right">Lines</TableHead>
                <TableHead className="w-16 text-right">Units</TableHead>
                <TableHead className="w-32 text-right">Total cost</TableHead>
                <TableHead className="w-28">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map((purchase) => (
                <TableRow key={purchase.id}>
                  <TableCell>
                    {/* The supplier's own invoice number where there is one,
                        because that is what a query from them will quote. Our
                        id is the fallback, not the headline. */}
                    <Link
                      href={`/purchases/${purchase.id}`}
                      className="hover:text-brand-700 font-mono text-xs font-medium hover:underline"
                    >
                      {purchase.invoiceNo ?? `PO-${purchase.id}`}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {purchase.supplierName ?? "Unknown supplier"}
                    </div>
                    {purchase.supplierMeta ? (
                      <div className="text-muted-foreground text-xs">
                        {purchase.supplierMeta}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDate(purchase.purchaseDate)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {/* Empty, not the order date. A guessed delivery date is
                        one somebody plans around. */}
                    {purchase.expectedDate ? formatDate(purchase.expectedDate) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {purchase.lineCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQty(purchase.unitCount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRs(purchase.totalAmount)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={purchase.status} />
                    <span className="sr-only">
                      {STATUS_LABELS[purchase.status]}
                    </span>
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
