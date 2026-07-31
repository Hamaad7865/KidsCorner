"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, ArrowRight, LoaderCircle, Search } from "lucide-react"
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
import { IDLE_STATE } from "@/lib/forms"
import { searchVariants, transferStock, type VariantSearchResult } from "@/lib/stock/actions"

export type TransferLocation = { id: number; name: string; isDefault: boolean }

/**
 * Moves stock between locations.
 *
 * The shop-wide total does not change — this is a shelf move, not a stock
 * change — so it is deliberately separate from the adjustment dialog, which
 * does alter the count and demands a reason for it.
 */
export function TransferDialog({ locations }: { locations: TransferLocation[] }) {
  const [open, setOpen] = useState(false)
  const enabled = locations.length >= 2

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={!enabled}
        title={
          enabled
            ? undefined
            : "Add a second location in Settings before moving stock"
        }
      >
        <ArrowRight aria-hidden />
        Transfer
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Transfer stock</DialogTitle>
            <DialogDescription>
              Moves units between locations. The shop-wide count is unchanged —
              the goods haven&rsquo;t left the shop, only the shelf.
            </DialogDescription>
          </DialogHeader>
          {/* Unmounts on close, resetting search and action state. */}
          <TransferForm locations={locations} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Moving…
        </>
      ) : (
        "Move stock"
      )}
    </Button>
  )
}

function TransferForm({
  locations,
  onDone,
}: {
  locations: TransferLocation[]
  onDone: () => void
}) {
  const [state, formAction] = useActionState(transferStock, IDLE_STATE)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<VariantSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<VariantSearchResult | null>(null)

  const [from, setFrom] = useState(
    String(locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? ""),
  )
  // Defaults to a different location than `from`, so the form opens in a valid
  // state rather than one the server will immediately reject.
  const [to, setTo] = useState(
    String(locations.find((l) => String(l.id) !== from)?.id ?? ""),
  )

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onDone()
    }
  }, [state, onDone])

  useEffect(() => {
    if (chosen || query.trim().length < 2) return
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
  }, [query, chosen])

  const field = "border-input h-9 w-full rounded-lg border bg-transparent px-3 text-sm"

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {chosen ? <input type="hidden" name="variantId" value={chosen.id} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {chosen ? (
        <div className="flex items-start justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              <ColourSwatch hex={chosen.colourHex} name={chosen.colourName} />
              <span className="truncate">{chosen.productName}</span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {chosen.sizeLabel} · {chosen.colourName} ·{" "}
              <span className="font-mono">{chosen.sku}</span>
            </p>
            <p className="mt-1 text-sm">
              Shop-wide:{" "}
              <span className="font-medium tabular-nums">{chosen.qtyOnHand}</span>
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setChosen(null)
              setQuery("")
              setResults([])
            }}
          >
            Change
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="transfer-search">Find a variant</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="transfer-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Product name, SKU or barcode…"
              className="pl-8"
              autoFocus
              autoComplete="off"
            />
          </div>

          {searching ? (
            <p className="text-muted-foreground text-xs">Searching…</p>
          ) : null}

          {results.length > 0 ? (
            <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
              {results.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(row)}
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
                    <span className="tabular-nums">{row.qtyOnHand}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="transfer-from">From</Label>
          <select
            id="transfer-from"
            name="fromLocation"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className={field}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <ArrowRight
          className="text-muted-foreground mx-auto mb-2 size-4 shrink-0"
          aria-hidden
        />

        <div className="space-y-2">
          <Label htmlFor="transfer-to">To</Label>
          <select
            id="transfer-to"
            name="toLocation"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className={field}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          {state.fieldErrors.toLocation ? (
            <p className="text-destructive text-sm">{state.fieldErrors.toLocation}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="transfer-qty">Units to move</Label>
        <Input
          id="transfer-qty"
          name="qty"
          type="number"
          inputMode="numeric"
          step="1"
          min="1"
          defaultValue="1"
          className="w-32"
          aria-invalid={Boolean(state.fieldErrors.qty)}
        />
        {state.fieldErrors.qty ? (
          <p className="text-destructive text-sm">{state.fieldErrors.qty}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="transfer-notes">Note</Label>
        <Input
          id="transfer-notes"
          name="notes"
          placeholder="Optional — e.g. restocking the floor"
        />
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SubmitButton disabled={!chosen || from === to} />
      </DialogFooter>
    </form>
  )
}
