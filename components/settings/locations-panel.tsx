"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, LoaderCircle, MapPin, Pencil, Plus, Star } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import { saveLocation, setDefaultLocation } from "@/lib/access/actions"
import { IDLE_STATE } from "@/lib/forms"

export type StockLocation = {
  id: number
  name: string
  isDefault: boolean
  isActive: boolean
}

/**
 * Stock locations.
 *
 * Worth being clear about what these are: an attribute of each stock movement,
 * not a second set of balances. `qty_on_hand` stays the shop-wide total and
 * per-location figures are derived from the ledger, so nothing here can put the
 * two out of step.
 */
export function LocationsPanel({
  locations,
  canManage,
}: {
  locations: StockLocation[]
  canManage: boolean
}) {
  const [editing, setEditing] = useState<{ row: StockLocation | null } | null>(null)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-base font-medium">Stock locations</h2>
          <p className="text-muted-foreground text-sm">
            Where stock physically sits. Every movement is stamped with one, and
            the default is used whenever a movement doesn&rsquo;t name a
            location — so sales and purchases keep working untouched.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setEditing({ row: null })}>
            <Plus aria-hidden />
            New location
          </Button>
        ) : null}
      </div>

      <div className="divide-y rounded-lg border">
        {locations.map((location) => (
          <div key={location.id} className="flex items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <MapPin className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="truncate font-medium">{location.name}</span>
              {location.isDefault ? <Badge variant="secondary">Default</Badge> : null}
              {location.isActive ? null : (
                <Badge variant="outline" className="text-muted-foreground">
                  Inactive
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!location.isDefault && canManage ? (
                <MakeDefaultButton id={location.id} name={location.name} />
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canManage}
                onClick={() => setEditing({ row: location })}
                aria-label={`Edit ${location.name}`}
              >
                <Pencil aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        {locations.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">
            No locations yet. Migration 006 seeds “Shop floor” as the default.
          </p>
        ) : null}
      </div>

      {editing ? (
        <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {editing.row ? "Edit location" : "New location"}
              </DialogTitle>
              <DialogDescription>
                Somewhere stock lives — the shop floor, a stockroom, a second
                branch.
              </DialogDescription>
            </DialogHeader>
            <LocationForm row={editing.row} onSaved={() => setEditing(null)} />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  )
}

function MakeDefaultButton({ id, name }: { id: number; name: string }) {
  const [state, formAction] = useActionState(setDefaultLocation, IDLE_STATE)

  useEffect(() => {
    if (state.status === "error" && state.error) toast.error(state.error)
    if (state.status === "success" && state.message) toast.success(state.message)
  }, [state])

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <DefaultSubmit name={name} />
    </form>
  )
}

function DefaultSubmit({ name }: { name: string }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      title={`Make ${name} the default`}
      aria-label={`Make ${name} the default location`}
    >
      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Star aria-hidden />}
    </Button>
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
        "Save location"
      )}
    </Button>
  )
}

function LocationForm({
  row,
  onSaved,
}: {
  row: StockLocation | null
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(saveLocation, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {row ? <input type="hidden" name="id" value={row.id} /> : null}

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="loc-name">Name</Label>
        <Input
          id="loc-name"
          name="name"
          defaultValue={row?.name ?? ""}
          placeholder="e.g. Stockroom"
          autoFocus
          aria-invalid={Boolean(state.fieldErrors.name)}
        />
        {state.fieldErrors.name ? (
          <p className="text-destructive text-sm">{state.fieldErrors.name}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <Label htmlFor="loc-active">Active</Label>
        <Switch
          id="loc-active"
          name="isActive"
          value="true"
          defaultChecked={row?.isActive ?? true}
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
