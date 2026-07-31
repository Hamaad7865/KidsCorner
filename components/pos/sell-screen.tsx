"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Minus, Plus, Search, ShoppingCart, Trash2, X } from "lucide-react"

import { ColourSwatch } from "@/components/settings/colour-swatch"
import { DiscountDialog } from "@/components/pos/discount-dialog"
import { PaymentPanel } from "@/components/pos/payment-panel"
import { QuickKeys } from "@/components/pos/quick-keys"
import { TillToolbar } from "@/components/pos/till-toolbar"
import type { Cashier } from "@/lib/pos/sale-core"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { PaymentMethod } from "@/lib/db-enums"
import type { DiscountRule } from "@/lib/discounts/rules"
import { formatRs, round2 } from "@/lib/format"
import { cartTotals, useCart } from "@/lib/pos/cart-store"
import type { CatalogVariant } from "@/lib/pos/queries"
import { cn } from "@/lib/utils"

/** How many search results to render before asking for a narrower query. */
const MAX_RESULTS = 40

type ProductGroup = {
  productId: number
  productName: string
  variants: CatalogVariant[]
}

export function SellScreen({
  catalog,
  shiftId,
  vatRate,
  paymentMethods,
  cashierName,
  cashiers,
  discounts,
  today,
}: {
  catalog: CatalogVariant[]
  shiftId: number
  vatRate: number
  paymentMethods: PaymentMethod[]
  cashierName: string
  cashiers: Cashier[]
  discounts: DiscountRule[]
  today: string
}) {
  const [query, setQuery] = useState("")
  const [picker, setPicker] = useState<ProductGroup | null>(null)
  const [paying, setPaying] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const lines = useCart((s) => s.lines)
  const saleDiscount = useCart((s) => s.saleDiscount)
  const addVariant = useCart((s) => s.addVariant)
  const setQty = useCart((s) => s.setQty)
  const remove = useCart((s) => s.remove)
  const clear = useCart((s) => s.clear)

  const totals = cartTotals(lines, saleDiscount, vatRate)

  // Barcode lookup is exact and O(1): a scanner types fast and hits Enter, so
  // this must not depend on the fuzzy search path.
  const byBarcode = useMemo(() => {
    const map = new Map<string, CatalogVariant>()
    for (const v of catalog) if (v.barcode) map.set(v.barcode.trim(), v)
    return map
  }, [catalog])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const matches = catalog.filter(
      (v) =>
        v.productName.toLowerCase().includes(q) ||
        v.sku.toLowerCase().includes(q) ||
        (v.barcode ?? "").toLowerCase().includes(q),
    )

    // Grouped by product: the spec's search flow opens a variant picker for the
    // matched product rather than listing every size/colour separately.
    const groups = new Map<number, ProductGroup>()
    for (const v of matches) {
      const existing = groups.get(v.productId)
      if (existing) existing.variants.push(v)
      else
        groups.set(v.productId, {
          productId: v.productId,
          productName: v.productName,
          variants: [v],
        })
    }
    return [...groups.values()].slice(0, MAX_RESULTS)
  }, [query, catalog])

  const announce = (message: string) => {
    setFlash(message)
    setTimeout(() => setFlash(null), 1400)
  }

  const submitSearch = () => {
    const raw = query.trim()
    if (!raw) return

    const scanned = byBarcode.get(raw)
    if (scanned) {
      addVariant(scanned)
      announce(`${scanned.productName} added`)
      setQuery("")
      return
    }

    // A single matching product goes straight to its picker — one less tap.
    if (results.length === 1) {
      openPicker(results[0])
      setQuery("")
    }
  }

  const openPicker = (group: ProductGroup) => {
    // Only one variant means there is nothing to pick.
    if (group.variants.length === 1) {
      addVariant(group.variants[0])
      announce(`${group.productName} added`)
      return
    }
    setPicker(group)
  }

  // The search box is the till's default focus: a scanner acts as a keyboard,
  // so anything typed anywhere should land here.
  useEffect(() => {
    if (!picker && !paying) searchRef.current?.focus()
  }, [picker, paying, lines.length])

  /**
   * Periodic catalog refresh.
   *
   * The catalog is loaded once when the till opens, so prices changed in the
   * back office and stock sold on another till would otherwise never reach this
   * screen. `router.refresh()` re-runs the server component only — the cart is
   * zustand state and is untouched, so this can never disturb a sale in
   * progress. Paused during payment, where a re-render is pure distraction.
   */
  useEffect(() => {
    if (paying) return
    const timer = setInterval(() => router.refresh(), 5 * 60_000)
    return () => clearInterval(timer)
  }, [paying, router])

  if (paying) {
    return (
      <PaymentPanel
        shiftId={shiftId}
        vatRate={vatRate}
        paymentMethods={paymentMethods}
        cashierName={cashierName}
        // Only staff who could actually authorise an override. The server
        // re-checks the role anyway — this is so the till does not offer a
        // cashier's face for a job their PIN will be refused for.
        managers={cashiers.filter((c) => c.role === "owner" || c.role === "manager")}
        onCancel={() => setPaying(false)}
        onDone={() => setPaying(false)}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Product area — roughly 60% per the spec. */}
      <section className="flex min-h-0 flex-1 flex-col gap-3 p-4 lg:w-3/5">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
            aria-hidden
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                submitSearch()
              }
            }}
            placeholder="Scan barcode or search…"
            className="h-control pl-10 text-base"
            autoComplete="off"
            aria-label="Scan barcode or search products"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="size-5" />
            </button>
          ) : null}
        </div>

        {flash ? (
          <div
            role="status"
            className="bg-success-muted text-success rounded-md px-3 py-2 text-sm font-medium"
          >
            {flash}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {query.trim().length < 2 ? (
            <QuickKeys
              catalog={catalog}
              // Reuses the same picker as search, so a category tap and a
              // search hit behave identically from here on.
              onPick={(product) =>
                openPicker({
                  productId: product.productId,
                  productName: product.productName,
                  variants: product.variants,
                })
              }
            />
          ) : results.length === 0 ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              Nothing matches “{query}”.
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((group) => {
                const stock = group.variants.reduce((s, v) => s + v.qtyOnHand, 0)
                const prices = group.variants.map((v) => v.price)
                const min = Math.min(...prices)
                const max = Math.max(...prices)
                return (
                  <li key={group.productId}>
                    <button
                      type="button"
                      onClick={() => openPicker(group)}
                      className="hover:border-brand-500 hover:bg-accent bg-card flex min-h-tap w-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors"
                    >
                      <span className="line-clamp-2 font-medium">
                        {group.productName}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {group.variants.length} variant
                        {group.variants.length === 1 ? "" : "s"} · {stock} in stock
                      </span>
                      <span className="text-brand-700 font-medium tabular-nums">
                        {min === max
                          ? formatRs(min)
                          : `${formatRs(min)} – ${formatRs(max)}`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Cart — roughly 40%. */}
      <section className="bg-card flex min-h-0 w-full flex-col border-t lg:w-2/5 lg:border-t-0 lg:border-l">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex items-center gap-2 font-medium">
            <ShoppingCart className="size-5" aria-hidden />
            Cart
            {totals.itemCount > 0 ? (
              <Badge variant="secondary">{totals.itemCount}</Badge>
            ) : null}
          </div>
          {lines.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear
            </Button>
          ) : null}
        </header>

        <div className="border-b px-4 py-2">
          <TillToolbar cashiers={cashiers} fallbackName={cashierName} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
              <ShoppingCart className="size-10 opacity-30" aria-hidden />
              Nothing in the cart yet.
            </div>
          ) : (
            <ul className="divide-y">
              {lines.map((line) => (
                <li key={line.variantId} className="flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <ColourSwatch hex={line.colourHex} name={line.colourName} />
                      <span className="truncate font-medium">
                        {line.productName}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {line.sizeLabel} · {line.colourName} ·{" "}
                      {formatRs(line.unitPrice)}
                    </div>
                    {line.qty > line.qtyOnHand ? (
                      <div className="text-warning-foreground mt-1 text-xs">
                        Only {line.qtyOnHand} in stock — selling anyway will make
                        the count negative.
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setQty(line.variantId, line.qty - 1)}
                      aria-label={`Reduce ${line.productName}`}
                    >
                      <Minus aria-hidden />
                    </Button>
                    <span className="w-8 text-center font-medium tabular-nums">
                      {line.qty}
                    </span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      onClick={() => setQty(line.variantId, line.qty + 1)}
                      aria-label={`Add another ${line.productName}`}
                    >
                      <Plus aria-hidden />
                    </Button>
                  </div>

                  <div className="w-20 text-right font-medium tabular-nums">
                    {formatRs(line.unitPrice * line.qty - line.discount)}
                  </div>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remove(line.variantId)}
                    aria-label={`Remove ${line.productName}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="space-y-2 border-t p-4">
          <Row label="Subtotal" value={formatRs(totals.subtotal)} />
          {totals.lineDiscounts > 0 ? (
            <Row
              label="Line discounts"
              value={`− ${formatRs(totals.lineDiscounts)}`}
            />
          ) : null}
          {/* Sits above the VAT line because it changes the total; VAT is
              derived from whatever the total ends up being. */}
          <DiscountDialog
            rules={discounts}
            basketTotal={round2(totals.subtotal - totals.lineDiscounts)}
            today={today}
          />

          {totals.saleDiscount > 0 ? (
            <Row
              label="Discounts"
              value={`− ${formatRs(totals.saleDiscount)}`}
            />
          ) : null}

          <Row
            label={`VAT (included, ${Math.round(vatRate * 100)}%)`}
            value={formatRs(totals.vat)}
            muted
          />
          <div className="flex items-baseline justify-between border-t pt-2">
            <span className="font-medium">TOTAL</span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatRs(totals.total)}
            </span>
          </div>

          <Button
            className="h-14 w-full text-base"
            disabled={lines.length === 0}
            onClick={() => setPaying(true)}
          >
            Pay {formatRs(totals.total)}
          </Button>
        </footer>
      </section>

      {picker ? (
        <VariantPicker
          group={picker}
          onPick={(variant) => {
            addVariant(variant)
            announce(`${variant.productName} · ${variant.sizeLabel} added`)
            setPicker(null)
            setQuery("")
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  )
}

function Row({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between text-sm",
        muted && "text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

/**
 * Size × colour grid for a matched product. Out-of-stock cells are greyed but
 * still tappable — a shop often sells the last item before the count catches up.
 */
function VariantPicker({
  group,
  onPick,
  onClose,
}: {
  group: ProductGroup
  onPick: (variant: CatalogVariant) => void
  onClose: () => void
}) {
  const sizes = [...new Set(group.variants.map((v) => v.sizeLabel))].sort(
    (a, b) =>
      (group.variants.find((v) => v.sizeLabel === a)?.sizeSort ?? 0) -
      (group.variants.find((v) => v.sizeLabel === b)?.sizeSort ?? 0),
  )
  const colours = [...new Set(group.variants.map((v) => v.colourName))].sort()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Choose a size and colour for ${group.productName}`}
      onClick={onClose}
    >
      <div
        className="bg-card max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">
            {group.productName}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">Size</th>
                {colours.map((colour) => (
                  <th key={colour} className="min-w-28 px-3 py-2 font-medium">
                    <span className="flex items-center justify-center gap-1.5">
                      <ColourSwatch
                        hex={
                          group.variants.find((v) => v.colourName === colour)
                            ?.colourHex ?? null
                        }
                        name={colour}
                      />
                      {colour}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sizes.map((size) => (
                <tr key={size} className="border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {size}
                  </th>
                  {colours.map((colour) => {
                    const variant = group.variants.find(
                      (v) => v.sizeLabel === size && v.colourName === colour,
                    )
                    if (!variant) {
                      return (
                        <td
                          key={colour}
                          className="text-muted-foreground/40 border-l px-3 py-2 text-center"
                        >
                          —
                        </td>
                      )
                    }
                    const out = variant.qtyOnHand <= 0
                    return (
                      <td key={colour} className="border-l p-0">
                        <button
                          type="button"
                          onClick={() => onPick(variant)}
                          className={cn(
                            "hover:bg-accent flex min-h-tap w-full flex-col items-center justify-center gap-0.5 px-3 py-2 transition-colors",
                            out && "opacity-50",
                          )}
                        >
                          <span className="font-medium tabular-nums">
                            {formatRs(variant.price)}
                          </span>
                          <span
                            className={cn(
                              "text-xs tabular-nums",
                              out ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {out ? "out of stock" : `${variant.qtyOnHand} left`}
                          </span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
