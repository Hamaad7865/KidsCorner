"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, Search, SlidersHorizontal } from "lucide-react"
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
import {
  recordAdjustment,
  searchVariants,
  type VariantSearchResult,
} from "@/lib/stock/actions"
import { cn } from "@/lib/utils"

/**
 * Manual stock adjustment. The spec requires a reason, and the user enters what
 * they *counted* rather than a delta — the difference is worked out server-side
 * against the current quantity, so two simultaneous corrections can't overwrite
 * each other with the same absolute figure.
 *
 * @param defaultOpen Open on arrival. Set by `/stock?new=adjustment`, which is
 *   where the dashboard's "Adjust stock" goes — asking for the form should
 *   produce the form, not the ledger with the form somewhere on it.
 */
export function AdjustmentDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const router = useRouter()

  /**
   * Closing takes `?new=adjustment` off the URL.
   *
   * Without this the parameter outlives the dialog, and a refresh — or a
   * bookmark, or the back button — reopens a form the shopkeeper has already
   * dismissed once. `replace` rather than `push` so closing a dialog does not
   * become a history entry to click back through.
   */
  const change = (next: boolean) => {
    setOpen(next)
    if (!next && defaultOpen) router.replace("/stock")
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden />
        Adjust stock
      </Button>

      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>
              Records a movement of type “adjustment”. The count itself is never
              edited directly — the ledger stays the source of truth.
            </DialogDescription>
          </DialogHeader>
          {/* Unmounts on close, resetting the search and the action state. */}
          <AdjustmentForm onDone={() => change(false)} />
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
          Recording…
        </>
      ) : (
        "Record adjustment"
      )}
    </Button>
  )
}

function AdjustmentForm({ onDone }: { onDone: () => void }) {
  const [state, formAction] = useActionState(recordAdjustment, IDLE_STATE)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<VariantSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [chosen, setChosen] = useState<VariantSearchResult | null>(null)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onDone()
    }
  }, [state, onDone])

  // Debounced so typing a product name doesn't fire a query per keystroke.
  useEffect(() => {
    if (chosen || query.trim().length < 2) return
    let cancelled = false
    // setSearching lives inside the timer, not the effect body: calling it
    // synchronously here would cascade a render, and it also means the spinner
    // never flashes during the debounce window.
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
              System count:{" "}
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
          <Label htmlFor="variant-search">Find a variant</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="variant-search"
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
            <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
              {results.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(row)}
                    className={cn(
                      "hover:bg-accent flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                    )}
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
          ) : query.trim().length >= 2 && !searching ? (
            <p className="text-muted-foreground text-xs">
              Nothing matched “{query}”.
            </p>
          ) : null}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="counted-qty">Counted quantity</Label>
        <Input
          id="counted-qty"
          name="countedQty"
          type="number"
          inputMode="numeric"
          step="1"
          min="0"
          defaultValue={chosen?.qtyOnHand ?? 0}
          key={chosen?.id ?? "none"}
          className="w-40"
          aria-invalid={Boolean(state.fieldErrors.countedQty)}
        />
        {state.fieldErrors.countedQty ? (
          <p className="text-destructive text-sm">{state.fieldErrors.countedQty}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Enter what is physically on the shelf. The difference is recorded, not
          the total.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="adjust-reason">Reason</Label>
        <Input
          id="adjust-reason"
          name="reason"
          placeholder="e.g. Stock take, damaged item, miscount"
          aria-invalid={Boolean(state.fieldErrors.reason)}
        />
        {state.fieldErrors.reason ? (
          <p className="text-destructive text-sm">{state.fieldErrors.reason}</p>
        ) : null}
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SubmitButton disabled={!chosen} />
      </DialogFooter>
    </form>
  )
}
