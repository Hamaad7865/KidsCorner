"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ColourSwatch } from "@/components/settings/colour-swatch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRs, round2, shopToday } from "@/lib/format"
import { IDLE_STATE } from "@/lib/forms"
import { savePurchase } from "@/lib/purchases/actions"
import type { PurchaseDetail, Supplier } from "@/lib/purchases/queries"
import { searchVariants, type VariantSearchResult } from "@/lib/stock/actions"

/**
 * `qty` and `unitCost` are held as the raw input strings, not numbers.
 *
 * A controlled numeric input that round-trips through `Number()` cannot be
 * typed into: `Number("0.")` is `0`, so the decimal point is erased the moment
 * it is entered and "12.50" is impossible. Likewise clearing the field to
 * retype it would snap back to a number. The strings are parsed once, at
 * serialisation, and the server validates them again.
 */
type Line = {
  variantId: number
  qty: string
  unitCost: string
  productName: string
  sizeLabel: string
  colourName: string
  colourHex: string | null
  sku: string
}

function toNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toQty(value: string): number {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function SaveButton({ isNew, disabled }: { isNew: boolean; disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Saving…
        </>
      ) : isNew ? (
        "Save as draft"
      ) : (
        "Save changes"
      )}
    </Button>
  )
}

/**
 * Draft purchase editor. Saving never touches stock — that only happens when
 * `receive_purchase` runs from the detail page.
 *
 * Lines are held in client state and submitted as JSON in a hidden field: a
 * variable-length list of objects doesn't map onto flat form fields, and the
 * server re-validates every line anyway.
 */
