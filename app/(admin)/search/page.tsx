import type { Metadata } from "next"
import Link from "next/link"
import { Factory, Package, ScanBarcode, SearchX, Users } from "lucide-react"

import { ColourSwatch } from "@/components/settings/colour-swatch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { requireAdminProfile } from "@/lib/auth/session"
import { formatQty, formatRs } from "@/lib/format"
import { search } from "@/lib/search/queries"

export const metadata: Metadata = { title: "Search" }

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()

  const params = await searchParams
  const query = first(params.q)
  const results = await search(query)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">
          {query ? `Results for “${query}”` : "Search"}
        </h1>
        <p className="text-muted-foreground text-sm">
          Products, barcodes, SKUs, suppliers and customers. Scanning a tag
          jumps straight to its product.
        </p>
      </header>

      {query.length < 2 ? (
        <Empty
          icon={SearchX}
          title="Type at least two characters"
          body="Or scan a barcode — the reader types into the same box."
        />
      ) : results.scan ? (
        <section className="space-y-3">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Scanned
          </h2>
          <div className="border-brand-200 bg-brand-50/50 flex flex-wrap items-center gap-4 rounded-lg border p-4">
            <ScanBarcode className="text-brand-700 size-6 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <Link
                href={`/products/${results.scan.productId}`}
                className="hover:text-brand-700 font-medium hover:underline"
              >
                {results.scan.productName}
              </Link>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
                <ColourSwatch
                  hex={results.scan.colourHex}
                  name={results.scan.colourName}
                />
                {results.scan.colourName} · {results.scan.sizeLabel}
                <span className="font-mono text-xs">{results.scan.barcode}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium tabular-nums">
                {formatRs(results.scan.sellingPrice)}
              </div>
              <div className="text-muted-foreground text-xs">
                {formatQty(results.scan.qtyOnHand)} in stock
              </div>
            </div>
            <Button render={<Link href={`/products/${results.scan.productId}`} />}>
              Open product
            </Button>
          </div>
        </section>
      ) : results.isEmpty ? (
        <Empty
          icon={SearchX}
          title="Nothing matched"
          body={
            /^\d{6,14}$/.test(query)
              ? "No variant carries that barcode. It may belong to stock that has not been added yet."
              : "Try part of a product name, a SKU, or a supplier."
          }
        />
      ) : (
        <div className="space-y-6">
          {results.products.length > 0 ? (
            <Group icon={Package} title="Products">
              {results.products.map((product) => (
                <li key={product.id}>
                  <Link
                    href={`/products/${product.id}`}
                    className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-3 transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {product.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {[product.categoryName, product.brandName]
                          .filter(Boolean)
                          .join(" · ") || "Uncategorised"}
                      </span>
                    </span>
                    {product.isActive ? null : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Inactive
                      </Badge>
                    )}
                    {product.variantCount > 0 ? (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {product.variantCount} variant
                        {product.variantCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </Group>
          ) : null}

          {results.suppliers.length > 0 ? (
            <Group icon={Factory} title="Suppliers">
              {results.suppliers.map((supplier) => (
                <li key={supplier.id}>
                  {/* By name, not to the bare list. Customers next door have
                      always linked to the customer; a supplier hit landed on
                      every supplier and made you find the one you searched. */}
                  <Link
                    href={`/suppliers?q=${encodeURIComponent(supplier.name)}`}
                    className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-3 transition-colors"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {supplier.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {supplier.phone ?? "—"}
                    </span>
                  </Link>
                </li>
              ))}
            </Group>
          ) : null}

          {results.customers.length > 0 ? (
            <Group icon={Users} title="Customers">
              {results.customers.map((customer) => (
                <li key={customer.id}>
                  <Link
                    href={`/customers/${customer.id}`}
                    className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-3 transition-colors"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {customer.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {customer.phone ?? "—"}
                    </span>
                  </Link>
                </li>
              ))}
            </Group>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Group({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  )
}

function Empty({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
}) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <Icon className="text-muted-foreground mx-auto size-8" aria-hidden />
      <p className="mt-3 font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{body}</p>
    </div>
  )
}
