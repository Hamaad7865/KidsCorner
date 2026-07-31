"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import { ColourSwatch } from "@/components/settings/colour-swatch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { SIZE_TYPE_LABELS, type SizeType } from "@/lib/db-enums"
import { formatRs } from "@/lib/format"
import { IDLE_STATE } from "@/lib/forms"
import type { Colour, Size } from "@/lib/master-data/queries"
import { updateVariant } from "@/lib/products/actions"
import type { ProductDetail, VariantRow } from "@/lib/products/queries"
import { isLowStock, isOutOfStock } from "@/lib/products/stock"
import { cn } from "@/lib/utils"

/**
 * Rows are sizes, columns are colour swatches — the layout the spec calls for.
 * Only sizes and colours this product actually has variants for are shown;
 * everything else would be an empty column nobody can act on.
 *
 * Quantity is read-only here by design. The spec makes `stock_movements` the
 * source of truth and `qty_on_hand` a cache that only `record_stock_movement`
 * may write, so changing a count belongs to the stock adjustment flow (which
 * also requires a reason) rather than a silent inline edit.
 */
export function VariantMatrix({
  product,
  sizes,
  colours,
}: {
  product: ProductDetail
  sizes: Size[]
  colours: Colour[]
}) {
  const [editing, setEditing] = useState<VariantRow | null>(null)

  const byCell = new Map(
    product.variants.map((v) => [`${v.sizeId}:${v.colourId}`, v]),
  )
  const usedSizes = new Set(product.variants.map((v) => v.sizeId))
  const usedColours = new Set(product.variants.map((v) => v.colourId))

  const colourColumns = colours.filter((c) => usedColours.has(c.id))
  const sizeRows = sizes.filter((s) => usedSizes.has(s.id))

  const colourById = new Map(colours.map((c) => [c.id, c]))
  const sizeById = new Map(sizes.map((s) => [s.id, s]))

  if (product.variants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">No variants yet</p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          A product isn’t sellable until it has variants — those carry the SKU,
          barcode, price and stock. Use “Generate variants” to create every size
          and colour combination at once.
        </p>
      </div>
    )
  }

  // Split by size type so shoe sizes never share a table with age ranges.
  const groups = product.sizeTypesUsed.map((type) => ({
    type,
    rows: sizeRows.filter((s) => s.size_type === type),
  }))

  return (
    <>
      <div className="space-y-6">
        {groups.map((group) => (
          <MatrixTable
            key={group.type}
            type={group.type}
            showHeading={groups.length > 1}
            sizeRows={group.rows}
            colourColumns={colourColumns}
            byCell={byCell}
            onEdit={setEditing}
          />
        ))}

        <p className="text-muted-foreground text-xs">
          Quantities come from stock movements and can’t be typed here — use a
          stock adjustment to correct a count. Tap any cell to edit its prices,
          barcode or reorder level.
        </p>
      </div>

      {editing ? (
        <VariantDialog
          variant={editing}
          productId={product.id}
          productName={product.name}
          sizeLabel={sizeById.get(editing.sizeId)?.label ?? "—"}
          colour={colourById.get(editing.colourId) ?? null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}

function MatrixTable({
  type,
  showHeading,
  sizeRows,
  colourColumns,
  byCell,
  onEdit,
}: {
  type: SizeType
  showHeading: boolean
  sizeRows: Size[]
  colourColumns: Colour[]
  byCell: Map<string, VariantRow>
  onEdit: (variant: VariantRow) => void
}) {
  if (sizeRows.length === 0) return null

  return (
    <div className="space-y-2">
      {showHeading ? (
        <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {SIZE_TYPE_LABELS[type]}
        </h3>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50">
              {/* Sticky so the size stays visible when many colours force a
                  horizontal scroll on a tablet. */}
              <th className="bg-muted/50 sticky left-0 z-10 min-w-28 px-3 py-2 text-left font-medium">
                Size
              </th>
              {colourColumns.map((colour) => (
                <th key={colour.id} className="min-w-24 px-3 py-2 font-medium">
                  <span className="flex items-center justify-center gap-1.5">
                    <ColourSwatch hex={colour.hex_code} name={colour.name} />
                    <span className="truncate">{colour.name}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sizeRows.map((size) => (
              <tr key={size.id} className="border-t">
                <th
                  scope="row"
                  className="bg-background sticky left-0 z-10 border-r px-3 py-2 text-left font-medium"
                >
                  {size.label}
                </th>
                {colourColumns.map((colour) => (
                  <MatrixCell
                    key={colour.id}
                    variant={byCell.get(`${size.id}:${colour.id}`)}
                    onEdit={onEdit}
                    label={`${size.label} / ${colour.name}`}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MatrixCell({
  variant,
  onEdit,
  label,
}: {
  variant: VariantRow | undefined
  onEdit: (variant: VariantRow) => void
  label: string
}) {
  if (!variant) {
    return (
      <td className="text-muted-foreground/50 border-l px-3 py-2 text-center">—</td>
    )
  }

  // Shared with the products list so the two can never disagree about what
  // "low" means — see lib/products/stock.ts.
  const isOut = isOutOfStock(variant.qtyOnHand)
  const isLow = isLowStock(variant.qtyOnHand, variant.reorderLevel)

  return (
    <td className="border-l p-0">
      <button
        type="button"
        onClick={() => onEdit(variant)}
        aria-label={`Edit ${label}`}
        className={cn(
          "hover:bg-accent focus-visible:ring-ring flex h-full w-full flex-col items-center gap-0.5 px-3 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none",
          isOut && "bg-destructive/10",
          isLow && "bg-warning-muted",
          !variant.isActive && "opacity-50",
        )}
      >
        <span
          className={cn(
            "font-medium tabular-nums",
            isOut && "text-destructive",
            isLow && "text-warning-foreground",
          )}
        >
          {variant.qtyOnHand}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatRs(variant.sellingPrice)}
        </span>
      </button>
    </td>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Saving…
        </>
      ) : (
        "Save variant"
      )}
    </Button>
  )
}

function VariantForm({
  variant,
  productId,
  onSaved,
}: {
  variant: VariantRow
  productId: number
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(updateVariant, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  const err = state.fieldErrors

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="id" value={variant.id} />
      <input type="hidden" name="productId" value={productId} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="bg-muted/40 rounded-md px-3 py-2 text-xs">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">SKU</span>
          <span className="font-mono">{variant.sku}</span>
        </div>
        <div className="mt-1 flex justify-between gap-4">
          <span className="text-muted-foreground">In stock</span>
          <span className="font-medium tabular-nums">{variant.qtyOnHand}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="variant-cost">Cost price</Label>
          <Input
            id="variant-cost"
            name="costPrice"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            defaultValue={variant.costPrice}
            aria-invalid={Boolean(err.costPrice)}
            aria-describedby={err.costPrice ? "variant-cost-error" : undefined}
          />
          {err.costPrice ? (
            <p id="variant-cost-error" className="text-destructive text-sm">
              {err.costPrice}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="variant-price">Selling price</Label>
          <Input
            id="variant-price"
            name="sellingPrice"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            defaultValue={variant.sellingPrice}
            autoFocus
            aria-invalid={Boolean(err.sellingPrice)}
            aria-describedby={err.sellingPrice ? "variant-price-error" : undefined}
          />
          {err.sellingPrice ? (
            <p id="variant-price-error" className="text-destructive text-sm">
              {err.sellingPrice}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="variant-reorder">Reorder level</Label>
          <Input
            id="variant-reorder"
            name="reorderLevel"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            defaultValue={variant.reorderLevel}
            aria-invalid={Boolean(err.reorderLevel)}
            aria-describedby={err.reorderLevel ? "variant-reorder-error" : undefined}
          />
          {err.reorderLevel ? (
            <p id="variant-reorder-error" className="text-destructive text-sm">
              {err.reorderLevel}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="variant-barcode">Barcode</Label>
          <Input
            id="variant-barcode"
            name="barcode"
            defaultValue={variant.barcode ?? ""}
            placeholder="Scan or type"
            spellCheck={false}
            className="font-mono"
            aria-invalid={Boolean(err.barcode)}
            aria-describedby={err.barcode ? "variant-barcode-error" : undefined}
          />
          {err.barcode ? (
            <p id="variant-barcode-error" className="text-destructive text-sm">
              {err.barcode}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <Label htmlFor="variant-active">Active</Label>
        <Switch
          id="variant-active"
          name="isActive"
          value="true"
          defaultChecked={variant.isActive}
        />
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SaveButton />
      </DialogFooter>
    </form>
  )
}

function VariantDialog({
  variant,
  productId,
  productName,
  sizeLabel,
  colour,
  onClose,
}: {
  variant: VariantRow
  productId: number
  productName: string
  sizeLabel: string
  colour: Colour | null
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {colour ? <ColourSwatch hex={colour.hex_code} name={colour.name} /> : null}
            {sizeLabel} · {colour?.name ?? "—"}
          </DialogTitle>
          <DialogDescription>{productName}</DialogDescription>
        </DialogHeader>
        {/* Unmounts with the dialog, resetting the action state so a previous
            error is not still showing when it reopens. */}
        <VariantForm variant={variant} productId={productId} onSaved={onClose} />
      </DialogContent>
    </Dialog>
  )
}