export function PurchaseEditor({
  purchase,
  suppliers,
  preselectedSupplierId,
}: {
  purchase: PurchaseDetail | null
  suppliers: Supplier[]
  /**
   * Who the purchase is for, when the shop said so on the way in.
   *
   * The Suppliers page has always linked `/purchases/new?supplier=N` beside
   * each row. Nothing read the parameter, so "New purchase" next to a named
   * supplier opened a form saying "Choose a supplier" — the one question it
   * had just been told the answer to. The page resolves it and only passes an
   * id that is really selectable.
   */
  preselectedSupplierId?: number
}) {
  const [state, formAction] = useActionState(savePurchase, IDLE_STATE)
  const isNew = purchase === null

  const [supplierId, setSupplierId] = useState(
    purchase
      ? String(purchase.supplierId)
      : preselectedSupplierId
        ? String(preselectedSupplierId)
        : "",
  )
  const [lines, setLines] = useState<Line[]>(
    purchase?.lines.map((l) => ({
      variantId: l.variantId,
      qty: String(l.qty),
      unitCost: String(l.unitCost),
      productName: l.productName,
      sizeLabel: l.sizeLabel,
      colourName: l.colourName,
      colourHex: l.colourHex,
      sku: l.sku,
    })) ?? [],
  )

  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message)
  }, [state])

  const supplierOptions = suppliers
    .filter((s) => s.is_active || s.id === purchase?.supplierId)
    .map((s) => ({ value: String(s.id), label: s.name }))

  const total = round2(
    lines.reduce((sum, l) => sum + toQty(l.qty) * toNumber(l.unitCost), 0),
  )

  const addLine = (variant: VariantSearchResult) => {
    setLines((current) => {
      const existing = current.findIndex((l) => l.variantId === variant.id)
      if (existing >= 0) {
        // Adding the same variant twice bumps the quantity instead of creating
        // a second line the server would only merge anyway.
        const next = [...current]
        next[existing] = {
          ...next[existing],
          qty: String(toQty(next[existing].qty) + 1),
        }
        return next
      }
      return [
        ...current,
        {
          variantId: variant.id,
          qty: "1",
          unitCost: "0",
          productName: variant.productName,
          sizeLabel: variant.sizeLabel,
          colourName: variant.colourName,
          colourHex: variant.colourHex,
          sku: variant.sku,
        },
      ]
    })
  }

  const updateLine = (variantId: number, patch: Partial<Line>) => {
    setLines((current) =>
      current.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)),
    )
  }

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {purchase ? <input type="hidden" name="id" value={purchase.id} /> : null}
      <input
        type="hidden"
        name="lines"
        value={JSON.stringify(
          lines.map((l) => ({
            variantId: l.variantId,
            qty: toQty(l.qty),
            unitCost: toNumber(l.unitCost),
          })),
        )}
      />

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="purchase-supplier">Supplier</Label>
          <Select
            name="supplierId"
            value={supplierId}
            items={supplierOptions}
            onValueChange={(value) => setSupplierId(String(value ?? ""))}
          >
            <SelectTrigger
              id="purchase-supplier"
              className="w-full"
              aria-invalid={Boolean(state.fieldErrors.supplierId)}
            >
              <SelectValue placeholder="Choose a supplier" />
            </SelectTrigger>
            <SelectContent>
              {supplierOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {state.fieldErrors.supplierId ? (
            <p className="text-destructive text-sm">{state.fieldErrors.supplierId}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="purchase-invoice">Invoice number</Label>
          <Input
            id="purchase-invoice"
            name="invoiceNo"
            defaultValue={purchase?.invoiceNo ?? ""}
            placeholder="Optional"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="purchase-date">Purchase date</Label>
          <Input
            id="purchase-date"
            name="purchaseDate"
            type="date"
            defaultValue={purchase?.purchaseDate ?? shopToday()}
            aria-invalid={Boolean(state.fieldErrors.purchaseDate)}
          />
          {state.fieldErrors.purchaseDate ? (
            <p className="text-destructive text-sm">
              {state.fieldErrors.purchaseDate}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="purchase-expected">Expected</Label>
          {/* Left blank unless the supplier has actually given a date. A
              default of "today" would read as a commitment nobody made. */}
          <Input
            id="purchase-expected"
            name="expectedDate"
            type="date"
            defaultValue={purchase?.expectedDate ?? ""}
            aria-invalid={Boolean(state.fieldErrors.expectedDate)}
          />
          {state.fieldErrors.expectedDate ? (
            <p className="text-destructive text-sm">
              {state.fieldErrors.expectedDate}
            </p>
          ) : null}
        </div>
      </div>

      <LineAdder onAdd={addLine} />

      {state.fieldErrors.lines ? (
        <p className="text-destructive text-sm">{state.fieldErrors.lines}</p>
      ) : null}

      {lines.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No lines yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Search for a variant above to add it. Quantities only reach stock
            once you receive the purchase.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead className="w-28">Qty</TableHead>
                <TableHead className="w-36">Unit cost</TableHead>
                <TableHead className="w-32 text-right">Line total</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.variantId}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ColourSwatch hex={line.colourHex} name={line.colourName} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {line.productName}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {line.sizeLabel} · {line.colourName}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={line.qty}
                      onChange={(event) =>
                        updateLine(line.variantId, { qty: event.target.value })
                      }
                      className="w-24"
                      aria-invalid={toQty(line.qty) === 0}
                      aria-label={`Quantity for ${line.productName}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={line.unitCost}
                      onChange={(event) =>
                        updateLine(line.variantId, { unitCost: event.target.value })
                      }
                      className="w-32"
                      aria-label={`Unit cost for ${line.productName}`}
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRs(toQty(line.qty) * toNumber(line.unitCost))}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setLines((current) =>
                          current.filter((l) => l.variantId !== line.variantId),
                        )
                      }
                      aria-label={`Remove ${line.productName}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="purchase-notes">Notes</Label>
        <textarea
          id="purchase-notes"
          name="notes"
          rows={2}
          defaultValue={purchase?.notes ?? ""}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="text-sm">
          <span className="text-muted-foreground">Total </span>
          <span className="text-lg font-semibold tabular-nums">
            {formatRs(total)}
          </span>
        </div>
        {/* A blank or zero quantity would be rejected by the schema anyway
            (purchase_items has CHECK qty > 0), so block it here instead. */}
        <SaveButton
          isNew={isNew}
          disabled={lines.length === 0 || lines.some((l) => toQty(l.qty) === 0)}
        />
      </div>
    </form>
  )
}

function LineAdder({ onAdd }: { onAdd: (variant: VariantSearchResult) => void }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<VariantSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      setSearching(true)
      searchVariants(query).then((rows) => {
        if (cancelled) return
        setResults(rows)
        setSearching(false)
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  return (
    <div className="space-y-2">
      <Label htmlFor="line-search">Add a variant</Label>
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          id="line-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Product name, SKU or barcode…"
          className="pl-8"
          autoComplete="off"
        />
      </div>

      {searching ? <p className="text-muted-foreground text-xs">Searching…</p> : null}

      {results.length > 0 ? (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
          {results.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => {
                  onAdd(row)
                  setQuery("")
                  setResults([])
                }}
                className="hover:bg-accent flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ColourSwatch hex={row.colourHex} name={row.colourName} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {row.productName}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {row.sizeLabel} · {row.colourName}
                    </span>
                  </span>
                </span>
                <Plus className="size-4 shrink-0" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
