import type { Metadata } from "next"
import Link from "next/link"
import { Search, Users, X } from "lucide-react"

import { CustomerDialog } from "@/components/customers/customer-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireAdminProfile } from "@/lib/auth/session"
import { listCustomers } from "@/lib/customers/queries"
import { formatDate } from "@/lib/format"

export const metadata: Metadata = { title: "Customers" }

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()

  const params = await searchParams
  const search = first(params.q)?.trim() || undefined
  const { rows: customers, truncated } = await listCustomers(search)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">Customers</h1>
          <p className="text-muted-foreground text-sm">
            Optional — a sale doesn&rsquo;t need one. Attaching a customer is
            what builds the purchase history below.
            {truncated
              ? ` Showing the first ${customers.length}; narrow the search to see more.`
              : ""}
          </p>
        </div>
        <CustomerDialog />
      </header>

      {/* A plain GET form: no client JS needed, and the result is a real URL
          the user can bookmark or share. */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex-1 basis-64 space-y-2">
          <Label htmlFor="customer-search">Search</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="customer-search"
              name="q"
              defaultValue={search ?? ""}
              placeholder="Name or phone…"
              className="pl-8"
            />
          </div>
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {search ? (
          <Button variant="ghost" render={<Link href="/customers" />}>
            <X aria-hidden />
            Clear
          </Button>
        ) : null}
      </form>

      {customers.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Users className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">
            {search ? "Nobody matches that search" : "No customers yet"}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {search
              ? "Try just the first few digits of a phone number."
              : "Add someone here, or capture them at the till while ringing up a sale."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-40">Phone</TableHead>
                <TableHead className="w-56">Email</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-32">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <Link
                      href={`/customers/${customer.id}`}
                      className="hover:text-brand-700 font-medium hover:underline"
                    >
                      {customer.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {customer.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground truncate">
                    {customer.email ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground truncate text-xs">
                    {customer.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDate(customer.createdAt)}
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
