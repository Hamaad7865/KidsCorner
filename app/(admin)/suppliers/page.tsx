import type { Metadata } from "next"
import Link from "next/link"
import { Factory } from "lucide-react"

import { SupplierDialog } from "@/components/purchases/supplier-dialog"
import { ActiveBadge } from "@/components/settings/master-data-panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { requireAdminProfile } from "@/lib/auth/session"
import { formatDate, formatRs, initialsOf } from "@/lib/format"
import { listSupplierRows } from "@/lib/purchases/queries"

export const metadata: Metadata = { title: "Suppliers" }

export default async function SuppliersPage() {
  await requireAdminProfile()
  const suppliers = await listSupplierRows()

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">Suppliers</h1>
          <p className="text-muted-foreground text-sm">
            Who you buy from, on what terms.
          </p>
        </div>
        <SupplierDialog supplier={null} />
      </header>

      {suppliers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Factory className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">No suppliers yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Add one before raising a purchase — the link between them is
            required.
          </p>
          <div className="mt-4 flex justify-center">
            <SupplierDialog supplier={null} />
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead className="w-56">Contact</TableHead>
                <TableHead>Brands supplied</TableHead>
                <TableHead className="w-32">Terms</TableHead>
                <TableHead className="w-28">Last order</TableHead>
                <TableHead className="w-32 text-right">Spend this year</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="bg-brand-100 text-brand-800 flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                        {initialsOf(supplier.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{supplier.name}</div>
                        <div className="text-muted-foreground truncate text-xs">
                          {supplier.town ?? supplier.address ?? "—"}
                        </div>
                      </div>
                      {!supplier.is_active ? (
                        <ActiveBadge isActive={supplier.is_active} />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="truncate text-sm">
                      {supplier.contact_name ?? "—"}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {supplier.phone ?? supplier.email ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {/* From what they have actually delivered, not a list
                        somebody typed — so it cannot claim a brand this
                        supplier has never sent. */}
                    {supplier.brands.length > 0 ? supplier.brands.join(", ") : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {supplier.payment_terms ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {supplier.lastOrder ? formatDate(supplier.lastOrder) : "Never"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {supplier.spendThisYear > 0
                      ? formatRs(supplier.spendThisYear)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        render={<Link href={`/purchases/new?supplier=${supplier.id}`} />}
                      >
                        New purchase
                      </Button>
                      <SupplierDialog supplier={supplier} iconOnly />
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
