"use client"

import { useActionState, useEffect, useMemo, useRef, useState } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import { AlertCircle, LoaderCircle, Minus, Plus } from "lucide-react"
import { toast } from "sonner"

import { ManagerApproval } from "@/components/pos/manager-approval"
import { ColourSwatch } from "@/components/settings/colour-swatch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatRs, round2 } from "@/lib/format"
import { IDLE_STATE } from "@/lib/forms"
import { createCreditNote } from "@/lib/returns/actions"
import type { Cashier } from "@/lib/pos/sale-core"
import type { SaleForReturn } from "@/lib/returns/queries"
import { cn } from "@/lib/utils"

const REFUND_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "juice", label: "Juice" },
  { value: "myt_money", label: "my.t money" },
  // No money moves, so it must not reduce the cash expected in the drawer.
  { value: "exchange", label: "Exchange (no refund)" },
]

function SubmitButton({ count, amount }: { count: number; amount: number }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="h-control" disabled={pending || count === 0}>
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden />
          Raising…
        </>
      ) : count === 0 ? (
        "Pick items to return"
      ) : (
        `Refund ${formatRs(amount)}`
      )}
    </Button>
  )
}

/**
 * Return screen. Quantities are per line and capped at what is still
 * returnable, so a customer bringing back one of three shirts gets a credit
 * note for one. The database enforces the same cap — this is the friendly half.
 */
