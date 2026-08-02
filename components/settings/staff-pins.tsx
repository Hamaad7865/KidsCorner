"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, KeyRound, LoaderCircle, Lock, LockOpen } from "lucide-react"
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
import { IDLE_STATE } from "@/lib/forms"
import { clearPinLock, setCashierPin } from "@/lib/pos/actions"
import type { StaffPinState } from "@/lib/pos/actions"
import type { Cashier } from "@/lib/pos/sale-core"

/**
 * Owner-only PIN management. Without this the till's cashier switcher has
 * nothing to verify against, so it ships alongside it rather than later.
 *
 * Only whether a PIN exists is ever shown — the hash stays server-side.
 */
export function StaffPins({
  staff,
  canManage,
}: {
  staff: StaffPinState[]
  canManage: boolean
}) {
  const [editing, setEditing] = useState<Cashier | null>(null)

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-heading text-base font-medium">Staff PINs</h2>
        <p className="text-muted-foreground text-sm">
          The 4-digit code each person taps to take over the till. Every sale
          records who rang it up.
          {canManage ? "" : " Only the owner can change these."}
        </p>
      </div>

      <div className="divide-y rounded-lg border">
        {staff.map((person) => (
          <div
            key={person.id}
            className="flex items-center justify-between gap-3 p-3"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{person.fullName}</div>
              <div className="text-muted-foreground text-xs">
                <span className="capitalize">{person.role}</span>
                {person.failedAttempts > 0 ? (
                  <span className="text-warning">
                    {" · "}
                    {person.failedAttempts} wrong{" "}
                    {person.failedAttempts === 1 ? "try" : "tries"}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* A lockout is the one thing here that stops somebody working.
                  It leads, and it says how long is left — "Locked" on its own
                  invites the owner to wait an unknown amount of time. */}
              {person.lockedUntil ? (
                <Badge variant="outline" className="text-destructive">
                  <Lock aria-hidden className="size-3" />
                  Locked · {waitLeft(person.lockedUntil)}
                </Badge>
              ) : null}
              {person.hasPin ? (
                <Badge variant="secondary">PIN set</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  No PIN
                </Badge>
              )}
              {person.lockedUntil ? (
                <UnlockButton person={person} canManage={canManage} />
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={!canManage}
                onClick={() => setEditing(person)}
              >
                <KeyRound aria-hidden />
                {person.hasPin ? "Change" : "Set"}
              </Button>
            </div>
          </div>
        ))}
        {staff.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">
            No active staff profiles yet.
          </p>
        ) : null}
      </div>

      {editing ? (
        <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>PIN for {editing.fullName}</DialogTitle>
              <DialogDescription>
                Four digits. Leave it blank to remove their PIN entirely.
              </DialogDescription>
            </DialogHeader>
            {/* Unmounts on close, resetting the action state. */}
            <PinForm person={editing} onSaved={() => setEditing(null)} />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
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
        "Save PIN"
      )}
    </Button>
  )
}

function PinForm({ person, onSaved }: { person: Cashier; onSaved: () => void }) {
  const [state, formAction] = useActionState(setCashierPin, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="profileId" value={person.id} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="pin">New PIN</Label>
        <Input
          id="pin"
          name="pin"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder="••••"
          className="text-center font-mono text-2xl tracking-[0.5em]"
          autoFocus
          aria-invalid={Boolean(state.fieldErrors.pin)}
        />
        {state.fieldErrors.pin ? (
          <p className="text-destructive text-sm">{state.fieldErrors.pin}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Stored as a PBKDF2 hash, never in plain text. A 4-digit code is a
          convenience for switching cashiers, not a password — the Supabase
          login is what actually secures the till.
        </p>
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

/**
 * How long is left on a lockout, in words.
 *
 * Rounded up, never down: telling somebody "1 minute" when 61 seconds remain
 * sends them back to the keypad a second early, to be refused again.
 */
export function waitLeft(until: string): string {
  const seconds = Math.ceil((Date.parse(until) - Date.now()) / 1000)
  if (!Number.isFinite(seconds) || seconds <= 0) return "moments"
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.ceil(minutes / 60)
  return `${hours}h`
}

/**
 * Frees a locked-out cashier without waiting out the clock.
 *
 * The action behind this has existed since the lockout was built and had no
 * caller — the escape hatch was written and never given a handle. Owner-only,
 * matching the action's own check: clearing the lockout removes the only brake
 * on guessing a 4-digit PIN, so it is not something a manager can do for
 * themselves.
 */
function UnlockButton({
  person,
  canManage,
}: {
  person: StaffPinState
  canManage: boolean
}) {
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!canManage || pending}
      onClick={() =>
        startTransition(async () => {
          const result = await clearPinLock(person.id)
          if (result.status === "success") {
            toast.success(`${person.fullName} can try again now.`)
          } else if (result.error) {
            toast.error(result.error)
          }
        })
      }
    >
      {pending ? (
        <LoaderCircle className="animate-spin" aria-hidden />
      ) : (
        <LockOpen aria-hidden />
      )}
      Unlock
    </Button>
  )
}
