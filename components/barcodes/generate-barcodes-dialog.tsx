"use client"

import { useActionState, useCallback, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, ScanBarcode } from "lucide-react"
import { toast } from "sonner"

import { ColourSwatch } from "@/components/settings/colour-swatch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { generateBarcodes } from "@/lib/barcodes/actions"
import { buildEan13 } from "@/lib/barcodes/ean13"
import type { BarcodelessVariant } from "@/lib/barcodes/queries"
import type { BarcodeSettings } from "@/lib/barcodes/settings"
import { formatRs } from "@/lib/format"
import { IDLE_STATE } from "@/lib/forms"

/**
 * Issues barcodes to the variants of one product that have none.
 *
 * The codes listed are a *preview*: the real serials are reserved atomically by
 * the server at submit time, so if somebody else generates codes first these
 * shift by however many were taken. Labelled as "will get" rather than shown as
 * final, because a shopkeeper who wrote one down would otherwise be misled.
 */
export function GenerateBarcodesDialog({
  productId,
  variants,
  settings,
}: {
  productId: number
  variants: BarcodelessVariant[]
  settings: BarcodeSettings
}) {
  const [open, setOpen] = useState(false)

  // Stable identity: GenerateForm runs this from an effect keyed on the action
  // state, and a fresh closure each render would re-fire that effect while the
  // state is still "success" — toasting the same result twice.
  const close = useCallback(() => setOpen(false), [])

  // Nothing to offer when every variant already scans.
  if (variants.length === 0) return null

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ScanBarcode aria-hidden />
        {variants.length} without a barcode
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Generate barcodes</DialogTitle>
            <DialogDescription>
              {variants.length} variant
              {variants.length === 1 ? " has" : "s have"} no barcode yet. The
              check digit is worked out for you.
            </DialogDescription>
          </DialogHeader>
          {/* Unmounts with the dialog, so the action state resets each time it
              is opened rather than showing the previous run's error. */}
          <GenerateForm
            productId={productId}
            variants={variants}
            settings={settings}
            onDone={close}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function ConfirmButton({ count }: { count: number }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Generating…
        </>
      ) : (
        `Generate ${count} barcode${count === 1 ? "" : "s"}`
      )}
    </Button>
  )
}

function GenerateForm({
  productId,
  variants,
  settings,
  onDone,
}: {
  productId: number
  variants: BarcodelessVariant[]
  settings: BarcodeSettings
  onDone: () => void
}) {
  const [state, formAction] = useActionState(generateBarcodes, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onDone()
    }
  }, [state, onDone])

  const previews = variants.map((_variant, i) => {
    try {
      return buildEan13(settings.prefix, settings.next + i)
    } catch {
      // The serial has outgrown the prefix. The server refuses too, so this
      // just leaves the preview column blank rather than inventing a code.
      return null
    }
  })

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="productId" value={productId} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="bg-muted/40 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border px-4 py-2.5 text-sm">
        <div>
          <span className="text-muted-foreground block text-xs">Format</span>
          <span className="font-medium">EAN-13</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">Shop prefix</span>
          <span className="font-mono font-medium">{settings.prefix}</span>
        </div>
        <div>
          <span className="text-muted-foreground block text-xs">From number</span>
          <span className="font-mono font-medium">{settings.next}</span>
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Variant</th>
              <th className="px-3 py-2 text-left font-medium">Will get</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant, i) => (
              <tr key={variant.id} className="border-t">
                <td className="px-3 py-2">
                  <input type="hidden" name="variantIds" value={variant.id} />
                  <span className="flex items-center gap-2">
                    <ColourSwatch
                      hex={variant.colourHex}
                      name={variant.colourName}
                    />
                    <span className="font-medium">{variant.colourName}</span>
                    <span className="text-muted-foreground">
                      {variant.sizeLabel}
                    </span>
                  </span>
                </td>
                <td className="text-muted-foreground px-3 py-2 font-mono text-xs">
                  {previews[i] ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatRs(variant.sellingPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground text-xs">
        Print the labels from the product page once these are issued.
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <ConfirmButton count={variants.length} />
      </DialogFooter>
    </form>
  )
}
