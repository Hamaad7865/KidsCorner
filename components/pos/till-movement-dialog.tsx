"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, ArrowDownLeft, ArrowUpRight, LoaderCircle } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Banknote } from "lucide-react"

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
import { recordTillMovement } from "@/lib/pos/actions"
import { cn } from "@/lib/utils"

/**
 * Petty cash in or out. The direction is a pair of buttons rather than a signed
 * number — asking someone at a till to type a minus sign is a reliable way to
 * get the sign wrong, and the ledger is append-only so a wrong row has to be
 * corrected with another one.
 */
export function TillMovementDialog({
  shiftId,
  size = "default",
}: {
  shiftId: number
  /** "sm" for the sell screen's toolbar, where it sits beside Hold and Held. */
  size?: "sm" | "default"
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)}>
        <Banknote aria-hidden />
        Cash in / out
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Till movement</DialogTitle>
            <DialogDescription>
              Records cash leaving or entering the drawer outside a sale. It
              adjusts what is expected at close.
            </DialogDescription>
          </DialogHeader>
          {/* Unmounts on close, resetting the action state. */}
          <MovementForm shiftId={shiftId} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Recording…
        </>
      ) : (
        "Record movement"
      )}
    </Button>
  )
}

function MovementForm({
  shiftId,
  onSaved,
}: {
  shiftId: number
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(recordTillMovement, IDLE_STATE)
  const [direction, setDirection] = useState<"out" | "in">("out")

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="shiftId" value={shiftId} />
      <input type="hidden" name="direction" value={direction} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={direction === "out" ? "default" : "outline"}
          className={cn("h-control")}
          onClick={() => setDirection("out")}
        >
          <ArrowUpRight aria-hidden />
          Cash out
        </Button>
        <Button
          type="button"
          variant={direction === "in" ? "default" : "outline"}
          className={cn("h-control")}
          onClick={() => setDirection("in")}
        >
          <ArrowDownLeft aria-hidden />
          Paid in
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="movement-amount">Amount (Rs)</Label>
        <Input
          id="movement-amount"
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          autoFocus
          className="h-control text-lg"
          aria-invalid={Boolean(state.fieldErrors.amount)}
        />
        {state.fieldErrors.amount ? (
          <p className="text-destructive text-sm">{state.fieldErrors.amount}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="movement-reason">Reason</Label>
        <Input
          id="movement-reason"
          name="reason"
          placeholder="e.g. Bought bags, paid the courier"
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
        <SaveButton />
      </DialogFooter>
    </form>
  )
}
