"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { useFormStatus } from "react-dom"
import {
  AlertCircle,
  KeyRound,
  LoaderCircle,
  Pencil,
  Trash2,
  UserPlus,
} from "lucide-react"
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
  deleteStaffLogin,
  setStaffActive,
  updateStaffLogin,
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
 * readable from `profiles` alone — but anything touching the credential
 * (create, email, password) is disabled with instructions rather than failing
 * mysteriously at submit time. Name, role and removal need only RLS.
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
                canUseServiceKey={canCreate}
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

function StaffRow({
  person,
  isSelf,
  canUseServiceKey,
}: {
  person: StaffLogin
  isSelf: boolean
  canUseServiceKey: boolean
}) {
  const [active, setActive] = useState(person.isActive)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [removing, startRemove] = useTransition()

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

  const remove = () => {
    setError(null)
    startRemove(async () => {
      const result = await deleteStaffLogin(person.id)
      if (result.ok) {
        toast.success(`${person.fullName} removed from staff.`)
      } else if (result.error) {
        toast.error(result.error)
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
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${person.fullName}`}
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden />
          </Button>
          {/* Self-delete is refused server-side; hiding the button says so
              up front rather than at submit time. */}
          {!isSelf ? (
            <AlertDialog
              open={confirmingDelete}
              onOpenChange={(next) => !removing && setConfirmingDelete(next)}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${person.fullName}`}
                onClick={() => setConfirmingDelete(true)}
              >
                {removing ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <Trash2 aria-hidden />
                )}
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {person.fullName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Deletes their sign-in and staff record. If they have rung up
                    sales, history keeps their name and the removal is refused —
                    switch them off instead.
                  </AlertDialogDescription>
                  {!canUseServiceKey ? (
                    <AlertDialogDescription>
                      The service key is not configured, so only the staff
                      record is deleted here; the sign-in must be removed in the
                      Supabase dashboard.
                    </AlertDialogDescription>
                  ) : null}
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep them</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={removing}
                    onClick={remove}
                  >
                    {removing ? "Removing…" : "Remove"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <Switch
            checked={active}
            disabled={pending || isSelf}
            onCheckedChange={toggle}
            aria-label={`Access for ${person.fullName}`}
          />
        </div>
      </TableCell>
      {editing ? (
        <EditLoginDialog
          person={person}
          isSelf={isSelf}
          canUseServiceKey={canUseServiceKey}
          onDone={() => setEditing(false)}
        />
      ) : null}
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

function RoleField({
  error,
  id = "staffRole",
  defaultValue = "cashier",
  disabled = false,
}: {
  error?: string
  id?: string
  defaultValue?: string
  disabled?: boolean
}) {
  // Uncontrolled by React: the native select posts its value with the form.
  // The shadcn Select keeps its own state, which would need wiring to submit.
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Role</Label>
      <select
        id={id}
        name="role"
        defaultValue={defaultValue}
        disabled={disabled}
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

function EditLoginDialog({
  person,
  isSelf,
  canUseServiceKey,
  onDone,
}: {
  person: StaffLogin
  isSelf: boolean
  canUseServiceKey: boolean
  onDone: () => void
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && onDone()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {person.fullName}</DialogTitle>
          <DialogDescription>
            Changes the staff record, and the sign-in behind it when the email
            or password is touched.
          </DialogDescription>
        </DialogHeader>
        {/* Unmounts on close, resetting the action state. */}
        <EditLoginForm
          person={person}
          isSelf={isSelf}
          canUseServiceKey={canUseServiceKey}
          onSaved={onDone}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditLoginForm({
  person,
  isSelf,
  canUseServiceKey,
  onSaved,
}: {
  person: StaffLogin
  isSelf: boolean
  canUseServiceKey: boolean
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(updateStaffLogin, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") onSaved()
  }, [state, onSaved])

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="profileId" value={person.id} />
      {/* Convenience only: lets the action skip a no-op credential write.
          The submitted values themselves are always authoritative. */}
      <input type="hidden" name="originalEmail" value={person.email ?? ""} />

      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={`staffFullName-${person.id}`}>Full name</Label>
        <Input
          id={`staffFullName-${person.id}`}
          name="fullName"
          defaultValue={person.fullName}
        />
        {state.fieldErrors.fullName ? (
          <p className="text-destructive text-sm">{state.fieldErrors.fullName}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`staffEmail-${person.id}`}>Email</Label>
        <Input
          id={`staffEmail-${person.id}`}
          name="email"
          type="email"
          defaultValue={person.email ?? ""}
          disabled={!canUseServiceKey}
        />
        {!canUseServiceKey ? (
          <p className="text-muted-foreground text-xs">
            Needs SUPABASE_SERVICE_ROLE_KEY on the server.
          </p>
        ) : null}
        {state.fieldErrors.email ? (
          <p className="text-destructive text-sm">{state.fieldErrors.email}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`staffPassword-${person.id}`}>New password</Label>
        <Input
          id={`staffPassword-${person.id}`}
          name="password"
          type="text"
          defaultValue=""
          placeholder="Leave blank to keep current"
          disabled={!canUseServiceKey}
        />
        {canUseServiceKey ? (
          <p className="text-muted-foreground text-xs">
            At least 8 characters. Read it out once; never write it where they
            work.
          </p>
        ) : null}
        {state.fieldErrors.password ? (
          <p className="text-destructive text-sm">{state.fieldErrors.password}</p>
        ) : null}
      </div>

      {/* The acting owner's own role is frozen in the UI as well as the
          action — demoting yourself leaves the shop with nobody able to
          undo it. */}
      <RoleField
        id={`staffRole-${person.id}`}
        error={state.fieldErrors.role}
        defaultValue={person.role}
        disabled={isSelf}
      />

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <EditSubmitButton />
      </DialogFooter>
    </form>
  )
}

function EditSubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Saving…
        </>
      ) : (
        "Save changes"
      )}
    </Button>
  )
}
