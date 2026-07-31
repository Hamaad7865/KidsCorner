"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, Plus } from "lucide-react"
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
import { createCustomer } from "@/lib/customers/actions"
import { IDLE_STATE } from "@/lib/forms"

/**
 * Quick create — name and phone are the only fields that matter at the till,
 * per the spec. Email and notes are there but optional.
 */
export function CustomerDialog() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        New customer
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
            <DialogDescription>
              Name and phone are enough. Everything else can wait.
            </DialogDescription>
          </DialogHeader>
          {/* Unmounts on close, resetting the action state. */}
          <CustomerForm onSaved={() => setOpen(false)} />
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
          Adding…
        </>
      ) : (
        "Add customer"
      )}
    </Button>
  )
}

function CustomerForm({ onSaved }: { onSaved: () => void }) {
  const [state, formAction] = useActionState(createCustomer, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  const err = state.fieldErrors

  return (
    <form action={formAction} className="space-y-4" noValidate>
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
          type="email"
          autoComplete="email"
          aria-invalid={Boolean(err.email)}
        />
        {err.email ? <p className="text-destructive text-sm">{err.email}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="customer-notes">Notes</Label>
        <Input id="customer-notes" name="notes" placeholder="Optional" />
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
