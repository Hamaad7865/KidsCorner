"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, Wallet } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IDLE_STATE } from "@/lib/forms"
import { openShift } from "@/lib/pos/actions"

function OpenButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="h-14 w-full text-base" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Opening…
        </>
      ) : (
        "Open the till"
      )}
    </Button>
  )
}

/** The spec makes a shift mandatory before selling — no shift, no sell screen. */
export function ShiftOpenForm({ cashierName }: { cashierName: string }) {
  const [state, formAction] = useActionState(openShift, IDLE_STATE)

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="bg-brand-50 text-brand-700 mx-auto flex size-16 items-center justify-center rounded-full">
            <Wallet className="size-8" aria-hidden />
          </div>
          <h1 className="font-heading mt-4 text-2xl font-semibold">
            Open the till
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Signed in as {cashierName}. Count the float in the drawer before you
            start — it is what the close-of-day variance is measured against.
          </p>
        </div>

        <form action={formAction} className="space-y-4" noValidate>
          {state.error ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="opening-float">Opening float (Rs)</Label>
            <Input
              id="opening-float"
              name="openingFloat"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              defaultValue="0"
              autoFocus
              className="h-control text-lg"
              aria-invalid={Boolean(state.fieldErrors.openingFloat)}
            />
            {state.fieldErrors.openingFloat ? (
              <p className="text-destructive text-sm">
                {state.fieldErrors.openingFloat}
              </p>
            ) : null}
          </div>

          <OpenButton />
        </form>
      </div>
    </div>
  )
}
