import type { Metadata } from "next"
import Link from "next/link"
import { Package, Plus } from "lucide-react"

import { ProductFilters } from "@/components/products/product-filters"
import { ActiveBadge } from "@/components/settings/master-data-panel"
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
import { ColourSwatch } from "@/components/settings/colour-swatch"
import { formatPriceRange, formatQty } from "@/lib/format"
import { getMasterData } from "@/lib/master-data/queries"
import { listProducts } from "@/lib/products/queries"

export const metadata: Metadata = { title: "Products" }

const GENDER_LABELS: Record<string, string> = {
  boy: "Boy",
  girl: "Girl",
  unisex: "Unisex",
}

/** A query param arrives as an array when the key is repeated in the URL. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()

  const params = await searchParams
  const search = first(params.q)?.trim() || undefined
  const categoryId = positiveInt(first(params.category))
  const brandId = positiveInt(first(params.brand))
  const showInactive = first(params.inactive) === "1"

  const [{ categories, brands }, { rows: products, truncated }] = await Promise.all([
    getMasterData(),
    listProducts({ search, categoryId, brandId, activeOnly: !showInactive }),
  ])

  const isFiltered = Boolean(search || categoryId || brandId || showInactive)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">Products</h1>
          <p className="text-muted-foreground text-sm">
            {truncated ? "First " : ""}
            {formatQty(products.length)} product
            {products.length === 1 ? "" : "s"} ·{" "}
            {formatQty(products.reduce((n, p) => n + p.variantCount, 0))} variants
            · {formatQty(products.reduce((n, p) => n + p.totalStock, 0))} units on
            hand
            {isFiltered ? " (filtered)" : ""}
            {truncated
              ? ". There are more — narrow the search or filters to see them."
              : ""}
          </p>
        </div>
        <Button render={<Link href="/products/new" />}>
          <Plus aria-hidden />
          New product
        </Button>
      </header>

      <ProductFilters categories={categories} brands={brands} />

      {products.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Package className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 font-medium">
            {isFiltered ? "Nothing matches those filters" : "No products yet"}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            {isFiltered
              ? "Try clearing the search or picking a different category."
              : "Add products one at a time, or bring in a whole spreadsheet with the Excel import."}
          </p>
          {isFiltered ? null : (
            <div className="mt-4 flex justify-center gap-2">
              <Button render={<Link href="/products/new" />}>
                <Plus aria-hidden />
                New product
              </Button>
              <Button variant="outline" render={<Link href="/import" />}>
                Import a spreadsheet
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-36">Category</TableHead>
                <TableHead className="w-32">Brand</TableHead>
                <TableHead className="w-24">For</TableHead>
                <TableHead className="w-40">Colours</TableHead>
                <TableHead className="w-24 text-right">Variants</TableHead>
                <TableHead className="w-24 text-right">Stock</TableHead>
                <TableHead className="w-44">Price</TableHead>
                <TableHead className="w-28">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <Link
                      href={`/products/${product.id}`}
                      className="hover:text-brand-700 font-medium hover:underline"
                    >
                      {product.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {product.categoryName ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {product.brandName ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {GENDER_LABELS[product.gender] ?? product.gender}
                  </TableCell>
                  <TableCell>
                    {product.colours.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {/* Four swatches then a count. Past four the row stops
                            being scannable, and "+5" answers the question the
                            swatches were there to answer anyway. */}
                        {product.colours.slice(0, 4).map((colour) => (
                          <ColourSwatch
                            key={colour.name}
                            hex={colour.hex}
                            name={colour.name}
                          />
                        ))}
                        {product.colours.length > 4 ? (
                          <span className="text-muted-foreground text-xs tabular-nums">
                            +{product.colours.length - 4}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {product.variantCount === 0 ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        None
                      </Badge>
                    ) : (
                      product.variantCount
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span
                      className={
                        product.lowStockCount > 0
                          ? "text-warning-foreground font-medium"
                          : undefined
                      }
                      title={
                        product.lowStockCount > 0
                          ? `${product.lowStockCount} variant(s) at or below reorder level`
                          : undefined
                      }
                    >
                      {formatQty(product.totalStock)}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {product.minPrice === null || product.maxPrice === null
                      ? "—"
                      : formatPriceRange(product.minPrice, product.maxPrice)}
                  </TableCell>
                  <TableCell>
                    <ActiveBadge isActive={product.isActive} />
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
