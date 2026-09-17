"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { LoaderCircle, Printer, ScanBarcode } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { batchLabelHref, generateBarcodesForProduct } from "@/lib/barcodes/actions"
import { MAX_LABELS_PER_RUN } from "@/lib/barcodes/labels"
import type { PrintableProductRow } from "@/lib/barcodes/queries"
import { formatQty } from "@/lib/format"

/**
 * The label picker's table: tick the products to print, print them all in one
 * roll job, and issue barcodes to any product that has none without leaving the
 * page.
 *
 * Selection and print counts live here (client state), but the number of labels
 * a print will actually produce is re-derived on the server from stock at print
 * time — this table's totals are a preview, not the authority.
 */
export function PrintLabelsTable({
  rows,
  locationId,
}: {
  rows: PrintableProductRow[]
  locationId: number | undefined
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [printing, setPrinting] = useState(false)
  const [generatingId, setGeneratingId] = useState<number | null>(null)

  // Only products with a barcode can be printed; the rest offer Generate first.
  const selectableIds = useMemo(
    () => rows.filter((row) => row.barcodedVariantIds.length > 0).map((row) => row.productId),
    [rows],
  )

  const totalLabels = useMemo(
    () =>
      rows.reduce(
        (sum, row) => (selected.has(row.productId) ? sum + row.unitsAtLocation : sum),
        0,
      ),
    [rows, selected],
  )

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  function toggle(productId: number) {
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

  async function printSelected() {
    if (!locationId) {
      toast.error("Pick a location first.")
      return
    }
    setPrinting(true)
    try {
      const result = await batchLabelHref([...selected], locationId)
      if (result.href) window.open(result.href, "_blank", "noopener")
      else toast.error(result.message ?? "Nothing to print.")
    } finally {
      setPrinting(false)
    }
  }

  async function generate(productId: number) {
    setGeneratingId(productId)
    try {
      const result = await generateBarcodesForProduct(productId)
      if (result.ok) {
        toast.success(result.message)
        // Re-fetch the server component so the new barcodes (and the row's
        // now-printable state) show without a manual reload.
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
        <Button onClick={printSelected} disabled={printing || totalLabels === 0}>
          {printing ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <Printer aria-hidden />
          )}
          Print selected
        </Button>
      </div>

      <div className="max-h-[32rem] overflow-y-auto rounded-lg border">
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
              <TableHead className="w-36">Category</TableHead>
              <TableHead className="w-28 text-right">Barcodes</TableHead>
              <TableHead className="w-24 text-right">Labels</TableHead>
              <TableHead className="w-40 text-right">
                <span className="sr-only">Generate</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const total =
                row.barcodedVariantIds.length + row.barcodelessVariantIds.length
              const selectable = row.barcodedVariantIds.length > 0
              const isSelected = selected.has(row.productId)
              const missing = row.barcodelessVariantIds.length

              return (
                <TableRow
                  key={row.productId}
                  className={isSelected ? "bg-brand-50" : undefined}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      className="accent-brand-600 size-4 align-middle"
                      checked={isSelected}
                      onChange={() => toggle(row.productId)}
                      disabled={!selectable}
                      aria-label={`Select ${row.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{row.name}</div>
                    {row.brandName ? (
                      <div className="text-muted-foreground text-xs">
                        {row.brandName}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.categoryName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {total === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : missing > 0 ? (
                      <span className="text-warning">
                        {row.barcodedVariantIds.length}/{total}
                      </span>
                    ) : (
                      <span>{total}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {selectable ? formatQty(row.unitsAtLocation) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {missing > 0 ? (
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
                        Generate {missing}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
