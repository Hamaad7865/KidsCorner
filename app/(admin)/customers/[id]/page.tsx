import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Receipt } from "lucide-react"

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
import { getCustomer } from "@/lib/customers/queries"
import { formatDate, formatDateTime, formatRs } from "@/lib/format"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const parsed = Number(id)
  if (!Number.isInteger(parsed) || parsed <= 0) return { title: "Customer" }

  // Deduped with the page's own call by React cache().
  const customer = await getCustomer(parsed)
  return { title: customer?.fullName ?? "Customer" }
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminProfile()

  const { id } = await params
  const customerId = Number(id)
  if (!Number.isInteger(customerId) || customerId <= 0) notFound()

  const customer = await getCustomer(customerId)
  if (!customer) notFound()

  const completed = customer.sales.filter((s) => s.status === "completed")
  const average =
    completed.length > 0 ? customer.totalSpent / completed.length : 0

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" render={<Link href="/customers" />}>
          <ArrowLeft aria-hidden />
          Customers
        </Button>

        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">
            {customer.fullName}
          </h1>
          <p className="text-muted-foreground text-sm">
            {[customer.phone, customer.email].filter(Boolean).join(" · ") ||
              "No contact details"}
            {` · Added ${formatDate(customer.createdAt)}`}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Visits", value: String(completed.length) },
          { label: "Total spent", value: formatRs(customer.totalSpent) },
          { label: "Average sale", value: formatRs(average) },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-4">
              <div className="text-2xl font-semibold tabular-nums">
                {stat.value}
              </div>
              <div className="text-muted-foreground text-sm">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {customer.notes ? (
        <div className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Notes</h2>
          <p className="text-muted-foreground mt-1 text-sm">{customer.notes}</p>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-heading text-base font-medium">Purchase history</h2>

        {customer.sales.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <Receipt className="text-muted-foreground mx-auto size-8" aria-hidden />
            <p className="mt-3 font-medium">No purchases yet</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
              Sales appear here once this customer is attached to one at the
              till.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">When</TableHead>
                  <TableHead className="w-40">Sale</TableHead>
                  <TableHead className="w-20 text-right">Items</TableHead>
                  <TableHead className="w-32 text-right">Total</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customer.sales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDateTime(sale.saleDate)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {sale.saleNo}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {sale.itemCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRs(sale.total)}
                    </TableCell>
                    <TableCell>
                      {sale.status === "completed" ? (
                        <Badge variant="secondary">Completed</Badge>
                      ) : sale.status === "refunded" ? (
                        <Badge variant="outline">Refunded</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Void
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <p className="text-muted-foreground border-t pt-4 text-xs">
        Customer records can be added but not edited or deleted: migration 001
        grants <code>customers</code> only SELECT and INSERT policies, so an edit
        form would be refused by row-level security. Changing that needs an
        UPDATE policy in a new migration.
      </p>
    </div>
  )
}
