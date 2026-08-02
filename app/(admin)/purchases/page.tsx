import type { Metadata } from "next"
import Link from "next/link"
import { Ban, Layers, PackageCheck, Plus, Truck, X } from "lucide-react"

import { TabLink } from "@/components/admin/tab-link"
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
import { getSupplierName, listPurchases } from "@/lib/purchases/queries"

export const metadata: Metadata = { title: "Purchases" }

const STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: "On order",
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
  return <Badge variant="outline">{STATUS_LABELS.draft}</Badge>
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function positiveInt(value: string | undefined): number | undefined {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()
  const params = await searchParams
  const statusParam = first(params.status)
  const status: PurchaseStatus | undefined =
    statusParam === "draft" ||
    statusParam === "received" ||
    statusParam === "cancelled"
      ? statusParam
      : undefined

  const supplierId = positiveInt(first(params.supplier))

  const [{ rows: purchases, truncated, counts }, supplierName] = await Promise.all([
    listPurchases({ status, supplierId }),
    supplierId === undefined ? Promise.resolve(null) : getSupplierName(supplierId),
  ])

  // Every tab keeps whichever supplier is being looked at. A tab that
  // hard-codes `?status=received` silently throws the other filter away, and
  // the shop is back to the whole list without having asked to be.
  const tab = (next: PurchaseStatus | null) => {
    const q = new URLSearchParams()
    if (next) q.set("status", next)
    if (supplierId !== undefined) q.set("supplier", String(supplierId))
    const query = q.toString()
    return query ? `/purchases?${query}` : "/purchases"
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">
            {supplierName ? `Purchases from ${supplierName}` : "Purchases"}
          </h1>
          <p className="text-muted-foreground text-sm">
            Stock only goes up when you mark a purchase as received.
            {truncated && status === undefined
              ? ` Showing the ${purchases.length} most recent — pick a status to see further back.`
              : truncated
                ? ` Showing the ${purchases.length} most recent.`
                : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {supplierId !== undefined ? (
            <Button variant="outline" render={<Link href="/purchases" />}>
              <X aria-hidden />
              All suppliers
            </Button>
          ) : null}
          <Button
            render={
              <Link
                href={
                  supplierId === undefined
                    ? "/purchases/new"
                    : `/purchases/new?supplier=${supplierId}`
                }
              />
            }
          >
            <Plus aria-hidden />
            New purchase
          </Button>
        </div>
      </header>

      {/* "On order" rather than "Draft". The status is `draft` in the
          database, but to a shopkeeper a purchase that has been raised is
          ordered, not a rough copy — and the dashboard already calls the
          same rows "awaiting delivery" and links straight into this tab. */}
      <div className="flex gap-1 border-b">
        <TabLink href={tab(null)} active={status === undefined} icon={Layers}>
          All
        </TabLink>
        <TabLink
          href={tab("draft")}
          active={status === "draft"}
          icon={Truck}
          count={counts.draft}
        >
          On order
        </TabLink>
        <TabLink
          href={tab("received")}
          active={status === "received"}
          icon={PackageCheck}
        >
          Received
        </TabLink>
        <TabLink
          href={tab("cancelled")}
          active={status === "cancelled"}
          icon={Ban}
        >
          Cancelled
        </TabLink>
      </div>

      {purchases.length === 0 && status !== undefined ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Truck className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">
            {status === "draft"
              ? "Nothing on order"
              : status === "received"
                ? "Nothing received yet"
                : "Nothing cancelled"}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {status === "draft"
              ? "Every purchase you have raised has already been booked in."
              : status === "received"
                ? "A purchase moves here once you mark the delivery as received."
                : "Purchases you cancel stay on record and appear here."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" render={<Link href={tab(null)} />}>
              Show every status
            </Button>
          </div>
        </div>
      ) : purchases.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Truck className="text-muted-foreground mx-auto size-8" aria-hidden />
          {/* "No purchases yet" would be a lie on a supplier who simply has
              none — the shop may have dozens from everyone else. */}
          <p className="mt-3 font-medium">
            {supplierName
              ? `Nothing ordered from ${supplierName} yet`
              : "No purchases yet"}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Raise one to record what you’ve ordered, then receive it when the
            delivery arrives.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              render={
                <Link
                  href={
                    supplierId === undefined
                      ? "/purchases/new"
                      : `/purchases/new?supplier=${supplierId}`
                  }
                />
              }
            >
              <Plus aria-hidden />
              New purchase
            </Button>
            <Button
              variant="outline"
              render={
                <Link href={supplierId === undefined ? "/suppliers" : "/purchases"} />
              }
            >
              {supplierId === undefined ? "Manage suppliers" : "All suppliers"}
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
