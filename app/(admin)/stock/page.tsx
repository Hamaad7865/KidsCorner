import type { Metadata } from "next"
import Link from "next/link"
import { AlertTriangle, MapPin, PackageCheck, ScrollText } from "lucide-react"

import { ColourSwatch } from "@/components/settings/colour-swatch"
import { AdjustmentDialog } from "@/components/stock/adjustment-dialog"
import { MovementFilters } from "@/components/stock/movement-filters"
import { TransferDialog } from "@/components/stock/transfer-dialog"
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
import { TabLink } from "@/components/admin/tab-link"
import { requireAdminProfile } from "@/lib/auth/session"
import { isMovementType, type MovementType } from "@/lib/db-enums"
import { formatDate, formatQty, formatRs } from "@/lib/format"
import { listLocations } from "@/lib/access/queries"
import {
  countLowStock,
  listLowStock,
  listMovements,
  listStockByLocation,
} from "@/lib/stock/queries"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Stock" }

const TYPE_LABELS: Record<MovementType, string> = {
  purchase: "Purchase",
  sale: "Sale",
  adjustment: "Adjustment",
  return: "Return",
  opening: "Opening",
  import: "Import",
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/** Only a real ISO date is passed through; anything else is dropped. */
function isoDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminProfile()

  const params = await searchParams
  const tabParam = first(params.tab)
  const tab =
    tabParam === "low" ? "low" : tabParam === "locations" ? "locations" : "movements"
  const typeParam = first(params.type)
  const type = isMovementType(typeParam) ? typeParam : undefined
  const variantId = positiveInt(first(params.variant))

  const [movements, lowStock, lowStockCount, locationGroups, locations] =
    await Promise.all([
    tab === "movements"
      ? listMovements({
          type,
          variantId,
          from: isoDate(first(params.from)),
          to: isoDate(first(params.to)),
        })
      : Promise.resolve({ rows: [], truncated: false }),
    // Rows only when they are actually rendered; the other tab needs a number.
      tab === "low" ? listLowStock() : Promise.resolve([]),
      tab === "low" ? Promise.resolve(-1) : countLowStock(),
      tab === "locations" ? listStockByLocation() : Promise.resolve([]),
      // Always loaded: the Transfer button lives in the header on every tab,
      // and it needs to know whether there is anywhere to move stock to.
      listLocations(),
    ])

  const lowCount = tab === "low" ? lowStock.length : lowStockCount

  // The ledger links a variant here, so name the thing being filtered.
  const focusedVariant =
    variantId !== undefined
      ? movements.rows.find((row) => row.variantId === variantId)
      : undefined

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">Stock</h1>
          <p className="text-muted-foreground text-sm">
            Every change to stock is recorded here — nothing moves without a
            line in this list.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TransferDialog
            locations={locations.map((l) => ({
              id: l.id,
              name: l.name,
              isDefault: l.isDefault,
            }))}
          />
          <AdjustmentDialog defaultOpen={first(params.new) === "adjustment"} />
        </div>
      </header>

      <div className="flex gap-1 border-b">
        <TabLink href="/stock" active={tab === "movements"} icon={ScrollText}>
          Movements
        </TabLink>
        <TabLink
          href="/stock?tab=low"
          active={tab === "low"}
          icon={AlertTriangle}
          count={lowCount}
        >
          Low stock
        </TabLink>
        <TabLink
          href="/stock?tab=locations"
          active={tab === "locations"}
          icon={MapPin}
        >
          By location
        </TabLink>
      </div>

      {tab === "movements" ? (
        <div className="space-y-4">
          <MovementFilters />

          {variantId !== undefined ? (
            <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2 text-sm">
              <span>
                Showing one variant only
                {focusedVariant?.productName
                  ? `: ${focusedVariant.productName} · ${focusedVariant.sizeLabel} · ${focusedVariant.colourName}`
                  : ""}
                .
              </span>
              <Button variant="ghost" size="sm" render={<Link href="/stock" />}>
                Show all movements
              </Button>
            </div>
          ) : null}

          {movements.rows.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No movements yet"
              body="Movements appear as soon as you import a spreadsheet, receive a purchase, adjust a count or make a sale."
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-36">Date</TableHead>
                      <TableHead>Product / variant</TableHead>
                      <TableHead className="w-28">Type</TableHead>
                      <TableHead className="w-16 text-right">In</TableHead>
                      <TableHead className="w-16 text-right">Out</TableHead>
                      <TableHead className="w-36">Reference</TableHead>
                      <TableHead className="w-32">User</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.rows.map((row) => (
                      <TableRow key={row.id}>
                        {/* Date over time, as the design stacks them — the day
                            is what a person scans for, the clock is the
                            tie-break within it. */}
                        <TableCell className="text-xs">
                          <div className="font-medium">{formatDate(row.createdAt)}</div>
                          <div className="text-muted-foreground">
                            {formatClock(row.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <ColourSwatch
                              hex={row.colourHex}
                              name={row.colourName ?? undefined}
                            />
                            <div className="min-w-0">
                              {/* The only route to the per-variant filter. */}
                              {row.variantId ? (
                                <Link
                                  href={`/stock?variant=${row.variantId}`}
                                  className="hover:text-brand-700 block truncate font-medium hover:underline"
                                  title="Show only this variant's movements"
                                >
                                  {row.productName ?? "—"}
                                </Link>
                              ) : (
                                <div className="truncate font-medium">
                                  {row.productName ?? "—"}
                                </div>
                              )}
                              <div className="text-muted-foreground truncate text-xs">
                                {row.sizeLabel} · {row.colourName}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {TYPE_LABELS[row.movementType]}
                          </Badge>
                        </TableCell>
                        {/* Split into two columns rather than one signed
                            figure. Goods in and goods out are different
                            questions, and a column of mixed +/- has to be read
                            character by character to answer either. */}
                        <TableCell className="text-success text-right font-medium tabular-nums">
                          {row.qty > 0 ? row.qty : ""}
                        </TableCell>
                        <TableCell className="text-destructive text-right font-medium tabular-nums">
                          {row.qty < 0 ? -row.qty : ""}
                        </TableCell>
                        <TableCell className="text-muted-foreground truncate text-xs">
                          {referenceOf(row) ?? row.notes ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {row.createdBy ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {movements.truncated ? (
                <p className="text-muted-foreground text-xs">
                  Showing the most recent {movements.rows.length} movements.
                  Narrow the date range to see older ones.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : tab === "locations" ? (
        <div className="space-y-6">
          {locationGroups.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="Nothing located yet"
              body="Balances appear here once stock moves. Every movement is stamped with a location — the default one unless a transfer says otherwise."
            />
          ) : (
            locationGroups.map((group) => (
              <section key={group.locationId} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-heading flex items-center gap-2 text-base font-medium">
                    <MapPin className="size-4" aria-hidden />
                    {group.locationName}
                  </h2>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {formatQty(group.totalUnits)} unit
                    {group.totalUnits === 1 ? "" : "s"} across {group.rows.length}{" "}
                    variant{group.rows.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Variant</TableHead>
                        <TableHead className="w-36">SKU</TableHead>
                        <TableHead className="w-24 text-right">Here</TableHead>
                        <TableHead className="w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rows.map((row) => (
                        <TableRow key={`${group.locationId}-${row.variantId}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <ColourSwatch
                                hex={row.colourHex}
                                name={row.colourName}
                              />
                              <div className="min-w-0">
                                <div className="truncate font-medium">
                                  {row.productName}
                                </div>
                                <div className="text-muted-foreground truncate text-xs">
                                  {row.sizeLabel} · {row.colourName}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground font-mono text-xs">
                            {row.sku}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-medium tabular-nums",
                              row.qty < 0 && "text-destructive",
                            )}
                          >
                            {row.qty}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.productId ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                render={<Link href={`/products/${row.productId}`} />}
                              >
                                Open
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            ))
          )}

          <p className="text-muted-foreground text-xs">
            These are derived from the movement ledger, not a second stored
            count — each figure is the sum of that variant&rsquo;s movements at
            that location. A negative here means stock was sold or moved out of
            a location it was never booked into.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {lowStock.length === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title="Nothing needs reordering"
              body="A variant lands here once its quantity drops to or below its reorder level. Set reorder levels on the product's variant matrix."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variant</TableHead>
                    <TableHead className="w-36">SKU</TableHead>
                    <TableHead className="w-24 text-right">In stock</TableHead>
                    <TableHead className="w-28 text-right">Reorder at</TableHead>
                    <TableHead className="w-28 text-right">Price</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowStock.map((row) => (
                    <TableRow key={row.variantId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ColourSwatch hex={row.colourHex} name={row.colourName} />
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {row.productName}
                            </div>
                            <div className="text-muted-foreground truncate text-xs">
                              {row.sizeLabel} · {row.colourName}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {row.sku}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          row.qtyOnHand <= 0
                            ? "text-destructive"
                            : "text-warning-foreground",
                        )}
                      >
                        {row.qtyOnHand}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {row.reorderLevel}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatRs(row.sellingPrice)}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.productId ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            render={<Link href={`/products/${row.productId}`} />}
                          >
                            Open
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState({
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

/** "09:42" — the clock under the date, on the shop's timezone. */
function formatClock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Indian/Mauritius",
  }).format(new Date(iso))
}

/**
 * "POS-2261", "PO-118" — what caused this movement.
 *
 * The design shows a reference rather than a free-text note, because a
 * movement worth querying is nearly always one you want to trace back to its
 * document. Falls through to the note for an adjustment, which has none.
 */
function referenceOf(row: { referenceType: string | null; referenceId: number | null }): string | null {
  if (!row.referenceType || row.referenceId === null) return null
  // The values the RPCs actually write. `pos_sale` rather than `sale`: a
  // branch matching "sale" here is dead code that happens to produce the right
  // answer via the fallback, which is exactly the kind of thing that stops
  // being true the day somebody edits the fallback.
  const prefix =
    row.referenceType === "pos_sale"
      ? "POS"
      : row.referenceType === "purchase"
        ? "PO"
        : row.referenceType === "credit_note"
          ? "CN"
          : row.referenceType.slice(0, 3).toUpperCase()
  return `${prefix}-${row.referenceId}`
}
