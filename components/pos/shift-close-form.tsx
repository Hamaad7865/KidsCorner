"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatRs, round2 } from "@/lib/format"
import { IDLE_STATE } from "@/lib/forms"
import { closeShift } from "@/lib/pos/actions"
import { cn } from "@/lib/utils"

function CloseButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="h-14 w-full text-base" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Closing…
        </>
      ) : (
        "Close the till"
      )}
    </Button>
  )
}

/**
 * Close of day. The expected figure is shown for context but recomputed on the
 * server — the variance is the number the shop reconciles against, so it must
 * not be whatever the browser happened to post.
 */
export function ShiftCloseForm({
  shiftId,
  expectedCash,
}: {
  shiftId: number
  expectedCash: number
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(closeShift, IDLE_STATE)
  const [counted, setCounted] = useState("")

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      router.push("/pos")
    }
  }, [state, router])

  const countedValue = Number(counted)
  const variance =
    counted === "" || !Number.isFinite(countedValue)
      ? null
      : round2(countedValue - expectedCash)

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="shiftId" value={shiftId} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="counted-cash">Counted cash in the drawer (Rs)</Label>
        <Input
          id="counted-cash"
          name="countedCash"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
          className="h-control text-lg"
          autoFocus
          aria-invalid={Boolean(state.fieldErrors.countedCash)}
        />
        {state.fieldErrors.countedCash ? (
          <p className="text-destructive text-sm">{state.fieldErrors.countedCash}</p>
        ) : null}
      </div>

      {variance !== null ? (
        <div
          className={cn(
            "flex items-baseline justify-between rounded-lg border p-4",
            variance === 0
              ? "bg-success-muted"
              : Math.abs(variance) > 0
                ? "bg-warning-muted"
                : undefined,
          )}
        >
          <span className="font-medium">Variance</span>
          <span className="text-2xl font-semibold tabular-nums">
            {variance > 0 ? "+" : ""}
            {formatRs(variance)}
          </span>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="shift-notes">Notes</Label>
        <Input
          id="shift-notes"
          name="notes"
          placeholder="Anything worth recording about the variance"
        />
      </div>

      <CloseButton />
    </form>
  )
}
