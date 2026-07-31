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
import { Switch } from "@/components/ui/switch"
import { IDLE_STATE } from "@/lib/forms"
import { saveSupplier } from "@/lib/purchases/actions"
import type { Supplier } from "@/lib/purchases/queries"

export function SupplierDialog({
  supplier,
  iconOnly,
}: {
  supplier: Supplier | null
  /** Row-level edit affordance rather than the page-level "New supplier". */
  iconOnly?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* A real button, not a click handler wrapped round one: a bare <span>
          with onClick is invisible to assistive tech and to keyboard users. */}
      {iconOnly ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(true)}
          aria-label={`Edit ${supplier?.name ?? "supplier"}`}
        >
          <Pencil aria-hidden />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden />
          New supplier
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{supplier ? "Edit supplier" : "New supplier"}</DialogTitle>
            <DialogDescription>
              Suppliers are who you buy from — every purchase needs one.
            </DialogDescription>
          </DialogHeader>
          {/* Unmounts on close, which resets the action state. */}
          <SupplierForm supplier={supplier} onSaved={() => setOpen(false)} />
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
          Saving…
        </>
      ) : (
        "Save supplier"
      )}
    </Button>
  )
}

function SupplierForm({
  supplier,
  onSaved,
}: {
  supplier: Supplier | null
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(saveSupplier, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  const err = state.fieldErrors

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {supplier ? <input type="hidden" name="id" value={supplier.id} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="supplier-name">Name</Label>
        <Input
          id="supplier-name"
          name="name"
          defaultValue={supplier?.name ?? ""}
          autoFocus
          aria-invalid={Boolean(err.name)}
        />
        {err.name ? <p className="text-destructive text-sm">{err.name}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="supplier-phone">Phone</Label>
          <Input
            id="supplier-phone"
            name="phone"
            type="tel"
            defaultValue={supplier?.phone ?? ""}
            placeholder="+230 …"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="supplier-email">Email</Label>
          <Input
            id="supplier-email"
            name="email"
            type="email"
            defaultValue={supplier?.email ?? ""}
            aria-invalid={Boolean(err.email)}
          />
          {err.email ? <p className="text-destructive text-sm">{err.email}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="supplier-contact">Contact</Label>
          <Input
            id="supplier-contact"
            name="contactName"
            defaultValue={supplier?.contact_name ?? ""}
            placeholder="Who you speak to"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="supplier-town">Town</Label>
          <Input
            id="supplier-town"
            name="town"
            defaultValue={supplier?.town ?? ""}
            placeholder="Curepipe"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="supplier-address">Address</Label>
          <Input
            id="supplier-address"
            name="address"
            defaultValue={supplier?.address ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="supplier-terms">Payment terms</Label>
          {/* Free text, not a dropdown. Terms are negotiated per supplier and
              any list picked today is wrong within a year. */}
          <Input
            id="supplier-terms"
            name="paymentTerms"
            defaultValue={supplier?.payment_terms ?? ""}
            placeholder="30 days"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <Label htmlFor="supplier-active">Active</Label>
        <Switch
          id="supplier-active"
          name="isActive"
          value="true"
          defaultChecked={supplier?.is_active ?? true}
        />
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
