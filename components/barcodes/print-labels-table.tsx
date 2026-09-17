"use client"

import { Fragment, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Printer,
  RotateCcw,
  ScanBarcode,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { generateBarcodesForProduct } from "@/lib/barcodes/actions"
import {
  MAX_COPIES_PER_VARIANT,
  MAX_LABELS_PER_RUN,
} from "@/lib/barcodes/labels"
import type {
  PrintableProductRow,
  PrintableVariant,
} from "@/lib/barcodes/queries"
import { formatQty } from "@/lib/format"

/**
 * The label picker's table. Tick the products to print, expand a product to set
 * a per-variant quantity (defaulting to its stock at the location, restorable
 * with one click), then print everything selected in one roll job. Products with
 * a missing or invalid barcode can have one issued right here.
 *
 * The quantities are the browser's to edit, so the print is built here from the
 * exact counts on screen rather than re-derived from stock: what you see is what
 * spools.
 */
export function PrintLabelsTable({ rows }: { rows: PrintableProductRow[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  // Only variants the cashier actually changed live here; everything else falls
  // back to its stock, so a location switch (which remounts with fresh stock)
  // and an unedited variant always show the current default.
  const [edited, setEdited] = useState<Record<number, number>>({})
  const [generatingId, setGeneratingId] = useState<number | null>(null)

  const countFor = (variant: PrintableVariant) =>
    edited[variant.variantId] ?? variant.stock

  const selectableIds = useMemo(
    () => rows.filter((row) => row.variants.length > 0).map((row) => row.productId),
    [rows],
  )

  const totalLabels = useMemo(() => {
    let total = 0
    for (const row of rows) {
      if (!selected.has(row.productId)) continue
      for (const variant of row.variants) {
        total += edited[variant.variantId] ?? variant.stock
      }
    }
    return total
  }, [rows, selected, edited])

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  function toggleProduct(productId: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds))
  }

  function toggleExpand(productId: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function setCount(variantId: number, raw: string) {
    const n = Math.max(0, Math.min(MAX_COPIES_PER_VARIANT, Math.floor(Number(raw) || 0)))
    setEdited((prev) => ({ ...prev, [variantId]: n }))
  }

  function restore(variantId: number) {
    setEdited((prev) => {
      const next = { ...prev }
      delete next[variantId]
      return next
    })
  }

  function printSelected() {
    const pairs: string[] = []
    let anchor: number | null = null
    for (const row of rows) {
      if (!selected.has(row.productId)) continue
      for (const variant of row.variants) {
        const count = countFor(variant)
        if (count > 0) {
          pairs.push(`${variant.variantId}:${count}`)
          if (anchor === null) anchor = row.productId
        }
      }
    }
    if (pairs.length === 0 || anchor === null) {
      toast.error("Nothing to print — set a quantity above zero.")
      return
    }
    // The count string is only digits, colons and commas, all URL-safe unencoded.
    window.open(
      `/products/${anchor}/labels?label=40x30&copies=${pairs.join(",")}`,
      "_blank",
      "noopener",
    )
  }

  async function generate(productId: number) {
    setGeneratingId(productId)
    try {
      const result = await generateBarcodesForProduct(productId)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        toast.error(result.message)
      }
    } finally {
      setGeneratingId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium tabular-nums">
            {selected.size}
          </span>{" "}
          selected ·{" "}
          <span className="text-foreground font-medium tabular-nums">
            {formatQty(totalLabels)}
          </span>{" "}
          label{totalLabels === 1 ? "" : "s"} · 40×30mm roll
          {totalLabels > MAX_LABELS_PER_RUN ? (
            <span className="text-warning">
              {" "}
              — only the first {MAX_LABELS_PER_RUN} print in one run
            </span>
          ) : null}
        </p>
        <Button onClick={printSelected} disabled={totalLabels === 0}>
          <Printer aria-hidden />
          Print selected
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="accent-brand-600 size-4 align-middle"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all printable products"
                  disabled={selectableIds.length === 0}
                />
              </TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="w-40 font-mono">Barcode</TableHead>
              <TableHead className="w-24 text-right">In stock</TableHead>
              <TableHead className="w-28 text-right">Labels</TableHead>
              <TableHead className="w-32 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const selectable = row.variants.length > 0
              const isSelected = selected.has(row.productId)
              const isExpanded = expanded.has(row.productId)
              const productLabels = row.variants.reduce(
                (sum, variant) => sum + countFor(variant),
                0,
              )
              const totalCodes = row.variants.length + row.barcodelessCount

              return (
                <Fragment key={row.productId}>
                  <TableRow className={isSelected ? "bg-brand-50" : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="accent-brand-600 size-4 align-middle"
                        checked={isSelected}
                        onChange={() => toggleProduct(row.productId)}
                        disabled={!selectable}
                        aria-label={`Select ${row.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {selectable ? (
                          <button
                            type="button"
                            onClick={() => toggleExpand(row.productId)}
                            className="text-muted-foreground hover:text-foreground -ml-1 rounded p-0.5"
                            aria-label={
                              isExpanded ? "Hide variants" : "Show variants"
                            }
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-4" aria-hidden />
                            ) : (
                              <ChevronRight className="size-4" aria-hidden />
                            )}
                          </button>
                        ) : (
                          <span className="inline-block w-4" />
                        )}
                        <div>
                          <div className="font-medium">{row.name}</div>
                          {row.categoryName || row.brandName ? (
                            <div className="text-muted-foreground text-xs">
                              {[row.categoryName, row.brandName]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {totalCodes === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : row.barcodelessCount > 0 ? (
                        <span className="text-warning">
                          {row.variants.length}/{totalCodes}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {row.variants.length}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {selectable ? formatQty(row.unitsAtLocation) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {selectable ? formatQty(productLabels) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.barcodelessCount > 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => generate(row.productId)}
                          disabled={generatingId === row.productId}
                        >
                          {generatingId === row.productId ? (
                            <LoaderCircle className="animate-spin" aria-hidden />
                          ) : (
                            <ScanBarcode aria-hidden />
                          )}
                          Generate {row.barcodelessCount}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>

                  {isExpanded
                    ? row.variants.map((variant) => {
                        const count = countFor(variant)
                        const isEdited = edited[variant.variantId] !== undefined
                        return (
                          <TableRow
                            key={variant.variantId}
                            className="bg-muted/30"
                          >
                            <TableCell />
                            <TableCell className="pl-8">
                              {variant.colourName} · {variant.sizeLabel}
                            </TableCell>
                            <TableCell className="text-muted-foreground font-mono text-xs">
                              {variant.barcode}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatQty(variant.stock)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={0}
                                max={MAX_COPIES_PER_VARIANT}
                                value={count}
                                onChange={(e) =>
                                  setCount(variant.variantId, e.target.value)
                                }
                                className="ml-auto h-7 w-20 text-right tabular-nums"
                                aria-label={`Labels for ${variant.colourName} ${variant.sizeLabel}`}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => restore(variant.variantId)}
                                disabled={!isEdited}
                                aria-label="Restore to stock"
                                title="Restore to stock"
                              >
                                <RotateCcw aria-hidden />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    : null}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
