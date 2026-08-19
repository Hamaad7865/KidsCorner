import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Printer } from "lucide-react"

import { GenerateBarcodesDialog } from "@/components/barcodes/generate-barcodes-dialog"
import { GenerateVariantsDialog } from "@/components/products/generate-variants-dialog"
import { ProductForm } from "@/components/products/product-form"
import { ProductThumb } from "@/components/products/product-thumb"
import { VariantMatrix } from "@/components/products/variant-matrix"
import { ActiveBadge } from "@/components/settings/master-data-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { requireAdminProfile } from "@/lib/auth/session"
import {
  listVariantsWithoutBarcode,
  readBarcodeSettings,
} from "@/lib/barcodes/queries"
import { formatPriceRange, formatQty } from "@/lib/format"
import { getMasterData } from "@/lib/master-data/queries"
import { getProduct } from "@/lib/products/queries"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const parsed = Number(id)
  if (!Number.isInteger(parsed) || parsed <= 0) return { title: "Product" }

  const product = await getProduct(parsed)
  return { title: product?.name ?? "Product" }
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireAdminProfile()

  const { id } = await params
  const productId = Number(id)
  // A non-numeric segment would otherwise reach Postgres and come back as a
  // 22P02 invalid-input error rather than a 404.
  if (!Number.isInteger(productId) || productId <= 0) notFound()

  const [
    product,
    { categories, brands, sizes, colours },
    barcodeless,
    barcodeSettings,
  ] = await Promise.all([
    getProduct(productId),
    getMasterData(),
    listVariantsWithoutBarcode(productId),
    readBarcodeSettings(),
  ])

  if (!product) notFound()

  const printable = product.variants.some((variant) => variant.barcode)

  // Cost and margin are owner/manager only, the same bar the sales screen uses.
  const canSeeCost = profile.role === "owner" || profile.role === "manager"

  // Active variants only: a retired colour should not inflate the stock figure
  // or widen the price range a buyer is reading.
  const live = product.variants.filter((v) => v.isActive)
  const totalStock = live.reduce((sum, v) => sum + v.qtyOnHand, 0)

  const sellPrices = live.map((v) => v.sellingPrice)
  const costPrices = live.map((v) => v.costPrice).filter((c) => c > 0)

  // Weighted by what is actually on hand, not a flat average of the variants:
  // eight of a cheap size and one of an expensive one is not a midpoint.
  const stockAtCost = live.reduce((sum, v) => sum + v.costPrice * v.qtyOnHand, 0)
  const stockAtSell = live.reduce((sum, v) => sum + v.sellingPrice * v.qtyOnHand, 0)
  const margin =
    canSeeCost && stockAtSell > 0
      ? Math.round(((stockAtSell - stockAtCost) / stockAtSell) * 100)
      : null

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" render={<Link href="/products" />}>
          <ArrowLeft aria-hidden />
          Products
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3.5">
            <ProductThumb
              src={product.imageUrl}
              name={product.name}
              size={64}
              className="rounded-lg"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h1 className="font-heading text-xl font-semibold">{product.name}</h1>
                {product.productCode ? (
                  <span className="text-muted-foreground font-mono text-sm">
                    {product.productCode}
                  </span>
                ) : null}
                <ActiveBadge isActive={product.isActive} />
              </div>
              <p className="text-muted-foreground text-sm">
                {[product.categoryName, product.brandName].filter(Boolean).join(" · ") ||
                  "Uncategorised"}
              </p>
              {product.shelfLocation ? (
                <p className="text-muted-foreground text-sm">
                  Shelf location:{" "}
                  <span className="text-foreground font-medium">
                    {product.shelfLocation}
                  </span>
                </p>
              ) : null}
            </div>
          </div>

        </div>

        {/* The design's figure strip. Cost and margin are gated — a cashier
            with catalogue access has no business reading what the shop pays. */}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <ProductStat label="Variants" value={String(live.length)} />
          <ProductStat label="On hand" value={formatQty(totalStock)} unit="units" />
          <ProductStat
            label="Sell price"
            value={
              sellPrices.length > 0
                ? formatPriceRange(Math.min(...sellPrices), Math.max(...sellPrices))
                : "—"
            }
          />
          <ProductStat
            label="Cost price"
            value={
              !canSeeCost
                ? "Hidden"
                : costPrices.length > 0
                  ? formatPriceRange(Math.min(...costPrices), Math.max(...costPrices))
                  : "—"
            }
            muted={!canSeeCost}
          />
          <ProductStat
            label="Margin"
            value={margin === null ? "Hidden" : `${margin}%`}
            muted={margin === null}
          />
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <GenerateBarcodesDialog
              productId={product.id}
              variants={barcodeless}
              settings={barcodeSettings}
            />
            {printable ? (
              <Button
                variant="outline"
                render={
                  <a
                    href={`/products/${product.id}/labels`}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                <Printer aria-hidden />
                Print labels
              </Button>
            ) : null}
            <GenerateVariantsDialog
              product={product}
              sizes={sizes}
              colours={colours}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductForm
              product={product}
              categories={categories}
              brands={brands}
            />
          </CardContent>
        </Card>

        <div className="space-y-3 lg:col-span-3">
          <h2 className="font-heading text-base font-medium">Variants</h2>
          <VariantMatrix product={product} sizes={sizes} colours={colours} />
        </div>
      </div>
    </div>
  )
}

/**
 * One figure in the strip under the product's name.
 *
 * `muted` carries the cost-hidden state: dimmer and smaller, so "Hidden" reads
 * as an absence rather than as a value somebody might quote.
 */
function ProductStat({
  label,
  value,
  unit,
  muted = false,
}: {
  label: string
  value: string
  unit?: string
  muted?: boolean
}) {
  return (
    <Card>
      <CardContent className="py-3">
        <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {label}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span
            className={
              muted
                ? "text-muted-foreground text-sm font-medium"
                : "text-lg font-semibold tabular-nums"
            }
          >
            {value}
          </span>
          {unit && !muted ? (
            <span className="text-muted-foreground text-xs">{unit}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
