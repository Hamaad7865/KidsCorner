"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, PackageCheck, XCircle } from "lucide-react"
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
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { IDLE_STATE } from "@/lib/forms"
import { cancelPurchase, receivePurchase } from "@/lib/purchases/actions"

/**
 * Receiving is the irreversible step — it writes stock movements and overwrites
 * each variant's cost price — so it goes behind a confirmation that states what
 * will happen. Cancelling is only offered while the purchase is still a draft.
 */
export function PurchaseActions({
  purchaseId,
  lineCount,
  totalUnits,
}: {
  purchaseId: number
  lineCount: number
  totalUnits: number
}) {
  const [confirming, setConfirming] = useState<"receive" | "cancel" | null>(null)

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setConfirming("receive")} disabled={lineCount === 0}>
        <PackageCheck aria-hidden />
        Receive
      </Button>
      <Button variant="outline" onClick={() => setConfirming("cancel")}>
        <XCircle aria-hidden />
        Cancel purchase
      </Button>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          {/* Unmounts with the dialog, resetting the action state. */}
          {confirming === "receive" ? (
            <ConfirmForm
              action={receivePurchase}
              purchaseId={purchaseId}
              title="Receive this purchase?"
              body={`${totalUnits} unit${totalUnits === 1 ? "" : "s"} across ${lineCount} line${lineCount === 1 ? "" : "s"} will be added to stock, and each variant's cost price will be updated to the unit cost on this purchase. This can't be undone.`}
              confirmLabel="Receive"
              onDone={() => setConfirming(null)}
            />
          ) : confirming === "cancel" ? (
            <ConfirmForm
              action={cancelPurchase}
              purchaseId={purchaseId}
              title="Cancel this purchase?"
              body="The draft stays on record but is marked cancelled. No stock is affected."
              confirmLabel="Cancel purchase"
              destructive
              onDone={() => setConfirming(null)}
            />
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ConfirmSubmit({
  label,
  destructive,
}: {
  label: string
  destructive?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <AlertDialogAction
      type="submit"
      variant={destructive ? "destructive" : "default"}
      disabled={pending}
    >
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Working…
        </>
      ) : (
        label
      )}
    </AlertDialogAction>
  )
}

function ConfirmForm({
  action,
  purchaseId,
  title,
  body,
  confirmLabel,
  destructive,
  onDone,
}: {
  action: typeof receivePurchase
  purchaseId: number
  title: string
  body: string
  confirmLabel: string
  destructive?: boolean
  onDone: () => void
}) {
  const [state, formAction] = useActionState(action, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onDone()
    }
  }, [state, onDone])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={purchaseId} />

      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{body}</AlertDialogDescription>
      </AlertDialogHeader>

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialogFooter>
        <AlertDialogCancel type="button">Back</AlertDialogCancel>
        <ConfirmSubmit label={confirmLabel} destructive={destructive} />
      </AlertDialogFooter>
    </form>
  )
}
