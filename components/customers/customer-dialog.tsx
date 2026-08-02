"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, Pencil, Plus } from "lucide-react"
import { toast } from "sonner"

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
import { createCustomer, updateCustomer } from "@/lib/customers/actions"
import { IDLE_STATE } from "@/lib/forms"

export type EditableCustomer = {
  id: number
  fullName: string
  phone: string | null
  email: string | null
  notes: string | null
}

/**
 * Quick create — name and phone are the only fields that matter at the till,
 * per the spec. Email and notes are there but optional.
 *
 * @param customer Pass one to edit it instead of creating. Same four fields,
 *   same validation, same uniqueness rule on the phone number, so the two
 *   modes cannot drift apart. A shop that could add a customer but never
 *   correct one had only one way to fix a mistyped number — a second record
 *   for the same person, which splits the purchase history the record exists
 *   to keep.
 */
export function CustomerDialog({ customer }: { customer?: EditableCustomer }) {
  const [open, setOpen] = useState(false)
  const editing = customer !== undefined

  return (
    <>
      <Button
        variant={editing ? "outline" : "default"}
        onClick={() => setOpen(true)}
      >
        {editing ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {editing ? "Edit details" : "New customer"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit customer" : "New customer"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Past sales stay attached — this changes who they are filed under, not what they bought."
                : "Name and phone are enough. Everything else can wait."}
            </DialogDescription>
          </DialogHeader>
          {/* Unmounts on close, resetting the action state. */}
          <CustomerForm customer={customer} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          {editing ? "Saving…" : "Adding…"}
        </>
      ) : editing ? (
        "Save changes"
      ) : (
        "Add customer"
      )}
    </Button>
  )
}

function CustomerForm({
  customer,
  onSaved,
}: {
  customer?: EditableCustomer
  onSaved: () => void
}) {
  const editing = customer !== undefined
  const [state, formAction] = useActionState(
    editing ? updateCustomer : createCustomer,
    IDLE_STATE,
  )

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  const err = state.fieldErrors

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {customer ? <input type="hidden" name="id" value={customer.id} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="customer-name">Name</Label>
        <Input
          id="customer-name"
          name="fullName"
          defaultValue={customer?.fullName ?? ""}
          autoFocus
          autoComplete="name"
          aria-invalid={Boolean(err.fullName)}
        />
        {err.fullName ? (
          <p className="text-destructive text-sm">{err.fullName}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="customer-phone">Phone</Label>
        <Input
          id="customer-phone"
          name="phone"
          defaultValue={customer?.phone ?? ""}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+230 …"
          aria-invalid={Boolean(err.phone)}
        />
        {err.phone ? <p className="text-destructive text-sm">{err.phone}</p> : null}
        <p className="text-muted-foreground text-xs">
          Optional, but it has to be unique — it&rsquo;s how the till finds
          someone.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="customer-email">Email</Label>
        <Input
          id="customer-email"
          name="email"
          defaultValue={customer?.email ?? ""}
          type="email"
          autoComplete="email"
          aria-invalid={Boolean(err.email)}
        />
        {err.email ? <p className="text-destructive text-sm">{err.email}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="customer-notes">Notes</Label>
        <Input
          id="customer-notes"
          name="notes"
          defaultValue={customer?.notes ?? ""}
          placeholder="Optional"
        />
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SaveButton editing={editing} />
      </DialogFooter>
    </form>
  )
}
