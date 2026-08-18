"use client"

import { useActionState, useEffect, useRef } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IDLE_STATE } from "@/lib/forms"
import { saveVatPolicy } from "@/lib/settings/vat-actions"
import type { VatPolicy } from "@/lib/vat/policy"

function percent(rate: number): string {
  return `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`
}

/** Submit button for the non-toggling "save details" action. */
function SaveButton({ onArm }: { onArm: () => void }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" disabled={pending} onClick={onArm}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Saving…
        </>
      ) : (
        "Save details"
      )}
    </Button>
  )
}

/**
 * The confirm button inside a toggle dialog. It arms the shared intent field
 * and asks the enclosing form to submit; `useFormStatus` shows pending state
 * and blocks a second click.
 */
function ConfirmButton({
  label,
  pendingLabel,
  variant,
  onConfirm,
}: {
  label: string
  pendingLabel: string
  variant?: "default" | "destructive"
  onConfirm: () => void
}) {
  const { pending } = useFormStatus()
  return (
    <AlertDialogAction variant={variant} disabled={pending} onClick={onConfirm}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        label
      )}
    </AlertDialogAction>
  )
}

export function VatSettings({
  policy,
  canManage,
}: {
  policy: VatPolicy
  canManage: boolean
}) {
  const [state, formAction] = useActionState(saveVatPolicy, IDLE_STATE)
  const formRef = useRef<HTMLFormElement>(null)
  const intentRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message)
  }, [state])

  // Set the intent synchronously on the hidden field, then let the form submit
  // — a React state update would not have landed by the time the native submit
  // reads the field.
  function submitWith(intent: "save" | "enable" | "disable") {
    if (intentRef.current) intentRef.current.value = intent
    formRef.current?.requestSubmit()
  }

  const statusText = policy.enabled
    ? `VAT active · ${percent(policy.effectiveRate)}`
    : "VAT disabled"

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-base font-medium">VAT registration</h2>
          <Badge variant={policy.enabled ? "default" : "secondary"}>{statusText}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {policy.enabled
            ? "New sales are VAT invoices showing the rate and registration number below. Turning VAT off never changes past sales."
            : `Not VAT registered. New sales record no VAT. Rate saved at ${percent(policy.configuredRate)} for when the shop registers.`}
          {canManage ? "" : " Only the owner can change this."}
        </p>
      </div>

      {/* A polite live region so the change is announced to assistive tech, not
          only shown as a toast. */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.status === "success" && state.message ? state.message : ""}
      </p>

      <form
        ref={formRef}
        action={formAction}
        className="space-y-4 rounded-lg border p-4"
        noValidate
      >
        <input ref={intentRef} type="hidden" name="intent" defaultValue="save" />

        {state.error ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="vat-rate-percent">VAT rate (%)</Label>
            <Input
              id="vat-rate-percent"
              name="ratePercent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue={(policy.configuredRate * 100).toFixed(2).replace(/\.00$/, "")}
              disabled={!canManage}
              className="w-32"
              aria-invalid={Boolean(state.fieldErrors.ratePercent)}
            />
            {state.fieldErrors.ratePercent ? (
              <p className="text-destructive text-sm">{state.fieldErrors.ratePercent}</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              Prices are VAT-<strong>inclusive</strong>: this is the portion
              extracted from a total, not added to it.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="vat-number">VAT number</Label>
            <Input
              id="vat-number"
              name="vatNumber"
              defaultValue={policy.vatNumber ?? ""}
              placeholder="VAT20123456"
              disabled={!canManage}
              aria-invalid={Boolean(state.fieldErrors.vatNumber)}
            />
            {state.fieldErrors.vatNumber ? (
              <p className="text-destructive text-sm">{state.fieldErrors.vatNumber}</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              {policy.enabled
                ? "Printed on every VAT invoice."
                : "Prepare it in advance; it is required to register."}
            </p>
          </div>
        </div>

        {canManage ? (
          <div className="flex flex-wrap justify-end gap-2">
            <SaveButton onArm={() => submitWith("save")} />

            {policy.enabled ? (
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="destructive" />}>
                  Disable VAT
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disable VAT?</AlertDialogTitle>
                    <AlertDialogDescription>
                      New sales, receipts, returns, purchases and reports will
                      contain no VAT from now on. Every VAT invoice already
                      issued keeps its frozen VAT number and breakdown — history
                      does not change. The rate and number stay saved for later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep VAT on</AlertDialogCancel>
                    <ConfirmButton
                      label="Disable VAT"
                      pendingLabel="Disabling…"
                      variant="destructive"
                      onConfirm={() => submitWith("disable")}
                    />
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger render={<Button />}>Enable VAT</AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Enable VAT?</AlertDialogTitle>
                    <AlertDialogDescription>
                      New sales, receipts, returns, purchases and reports will
                      use VAT from activation onward. Existing sales are
                      unchanged. A VAT number is required — the rate and number
                      above are saved as part of turning VAT on.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Not yet</AlertDialogCancel>
                    <ConfirmButton
                      label="Enable VAT"
                      pendingLabel="Enabling…"
                      onConfirm={() => submitWith("enable")}
                    />
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        ) : null}
      </form>
    </section>
  )
}
