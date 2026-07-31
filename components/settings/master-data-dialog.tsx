"use client"

import { useActionState, useEffect, type ReactNode } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle } from "lucide-react"

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
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { IDLE_STATE, type FormState } from "@/lib/forms"

export type MasterDataAction = (
  prev: FormState,
  formData: FormData,
) => Promise<FormState>

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Saving…
        </>
      ) : (
        label
      )}
    </Button>
  )
}

/**
 * The form body. Deliberately a separate component from the dialog shell:
 * `DialogContent` unmounts when the dialog closes, which discards this
 * component's `useActionState`. Without that, reopening the dialog would
 * inherit the previous "success" state and the close effect would fire
 * immediately, snapping it shut again.
 */
function MasterDataForm({
  action,
  onSaved,
  submitLabel,
  isActive,
  fields,
}: {
  action: MasterDataAction
  onSaved: () => void
  submitLabel: string
  isActive: boolean
  fields: (fieldErrors: Record<string, string>) => ReactNode
}) {
  const [state, formAction] = useActionState(action, IDLE_STATE)

  // Depends on `state` identity, not `state.status`: the hook returns a fresh
  // object per submission, so two consecutive successes both close the dialog.
  useEffect(() => {
    if (state.status === "success") onSaved()
  }, [state, onSaved])

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {fields(state.fieldErrors)}

      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="isActive">Active</Label>
          <p className="text-muted-foreground text-xs">
            Inactive entries stay on past records but are hidden from new entry.
          </p>
        </div>
        {/* value="true" rather than the implicit "on": the server reads this
            with a helper that accepts either, but being explicit keeps the
            wire format obvious. Unchecked submits nothing, like a checkbox. */}
        <Switch
          id="isActive"
          name="isActive"
          value="true"
          defaultChecked={isActive}
        />
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SaveButton label={submitLabel} />
      </DialogFooter>
    </form>
  )
}

/**
 * Shared add/edit dialog for every master data table. Each entity supplies its
 * own fields; the shell owns submission state, the error banner, the active
 * switch and the footer.
 */
export function MasterDataDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  submitLabel = "Save",
  isActive,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  action: MasterDataAction
  submitLabel?: string
  isActive: boolean
  children: (fieldErrors: Record<string, string>) => ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <MasterDataForm
          action={action}
          onSaved={() => onOpenChange(false)}
          submitLabel={submitLabel}
          isActive={isActive}
          fields={children}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Inline field error, wired to the input via aria-describedby by the caller. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-destructive text-sm">
      {message}
    </p>
  )
}
