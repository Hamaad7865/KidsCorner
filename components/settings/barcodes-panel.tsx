"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, ScanBarcode } from "lucide-react"
import { toast } from "sonner"

import { Barcode } from "@/components/barcodes/barcode"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { saveBarcodeSettings } from "@/lib/barcodes/actions"
import {
  buildEan13,
  maxSerialFor,
  prefixProblem,
  serialWidthFor,
} from "@/lib/barcodes/ean13"
import type { BarcodeSettings } from "@/lib/barcodes/settings"
import { formatRs } from "@/lib/format"
import { IDLE_STATE } from "@/lib/forms"

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
        "Save barcode scheme"
      )}
    </Button>
  )
}

/**
 * The shop's own barcode numbering, plus a live preview of the next label.
 *
 * The preview is built with the same `buildEan13` the server allocates with, so
 * what is drawn here is exactly what will be printed — including the check
 * digit, which is the part people most expect to have to work out themselves.
 */
export function BarcodesPanel({
  settings,
  missingCount,
  canManage,
}: {
  settings: BarcodeSettings
  /** Variants across the catalogue with no barcode at all. */
  missingCount: number
  canManage: boolean
}) {
  const [state, formAction] = useActionState(saveBarcodeSettings, IDLE_STATE)

  const [prefix, setPrefix] = useState(settings.prefix)
  const [next, setNext] = useState(String(settings.next))

  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message)
  }, [state])

  const problem = prefixProblem(prefix)
  // An empty box is not zero. `Number("")` is 0, which would draw a confident
  // preview of serial 0 under a field that looks blank — and then fail on save.
  const serial = next.trim() === "" ? NaN : Number(next)
  const serialProblem = !Number.isInteger(serial)
    ? "Enter the next number to use."
    : serial < 0
      ? "The next number cannot be negative."
      : !problem && serial > maxSerialFor(prefix)
        ? `That prefix only leaves room up to ${maxSerialFor(prefix).toLocaleString("en-GB")}.`
        : null
  const serialOk = serialProblem === null && !problem

  let preview: string | null = null
  if (!problem && serialOk) {
    try {
      preview = buildEan13(prefix, serial)
    } catch {
      preview = null
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-base font-medium">Barcodes</h2>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Every new variant can get a barcode on its own, so you never have to
            think one up. Supplier barcodes are kept exactly as they come — this
            only fills the blanks.
            {canManage ? "" : " Only the owner can change this."}
          </p>
        </div>
        {missingCount > 0 ? (
          <span className="bg-warning-muted text-warning-foreground rounded-full px-3 py-1 text-xs font-medium">
            {missingCount} variant{missingCount === 1 ? "" : "s"} without one
          </span>
        ) : null}
      </div>

      <form action={formAction} className="space-y-4 rounded-lg border p-4" noValidate>
        {state.error ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="bg-accent/60 flex items-start gap-3 rounded-lg border p-3">
          <Switch
            id="barcode-auto"
            name="auto"
            defaultChecked={settings.auto}
            disabled={!canManage}
          />
          <div className="space-y-0.5">
            <Label htmlFor="barcode-auto" className="font-medium">
              Generate a barcode automatically
            </Label>
            <p className="text-muted-foreground text-sm">
              Applies when variants are generated on a product and on Excel
              import when the Barcode column is blank.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="barcode-format">Format</Label>
            {/* Not a dropdown: EAN-13 is the only symbology implemented, and a
                menu with one option invites the question of what else there is. */}
            <div className="border-input bg-muted/50 text-muted-foreground flex h-9 items-center rounded-lg border px-3 text-sm">
              EAN-13
            </div>
            <p className="text-muted-foreground text-xs">
              13 digits, scannable by any till reader.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="barcode-prefix">Shop prefix</Label>
            <Input
              id="barcode-prefix"
              name="prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              disabled={!canManage}
              className="font-mono"
              aria-invalid={Boolean(problem ?? state.fieldErrors.prefix)}
            />
            {problem ?? state.fieldErrors.prefix ? (
              <p className="text-destructive text-sm">
                {problem ?? state.fieldErrors.prefix}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Leaves {serialWidthFor(prefix)} digits for the serial — up to{" "}
                {maxSerialFor(prefix).toLocaleString("en-GB")} codes.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="barcode-next">Next number</Label>
            <Input
              id="barcode-next"
              name="next"
              value={next}
              onChange={(e) => setNext(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              disabled={!canManage}
              className="font-mono"
              aria-invalid={Boolean(serialProblem ?? state.fieldErrors.next)}
            />
            {(serialProblem ?? state.fieldErrors.next) ? (
              <p className="text-destructive text-sm">
                {serialProblem ?? state.fieldErrors.next}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                The check digit is worked out for you.
              </p>
            )}
          </div>
        </div>

        <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Next label preview
            </div>
            <p className="text-muted-foreground max-w-sm text-xs">
              Codes starting {prefix || "…"} are for in-store use only. They are
              valid EAN-13, but the prefix is not a registered company prefix —
              keep supplier barcodes as they come.
            </p>
          </div>

          {preview ? (
            <div className="flex w-52 flex-col items-center gap-1.5 rounded-lg border bg-white p-3 shadow-sm">
              <div className="text-center text-[11px] leading-tight font-semibold text-black">
                Cotton tee, short sleeve
                <span className="block font-normal text-neutral-500">
                  Navy · 4–5 yrs
                </span>
              </div>
              <Barcode code={preview} height={36} className="w-full" />
              <div className="text-[13px] font-bold text-black">
                {formatRs(395)}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground flex w-52 flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center text-xs">
              <ScanBarcode className="size-5" aria-hidden />
              Fix the prefix or number to see the label.
            </div>
          )}
        </div>

        {canManage ? (
          <div className="flex justify-end">
            <SaveButton />
          </div>
        ) : null}
      </form>
    </section>
  )
}
