"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, Wand2 } from "lucide-react"
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
import { SIZE_TYPES, SIZE_TYPE_LABELS } from "@/lib/db-enums"
import { IDLE_STATE } from "@/lib/forms"
import type { Colour, Size } from "@/lib/master-data/queries"
import { generateVariants } from "@/lib/products/actions"
import type { ProductDetail } from "@/lib/products/queries"
import { cn } from "@/lib/utils"

/**
 * Ticks sizes and colours, creates every combination that doesn't already
 * exist, with auto SKUs. Combinations the product already has are counted and
 * reported rather than treated as errors — re-running this after adding one new
 * colour is the normal way to use it.
 *
 * Checkboxes are native `<input type="checkbox">` on purpose: several inputs
 * share a name and the server reads them with `formData.getAll`, which is
 * exactly what native multi-value serialisation gives.
 */
export function GenerateVariantsDialog({
  product,
  sizes,
  colours,
}: {
  product: ProductDetail
  sizes: Size[]
  colours: Colour[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Wand2 aria-hidden />
        Generate variants
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate variants</DialogTitle>
            <DialogDescription>
              Creates a variant for every size × colour you tick. SKUs are
              generated automatically and anything that already exists is left
              alone.
            </DialogDescription>
          </DialogHeader>
          {/* Unmounts with the dialog, resetting both the selection and the
              action state each time it is opened. */}
          <GenerateForm
            product={product}
            sizes={sizes}
            colours={colours}
            onDone={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Creating…
        </>
      ) : count === 0 ? (
        "Pick sizes and colours"
      ) : (
        `Create ${count} variant${count === 1 ? "" : "s"}`
      )}
    </Button>
  )
}

function GenerateForm({
  product,
  sizes,
  colours,
  onDone,
}: {
  product: ProductDetail
  sizes: Size[]
  colours: Colour[]
  onDone: () => void
}) {
  const [state, formAction] = useActionState(generateVariants, IDLE_STATE)
  const [sizeIds, setSizeIds] = useState<number[]>([])
  const [colourIds, setColourIds] = useState<number[]>([])

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onDone()
    }
  }, [state, onDone])

  const existing = useMemo(
    () => new Set(product.variants.map((v) => `${v.sizeId}:${v.colourId}`)),
    [product.variants],
  )

  // Count only what will actually be created, so the button never promises
  // more than the server will do.
  const toCreate = sizeIds.reduce(
    (total, sizeId) =>
      total +
      colourIds.filter((colourId) => !existing.has(`${sizeId}:${colourId}`)).length,
    0,
  )

  const activeSizes = sizes.filter((s) => s.is_active)
  const activeColours = colours.filter((c) => c.is_active)

  const toggle = (
    list: number[],
    setList: (next: number[]) => void,
    id: number,
  ) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="productId" value={product.id} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="max-h-64 space-y-4 overflow-y-auto pr-1">
        {SIZE_TYPES.map((type) => {
          const group = activeSizes.filter((s) => s.size_type === type)
          if (group.length === 0) return null
          const allPicked = group.every((s) => sizeIds.includes(s.id))

          return (
            <fieldset key={type} className="space-y-2">
              <div className="flex items-center justify-between">
                <legend className="text-sm font-medium">
                  {SIZE_TYPE_LABELS[type]}
                </legend>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSizeIds(
                      allPicked
                        ? sizeIds.filter((id) => !group.some((s) => s.id === id))
                        : [
                            ...sizeIds,
                            ...group
                              .map((s) => s.id)
                              .filter((id) => !sizeIds.includes(id)),
                          ],
                    )
                  }
                >
                  {allPicked ? "Clear" : "Select all"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.map((size) => (
                  <Chip
                    key={size.id}
                    name="sizeIds"
                    value={size.id}
                    checked={sizeIds.includes(size.id)}
                    onChange={() => toggle(sizeIds, setSizeIds, size.id)}
                  >
                    {size.label}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )
        })}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Colours</legend>
          <div className="flex flex-wrap gap-2">
            {activeColours.map((colour) => (
              <Chip
                key={colour.id}
                name="colourIds"
                value={colour.id}
                checked={colourIds.includes(colour.id)}
                onChange={() => toggle(colourIds, setColourIds, colour.id)}
              >
                <ColourSwatch hex={colour.hex_code} />
                {colour.name}
              </Chip>
            ))}
          </div>
        </fieldset>
      </div>

      {state.fieldErrors.sizeIds || state.fieldErrors.colourIds ? (
        <p className="text-destructive text-sm">
          {state.fieldErrors.sizeIds ?? state.fieldErrors.colourIds}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="gen-cost">Cost price</Label>
          <Input
            id="gen-cost"
            name="costPrice"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            defaultValue="0"
            aria-invalid={Boolean(state.fieldErrors.costPrice)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="gen-price">Selling price</Label>
          <Input
            id="gen-price"
            name="sellingPrice"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            defaultValue="0"
            aria-invalid={Boolean(state.fieldErrors.sellingPrice)}
          />
          {state.fieldErrors.sellingPrice ? (
            <p className="text-destructive text-sm">
              {state.fieldErrors.sellingPrice}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="gen-reorder">Reorder level</Label>
          <Input
            id="gen-reorder"
            name="reorderLevel"
            type="number"
            inputMode="numeric"
            step="1"
            min="0"
            defaultValue="0"
          />
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Prices apply to every variant created now; adjust individual ones in the
        matrix afterwards. Stock starts at zero — receive a purchase or make a
        stock adjustment to add quantities.
      </p>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SubmitButton count={toCreate} />
      </DialogFooter>
    </form>
  )
}

function Chip({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string
  value: number
  checked: boolean
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors select-none",
        "focus-within:ring-ring focus-within:ring-2",
        checked
          ? "border-brand-600 bg-brand-50 text-brand-800"
          : "hover:bg-muted border-input",
      )}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {children}
    </label>
  )
}
