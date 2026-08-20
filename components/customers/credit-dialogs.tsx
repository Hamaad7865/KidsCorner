"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import {
  AlertCircle,
  BadgePercent,
  HandCoins,
  LoaderCircle,
  ScrollText,
} from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  settleAccount,
  setCreditTerms,
  writeOffAccount,
} from "@/lib/credit/actions"
import {
  isCollectedMethod,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from "@/lib/db-enums"
import { formatRs } from "@/lib/format"
import { IDLE_STATE } from "@/lib/forms"

/**
 * The three ways a person changes an account, each behind its own dialog.
 *
 * They are separate dialogs rather than tabs in one because they are separate
 * decisions with different consequences and, in one case, a different role:
 * setting a limit is administration, taking a payment is money arriving, and
 * writing a debt off is money the shop has decided it will never see.
 */

/** The methods money actually arrives by — everything except the account itself. */
const SETTLE_METHOD_ITEMS = PAYMENT_METHODS.filter(isCollectedMethod).map(
  (method) => ({ value: method, label: PAYMENT_METHOD_LABELS[method] }),
)

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          {busy}
        </>
      ) : (
        idle
      )}
    </Button>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

// ------------------------------------------------------------------- terms

export type CreditTerms = {
  id: number
  fullName: string
  creditLimit: number
  creditTermsDays: number
  onHold: boolean
}

export function CreditTermsDialog({
  customer,
  hasAccount,
}: {
  customer: CreditTerms
  hasAccount: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant={hasAccount ? "outline" : "default"} onClick={() => setOpen(true)}>
        <BadgePercent aria-hidden />
        {hasAccount ? "Credit terms" : "Open an account"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {hasAccount ? "Credit terms" : `Open an account for ${customer.fullName}`}
            </DialogTitle>
            <DialogDescription>
              A limit of Rs 0 means no account: the till will refuse to put
              anything on it.
            </DialogDescription>
          </DialogHeader>
          <TermsForm customer={customer} onSaved={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

function TermsForm({
  customer,
  onSaved,
}: {
  customer: CreditTerms
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(setCreditTerms, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  const err = state.fieldErrors

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="customerId" value={customer.id} />
      <FormError message={state.error} />

      <div className="space-y-2">
        <Label htmlFor="credit-limit">Credit limit</Label>
        <Input
          id="credit-limit"
          name="creditLimit"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          defaultValue={String(customer.creditLimit)}
          autoFocus
          aria-invalid={Boolean(err.creditLimit)}
        />
        {err.creditLimit ? (
          <p className="text-destructive text-sm">{err.creditLimit}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          The most {customer.fullName} may owe at any one time.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="credit-terms">Days to pay</Label>
        <Input
          id="credit-terms"
          name="creditTermsDays"
          type="number"
          inputMode="numeric"
          step="1"
          min="0"
          max="365"
          defaultValue={String(customer.creditTermsDays)}
          aria-invalid={Boolean(err.creditTermsDays)}
        />
        {err.creditTermsDays ? (
          <p className="text-destructive text-sm">{err.creditTermsDays}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Sets when each new charge falls due in the receivables report. Charges
          already on the account keep the terms they were given.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-1">
          <Label htmlFor="creditOnHold">Put the account on hold</Label>
          <p className="text-muted-foreground text-xs">
            Refuses new charges without forgetting the limit or the history.
          </p>
        </div>
        <Switch
          id="creditOnHold"
          name="creditOnHold"
          value="true"
          defaultChecked={customer.onHold}
        />
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SubmitButton idle="Save terms" busy="Saving…" />
      </DialogFooter>
    </form>
  )
}

// ---------------------------------------------------------------- payments

export function SettleAccountDialog({
  customerId,
  customerName,
  balance,
}: {
  customerId: number
  customerName: string
  balance: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={balance <= 0}>
        <HandCoins aria-hidden />
        Record a payment
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment from {customerName}</DialogTitle>
            <DialogDescription>
              {formatRs(balance)} is owed. A payment cannot be more than that —
              take the difference as a sale instead.
            </DialogDescription>
          </DialogHeader>
          <SettleForm
            customerId={customerId}
            balance={balance}
            onSaved={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function SettleForm({
  customerId,
  balance,
  onSaved,
}: {
  customerId: number
  balance: number
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(settleAccount, IDLE_STATE)
  const [method, setMethod] = useState<string>("cash")

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  const err = state.fieldErrors

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="customerId" value={customerId} />
      <FormError message={state.error} />

      <div className="space-y-2">
        <Label htmlFor="settle-amount">Amount</Label>
        <Input
          id="settle-amount"
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          max={String(balance)}
          defaultValue={String(balance)}
          autoFocus
          aria-invalid={Boolean(err.amount)}
        />
        {err.amount ? <p className="text-destructive text-sm">{err.amount}</p> : null}
        <p className="text-muted-foreground text-xs">
          Defaults to the whole balance. Change it for a part payment.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settle-method">How it was paid</Label>
        <Select
          name="method"
          value={method}
          onValueChange={(value) => setMethod(String(value))}
          items={SETTLE_METHOD_ITEMS}
        >
          <SelectTrigger
            id="settle-method"
            className="w-full"
            aria-invalid={Boolean(err.method)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SETTLE_METHOD_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {err.method ? <p className="text-destructive text-sm">{err.method}</p> : null}
        <p className="text-muted-foreground text-xs">
          Cash taken here is recorded in the office, not in a till drawer — a
          cashier takes it on the till so the drawer expects it.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settle-reason">Note</Label>
        <Input id="settle-reason" name="reason" placeholder="Optional" />
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SubmitButton idle="Record payment" busy="Recording…" />
      </DialogFooter>
    </form>
  )
}

// --------------------------------------------------------------- write-off

export function WriteOffDialog({
  customerId,
  customerName,
  balance,
}: {
  customerId: number
  customerName: string
  balance: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={balance <= 0}>
        <ScrollText aria-hidden />
        Write off
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Write off {customerName}&rsquo;s debt</DialogTitle>
            <DialogDescription>
              This clears the balance without any money arriving, and it stays on
              the account as a written-off entry. It is not a payment and it is
              not reversible.
            </DialogDescription>
          </DialogHeader>
          <WriteOffForm
            customerId={customerId}
            balance={balance}
            onSaved={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function WriteOffForm({
  customerId,
  balance,
  onSaved,
}: {
  customerId: number
  balance: number
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(writeOffAccount, IDLE_STATE)

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      onSaved()
    }
  }, [state, onSaved])

  const err = state.fieldErrors

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="customerId" value={customerId} />
      <FormError message={state.error} />

      <div className="space-y-2">
        <Label htmlFor="writeoff-amount">Amount</Label>
        <Input
          id="writeoff-amount"
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          max={String(balance)}
          defaultValue={String(balance)}
          autoFocus
          aria-invalid={Boolean(err.amount)}
        />
        {err.amount ? <p className="text-destructive text-sm">{err.amount}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="writeoff-reason">Why</Label>
        <Input
          id="writeoff-reason"
          name="reason"
          placeholder="Moved away, unreachable since March…"
          aria-invalid={Boolean(err.reason)}
        />
        {err.reason ? <p className="text-destructive text-sm">{err.reason}</p> : null}
        <p className="text-muted-foreground text-xs">
          Required. It is the only thing that tells this apart from a mistake
          later.
        </p>
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          Cancel
        </DialogClose>
        <SubmitButton idle="Write it off" busy="Writing off…" />
      </DialogFooter>
    </form>
  )
}