export function ReturnForm({
  sale,
  shiftId,
  managers = [],
}: {
  sale: SaleForReturn
  shiftId: number | null
  /**
   * Owners and managers who can authorise, for the shops that require it.
   *
   * Empty in the back office, where nobody needs to: `requireAdminProfile`
   * has already turned away anyone who is not one, so the person clicking the
   * button IS the approval and asking for a second credential would be
   * theatre. The till passes a real list, because a cashier is standing there.
   */
  managers?: Cashier[]
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, isPending] = useActionState(createCreditNote, IDLE_STATE)
  const [qty, setQty] = useState<Record<number, number>>({})
  const [method, setMethod] = useState("cash")

  /**
   * Whether the goods go back on the shelf.
   *
   * The tablet till has had this switch since it was built and the back
   * office did not, so every return raised here restocked — a faulty garment
   * went straight back out as sellable. The RPC defaults to restocking, which
   * is why nothing ever failed.
   */
  const [restock, setRestock] = useState(true)

  /** The manager's PIN, once one has been typed. Never held beyond this submit. */
  const [approval, setApproval] = useState<{ managerId: string; pin: string } | null>(null)

  // Re-submits once a manager has authorised. An effect rather than a call
  // inside onApprove, because the approval reaches the server as a hidden
  // input and that input does not exist until React has committed the state
  // that renders it. Effects run after commit; a requestAnimationFrame does
  // not promise to.
  useEffect(() => {
    if (approval) formRef.current?.requestSubmit()
  }, [approval])

  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message)
      // Refresh only. The quantities are clamped against what is still
      // returnable below, so once the refreshed props arrive the picked
      // amounts collapse to zero on their own — no setState in an effect, and
      // the selection can never exceed what the database would allow.
      router.refresh()
    }
  }, [state, router])

  const picked = useMemo(
    () =>
      sale.lines
        .map((line) => ({
          line,
          qty: Math.min(qty[line.saleItemId] ?? 0, line.qtyReturnable),
        }))
        .filter((entry) => entry.qty > 0),
    [sale.lines, qty],
  )

  const refundTotal = round2(
    picked.reduce((sum, e) => sum + e.line.unitPaid * e.qty, 0),
  )

  const setLineQty = (saleItemId: number, next: number, max: number) => {
    setQty((current) => ({
      ...current,
      [saleItemId]: Math.min(Math.max(0, next), max),
    }))
  }

  // Asked for by the server, not guessed at here: the shop's setting lives in
  // one place and this reacts to it rather than keeping a second copy.
  const needsApproval = Boolean(state.fieldErrors.needsApproval)

  const showKeypad = needsApproval && managers.length > 0

  if (sale.fullyReturned) {
    return (
      <Alert>
        <AlertCircle aria-hidden />
        <AlertDescription>
          Every item on this sale has already been returned. Nothing left to
          credit.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <>
      {showKeypad ? (
        <div className="space-y-4">
          <Alert>
            <AlertCircle aria-hidden />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
          {/* Outside the form on purpose. Its keys are Buttons, and a Button
              inside a form submits it — a manager typing a four-digit PIN
              would post the return four times. */}
          <ManagerApproval
            managers={managers}
            reason="return"
            // The real thing, not a hard-coded false. While the approved
            // return is in flight the keys have to be dead: the keypad sits
            // outside the form, so useFormStatus cannot see it, and a second
            // PIN typed into a live keypad would queue a second credit note.
            pending={isPending}
            onApprove={(managerId, pin) => setApproval({ managerId, pin })}
            onCancel={() => setApproval(null)}
          />
        </div>
      ) : null}

      {/* Hidden, never unmounted: the quantities, the reason and the restock
          switch have to survive the detour so the manager approves the return
          that was actually built, and requestSubmit needs a form that exists. */}
      <form
        ref={formRef}
        action={formAction}
        className={showKeypad ? "hidden" : "space-y-5"}
        noValidate
      >
        <input type="hidden" name="saleId" value={sale.id} />
        {shiftId !== null ? (
          <input type="hidden" name="shiftId" value={shiftId} />
        ) : null}
        {approval ? (
          <input type="hidden" name="approval" value={JSON.stringify(approval)} />
        ) : null}
        <input
          type="hidden"
          name="items"
          value={JSON.stringify(
            picked.map((e) => ({ saleItemId: e.line.saleItemId, qty: e.qty })),
          )}
        />

        {state.error ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}

        {shiftId === null ? (
          <Alert>
            <AlertCircle aria-hidden />
            <AlertDescription>
              No till is open, so this credit note won&rsquo;t be attached to a
              shift. A cash refund raised now will not show in any drawer count —
              open the till first if cash is going back.
            </AlertDescription>
          </Alert>
        ) : null}

        <ul className="divide-y rounded-lg border">
          {sale.lines.map((line) => {
            const value = Math.min(qty[line.saleItemId] ?? 0, line.qtyReturnable)
            const exhausted = line.qtyReturnable === 0
            return (
              <li
                key={line.saleItemId}
                className={cn("flex items-center gap-3 p-3", exhausted && "opacity-50")}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ColourSwatch hex={line.colourHex} name={line.colourName} />
                    <span className="truncate font-medium">{line.productName}</span>
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {line.sizeLabel} · {line.colourName} · {formatRs(line.unitPaid)}{" "}
                    each
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {line.qtySold} sold
                    {line.qtyReturned > 0 ? ` · ${line.qtyReturned} returned` : ""}
                    {exhausted ? "" : ` · ${line.qtyReturnable} returnable`}
                  </div>
                </div>

                {exhausted ? (
                  <span className="text-muted-foreground text-xs">Fully returned</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      // size-control, not icon-sm: a fixed 28px opts out of the
                      // density tokens, so this form was built at mouse size and
                      // stayed there when the till started using it. 36px in the
                      // back office as before, 48px on a touch screen.
                      className="size-control"
                      onClick={() =>
                        setLineQty(line.saleItemId, value - 1, line.qtyReturnable)
                      }
                      aria-label={`Return one fewer ${line.productName}`}
                    >
                      <Minus aria-hidden />
                    </Button>
                    <span className="w-8 text-center font-medium tabular-nums">
                      {value}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      // size-control, not icon-sm: a fixed 28px opts out of the
                      // density tokens, so this form was built at mouse size and
                      // stayed there when the till started using it. 36px in the
                      // back office as before, 48px on a touch screen.
                      className="size-control"
                      onClick={() =>
                        setLineQty(line.saleItemId, value + 1, line.qtyReturnable)
                      }
                      aria-label={`Return one more ${line.productName}`}
                    >
                      <Plus aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="refund-reason">Reason</Label>
            <Input
              id="refund-reason"
              name="reason"
              placeholder="e.g. Wrong size, faulty stitching"
              aria-invalid={Boolean(state.fieldErrors.reason)}
            />
            {state.fieldErrors.reason ? (
              <p className="text-destructive text-sm">{state.fieldErrors.reason}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-method">Refund by</Label>
            <select
              id="refund-method"
              name="refundMethod"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              className="border-input h-control w-full rounded-lg border bg-transparent px-3 text-sm"
            >
              {REFUND_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Posted explicitly rather than relying on a checkbox's absence, so the
            value is always in the payload whichever way it is set. */}
        <input type="hidden" name="restock" value={restock ? "true" : ""} />

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            checked={restock}
            onChange={(event) => setRestock(event.target.checked)}
            className="accent-primary mt-0.5 size-4"
          />
          <span className="text-sm">
            <span className="font-medium">Put items back into stock</span>
            <span className="text-muted-foreground mt-0.5 block text-xs">
              {restock
                ? "Stock goes back on the shelf count immediately."
                : "Faulty stock stays out — write it off with a stock adjustment."}
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Refund </span>
            <span className="text-lg font-semibold tabular-nums">
              {formatRs(refundTotal)}
            </span>
            {method === "exchange" && refundTotal > 0 ? (
              <span className="text-muted-foreground"> (no money moves)</span>
            ) : null}
          </div>
          <SubmitButton count={picked.length} amount={refundTotal} />
        </div>
      </form>
    </>
  )
}
