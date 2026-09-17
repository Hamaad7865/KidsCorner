import type { Metadata } from "next"
import Link from "next/link"
import { Package, Search } from "lucide-react"

import { PrintLabelsTable } from "@/components/barcodes/print-labels-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { listLocations } from "@/lib/access/queries"
import { requireAdminProfile } from "@/lib/auth/session"
import { listPrintableProducts } from "@/lib/barcodes/queries"
import { formatQty } from "@/lib/format"

export const metadata: Metadata = { title: "Print labels" }

/** A query param arrives as an array when the key is repeated in the URL. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Print barcode labels for many products at once, a location's stock at a time.
 *
 * Pick a location (the warehouse or the shop floor), tick the products to
 * label, and print them all in one roll job — the count for each is its stock at
 * that location. Products with no barcode can have one issued right here rather
 * than through a detour to their edit screen.
 *
 * Location and search are server-driven through the URL (`?location`, `?q`) so
 * the view is shareable and survives a reload; selection, printing and
 * generating are client-side, in `PrintLabelsTable`.
 */
export default async function PrintLabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()

  const params = await searchParams
  const q = first(params.q)?.trim() || undefined
  const locationParam = positiveInt(first(params.location))

  const locations = (await listLocations()).filter((location) => location.isActive)
  const selected =
    locations.find((location) => location.id === locationParam) ??
    locations.find((location) => location.isDefault) ??
    locations[0]
  const locationId = selected?.id

  const { rows, truncated } = await listPrintableProducts(locationId, q)

  const buildHref = (overrides: { location?: number; q?: string }): string => {
    const sp = new URLSearchParams()
    const loc = overrides.location ?? locationId
    if (loc) sp.set("location", String(loc))
    const query = "q" in overrides ? overrides.q : q
    if (query) sp.set("q", query)
    const qs = sp.toString()
    return qs ? `/print-labels?${qs}` : "/print-labels"
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold">Print labels</h1>
        <p className="text-muted-foreground text-sm">
          Tick the products to label and print them together on the 40×30mm roll
          — one label per unit in stock at the chosen location.
        </p>
      </header>

      {/* Location */}
      <div className="space-y-2">
        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Location
        </div>
        {locations.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No stock locations are set up.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {locations.map((location) => (
              <Button
                key={location.id}
                size="sm"
                variant={location.id === locationId ? "default" : "outline"}
                render={<Link href={buildHref({ location: location.id })} />}
              >
                {location.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <form action="/print-labels" method="get" className="flex max-w-md gap-2">
        {locationId ? (
          <input type="hidden" name="location" value={locationId} />
        ) : null}
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search products…"
          aria-label="Search products"
        />
        <Button type="submit" variant="outline">
          <Search aria-hidden />
          Search
        </Button>
      </form>

      {/* Products */}
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Package className="text-muted-foreground mx-auto size-7" aria-hidden />
          <p className="mt-2 font-medium">
            {q ? `Nothing matches “${q}”` : "No products yet"}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {q
              ? "Try a different word from the product name."
              : "Add products before printing labels."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">
            {truncated ? "First " : ""}
            {formatQty(rows.length)} product{rows.length === 1 ? "" : "s"}
            {q ? ` matching “${q}”` : ""}
            {truncated ? " — search to narrow the list." : ""}
          </p>
          <PrintLabelsTable rows={rows} locationId={locationId} />
        </div>
      )}
    </div>
  )
}
