"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, Eye, EyeOff, LoaderCircle, Pencil, Trash2 } from "lucide-react"
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
import { deleteMasterRow, setMasterRowActive } from "@/lib/master-data/actions"

export type MasterKind = "categories" | "brands" | "colours" | "sizes"

/**
 * One-click activate/deactivate. This is the common master data operation —
 * a colour is retired far more often than it is renamed — so it gets its own
 * control rather than living behind the edit dialog.
 */
function ToggleSubmit({ isActive, name }: { isActive: boolean; name: string }) {
  // Must be its own component: useFormStatus only reports on a form that is an
  // *ancestor*, so calling it alongside the <form> would always read pending=false.
  const { pending } = useFormStatus()
  const label = isActive ? `Deactivate ${name}` : `Activate ${name}`

  return (
    <Button
      type="submit"
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      title={label}
      aria-label={label}
    >
      {pending ? (
        <LoaderCircle className="animate-spin" aria-hidden />
      ) : isActive ? (
        <EyeOff aria-hidden />
      ) : (
        <Eye aria-hidden />
      )}
    </Button>
  )
}

function ToggleActiveButton({
  kind,
  id,
  name,
  isActive,
}: {
  kind: MasterKind
  id: number
  name: string
  isActive: boolean
}) {
  const [state, formAction] = useActionState(setMasterRowActive, IDLE_STATE)

  // This control has nowhere inline to put a message, so failures go to the
  // toaster. Without it a rejected write — RLS, or a row deleted in another
  // tab — would look exactly like nothing happening.
  useEffect(() => {
    if (state.status === "error" && state.error) toast.error(state.error)
  }, [state])

  return (
    <form action={formAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      {/* Submits the value we want *after* the click. Active rows send nothing,
          which the server reads as false; inactive rows send "true". */}
      {isActive ? null : <input type="hidden" name="isActive" value="true" />}
      <ToggleSubmit isActive={isActive} name={name} />
    </form>
  )
}

function DeleteConfirmForm({
  kind,
  id,
  name,
  onDeleted,
}: {
  kind: MasterKind
  id: number
  name: string
  onDeleted: () => void
}) {
  const [state, formAction] = useActionState(deleteMasterRow, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") onDeleted()
  }, [state, onDeleted])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />

      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          This can’t be undone. If anything already references it, the database
          will refuse and you’ll be offered deactivation instead.
        </AlertDialogDescription>
      </AlertDialogHeader>

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialogFooter>
        <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
        <DeleteSubmit />
      </AlertDialogFooter>
    </form>
  )
}

function DeleteSubmit() {
  const { pending } = useFormStatus()
  return (
    <AlertDialogAction type="submit" variant="destructive" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Deleting…
        </>
      ) : (
        "Delete"
      )}
    </AlertDialogAction>
  )
}

function DeleteRowButton(props: { kind: MasterKind; id: number; name: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-destructive"
        onClick={() => setOpen(true)}
        title={`Delete ${props.name}`}
        aria-label={`Delete ${props.name}`}
      >
        <Trash2 aria-hidden />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          {/* Unmounts with the dialog, which resets the delete action state so
              a previous failure is not still on screen when it is reopened. */}
          <DeleteConfirmForm {...props} onDeleted={() => setOpen(false)} />
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function RowActions({
  kind,
  id,
  name,
  isActive,
  onEdit,
}: {
  kind: MasterKind
  id: number
  name: string
  isActive: boolean
  onEdit: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <ToggleActiveButton kind={kind} id={id} name={name} isActive={isActive} />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onEdit}
        title={`Edit ${name}`}
        aria-label={`Edit ${name}`}
      >
        <Pencil aria-hidden />
      </Button>
      <DeleteRowButton kind={kind} id={id} name={name} />
    </div>
  )
}
