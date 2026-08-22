"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useFormStatus } from "react-dom"
import { AlertCircle, KeyRound, LoaderCircle, UserPlus } from "lucide-react"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { IDLE_STATE } from "@/lib/forms"
import {
  createStaffLogin,
  setStaffActive,
  type StaffLogin,
} from "@/lib/staff/actions"

/**
 * Who can sign in, and the one screen that changes it.
 *
 * The PINs panel below this one decides what somebody can do AT a till; this
 * panel decides whether the person exists to Supabase Auth at all. Both are
 * owner-only, for the same reason: a login is a key.
 *
 * When the service key is missing the list still renders — who is on staff is
 * readable from `profiles` alone — but creating is disabled with instructions
 * rather than failing mysteriously at submit time.
 */
export function StaffLogins({
  staff,
  canCreate,
  currentUserId,
}: {
  staff: StaffLogin[]
  canCreate: boolean
  currentUserId: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-heading flex items-center gap-2 text-base font-medium">
            <KeyRound className="size-4" aria-hidden />
            Staff logins
          </h2>
          <p className="text-muted-foreground text-sm">
            Email sign-ins for the back office and a till device. A
            cashier&apos;s day-to-day keypad is their PIN; this is the account
            behind it.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} disabled={!canCreate}>
          <UserPlus aria-hidden />
          Add login
        </Button>
      </div>

      {!canCreate ? (
        <Alert>
          <AlertCircle aria-hidden />
          <AlertDescription>
            Creating logins needs <code>SUPABASE_SERVICE_ROLE_KEY</code> set on
            the server (it is server-only and must never start with
            NEXT_PUBLIC_). Until then, accounts can only be made in the Supabase
            dashboard.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((person) => (
              <StaffRow
                key={person.id}
                person={person}
                isSelf={person.id === currentUserId}
              />
            ))}
            {staff.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground py-6 text-center text-sm">
                  No staff profiles yet — add the first login above.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <CreateLoginDialog open={open} onOpenChange={setOpen} />
    </section>
  )
}

function StaffRow({ person, isSelf }: { person: StaffLogin; isSelf: boolean }) {
  const [active, setActive] = useState(person.isActive)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const toggle = (next: boolean) => {
    const previous = active
    setActive(next) // Optimistic; flipped back if the server refuses.
    setError(null)
    startTransition(async () => {
      const result = await setStaffActive(person.id, next)
      if (!result.ok) {
        setActive(previous)
        setError(result.error)
      }
    })
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {person.fullName}
        {isSelf ? (
          <span className="text-muted-foreground ml-2 text-xs">(you)</span>
        ) : null}
        {!active ? (
          <Badge variant="outline" className="ml-2">
            inactive
          </Badge>
        ) : null}
        {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
      </TableCell>
      <TableCell className="font-mono text-xs">{person.email ?? "—"}</TableCell>
      <TableCell>
        <Badge variant="secondary">{person.role}</Badge>
      </TableCell>
      <TableCell className="text-right">
        <Switch
          checked={active}
          disabled={pending || isSelf}
          onCheckedChange={toggle}
          aria-label={`Access for ${person.fullName}`}
        />
      </TableCell>
    </TableRow>
  )
}

function CreateLoginDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a login</DialogTitle>
          <DialogDescription>
            Creates an email + password sign-in and the staff record behind it.
            Share the password once; they change it from the login screen.
          </DialogDescription>
        </DialogHeader>
        {/* Remounted per open so a second add never inherits the first form's
            success state and snap shut (see master-data-dialog). */}
        {open ? <CreateLoginForm onSaved={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function CreateLoginForm({ onSaved }: { onSaved: () => void }) {
  const [state, formAction] = useActionState(createStaffLogin, IDLE_STATE)

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

      <div className="space-y-2">
        <Label htmlFor="staffFullName">Full name</Label>
        <Input id="staffFullName" name="fullName" placeholder="e.g. Rita Appadoo" />
        {state.fieldErrors.fullName ? (
          <p className="text-destructive text-sm">{state.fieldErrors.fullName}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="staffEmail">Email</Label>
        <Input id="staffEmail" name="email" type="email" placeholder="name@example.com" />
        {state.fieldErrors.email ? (
          <p className="text-destructive text-sm">{state.fieldErrors.email}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="staffPassword">Password</Label>
        <Input id="staffPassword" name="password" type="text" defaultValue="" minLength={8} />
        <p className="text-muted-foreground text-xs">
          At least 8 characters. Type it as plain text so you can read it out
          once, then never again.
        </p>
        {state.fieldErrors.password ? (
          <p className="text-destructive text-sm">{state.fieldErrors.password}</p>
        ) : null}
      </div>

      <RoleField error={state.fieldErrors.role} />

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
        <SubmitButton />
      </DialogFooter>
    </form>
  )
}

function RoleField({ error }: { error?: string }) {
  // Uncontrolled by React: the native select posts its value with the form.
  // The shadcn Select keeps its own state, which would need wiring to submit.
  return (
    <div className="space-y-2">
      <Label htmlFor="staffRole">Role</Label>
      <select
        id="staffRole"
        name="role"
        defaultValue="cashier"
        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
      >
        <option value="cashier">Cashier — till only</option>
        <option value="manager">Manager — back office and till</option>
        <option value="owner">Owner — everything, including settings</option>
      </select>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Creating…
        </>
      ) : (
        "Create login"
      )}
    </Button>
  )
}
