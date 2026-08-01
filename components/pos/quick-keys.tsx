"use client"

import { useMemo, useState } from "react"
import { LayoutGrid } from "lucide-react"

import { ProductThumb } from "@/components/products/product-thumb"
import { Button } from "@/components/ui/button"
import { formatRs } from "@/lib/format"
import type { CatalogVariant } from "@/lib/pos/queries"
import { cn } from "@/lib/utils"

/** Products shown per category before asking the cashier to search instead. */
const MAX_TILES = 60

export type QuickProduct = {
  productId: number
  productName: string
  variants: CatalogVariant[]
  stock: number
  minPrice: number
  maxPrice: number
  imageUrl: string | null
}

/**
 * Category grid for the idle till.
 *
 * Fills the space the "scan something" placeholder used to occupy: for a shop
 * where plenty of stock has no barcode, tapping a category is faster than
 * typing, and it gives the screen something useful to do between customers.
 *
 * Built from the catalog already in memory — no extra network, so it works in
 * exactly the conditions the till was designed for.
 */
export function QuickKeys({
  catalog,
  onPick,
}: {
  catalog: CatalogVariant[]
  onPick: (product: QuickProduct) => void
}) {
  const [categoryId, setCategoryId] = useState<number | null>(null)

  const categories = useMemo(() => {
    const map = new Map<number, { id: number; name: string; count: number }>()
    for (const v of catalog) {
      if (v.categoryId === null) continue
      const existing = map.get(v.categoryId)
      if (existing) existing.count += 1
      else
        map.set(v.categoryId, {
          id: v.categoryId,
          name: v.categoryName ?? "Uncategorised",
          count: 1,
        })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [catalog])

  const products = useMemo(() => {
    if (categoryId === null) return []
    const map = new Map<number, QuickProduct>()

    for (const v of catalog) {
      if (v.categoryId !== categoryId) continue
      const existing = map.get(v.productId)
      if (existing) {
        existing.variants.push(v)
        existing.stock += v.qtyOnHand
        existing.minPrice = Math.min(existing.minPrice, v.price)
        existing.maxPrice = Math.max(existing.maxPrice, v.price)
      } else {
        map.set(v.productId, {
          productId: v.productId,
          productName: v.productName,
          variants: [v],
          stock: v.qtyOnHand,
          minPrice: v.price,
          maxPrice: v.price,
          imageUrl: v.imageUrl,
        })
      }
    }

    return [...map.values()]
      .sort((a, b) => a.productName.localeCompare(b.productName))
      .slice(0, MAX_TILES)
  }, [catalog, categoryId])

  if (categories.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-center">
        <LayoutGrid className="size-10 opacity-40" aria-hidden />
        <p className="text-sm">
          Scan a barcode, or type at least two characters to search.
        </p>
        <p className="text-xs">{catalog.length} variants loaded</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => {
          const active = categoryId === category.id
          return (
            <Button
              key={category.id}
              variant={active ? "default" : "outline"}
              className="h-control"
              // Tapping the open category closes it, so the grid is never a
              // one-way trip into a category with no way back.
              onClick={() => setCategoryId(active ? null : category.id)}
            >
              {category.name}
              <span
                className={cn(
                  "ml-1.5 text-xs tabular-nums",
                  active ? "opacity-80" : "text-muted-foreground",
                )}
              >
                {category.count}
              </span>
            </Button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {categoryId === null ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-center">
            <LayoutGrid className="size-10 opacity-40" aria-hidden />
            <p className="text-sm">
              Pick a category, scan a barcode, or start typing.
            </p>
            <p className="text-xs">{catalog.length} variants loaded</p>
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <li key={product.productId}>
                <button
                  type="button"
                  onClick={() => onPick(product)}
                  className="hover:border-brand-500 hover:bg-accent bg-card flex min-h-tap w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors"
                >
                  {/* Leading, not on top: the tile is a row, and a picture
                      that pushed the price down the card would cost every
                      tile the height of a photo for the sake of one. */}
                  <ProductThumb
                    src={product.imageUrl}
                    name={product.productName}
                    size={48}
                  />
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <span className="line-clamp-2 font-medium">
                      {product.productName}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {product.variants.length} variant
                      {product.variants.length === 1 ? "" : "s"} · {product.stock} in
                      stock
                    </span>
                    <span className="text-brand-700 font-medium tabular-nums">
                      {product.minPrice === product.maxPrice
                        ? formatRs(product.minPrice)
                        : `${formatRs(product.minPrice)} – ${formatRs(product.maxPrice)}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
