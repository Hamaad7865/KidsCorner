"use client"

import { useState, useTransition } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CloudOff,
  LoaderCircle,
  Printer,
  Trash2,
} from "lucide-react"

import { ManagerApproval } from "@/components/pos/manager-approval"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/lib/db-enums"
import { formatRs, round2 } from "@/lib/format"
import {
  changeDue,
  outstandingOn,
  withPayment,
  type Payment,
} from "@/lib/pos/payments"
import { completeSale } from "@/lib/pos/actions"
import type { Cashier } from "@/lib/pos/sale-core"
import { cartTotals, useCart } from "@/lib/pos/cart-store"
import { enqueueSale } from "@/lib/pos/queue"
import { useSaleQueue } from "@/lib/pos/use-sale-queue"
import { cn } from "@/lib/utils"

// The same four labels the back office shows, from db-enums rather than a
// second copy here — a method renamed in one place and not the other would have
// the receipt and the sales report disagreeing about how a customer paid.
const METHOD_LABELS = PAYMENT_METHOD_LABELS



/**
 * Payment step. Split payments are supported by adding rows until the total is
 * covered; the sale is only sent once, at Confirm.
 *
 * On failure the cart is deliberately left untouched so the cashier can retry —
 * the spec calls this out, and losing a basket at the till in front of a queue
 * is the worst possible failure.
 */
export function PaymentPanel({
  shiftId,
  vatRate,
  paymentMethods,
  cashierName,
  managers,
  onCancel,
  onDone,
}: {
  shiftId: number
  vatRate: number
  paymentMethods: PaymentMethod[]
  cashierName: string
  /** Owners and managers who can authorise a discount override. */
  managers: Cashier[]
  onCancel: () => void
  onDone: () => void
}) {
  const lines = useCart((s) => s.lines)
  const saleDiscount = useCart((s) => s.saleDiscount)
  const customerId = useCart((s) => s.customerId)
  const cashierId = useCart((s) => s.cashierId)
  const appliedDiscounts = useCart((s) => s.appliedDiscounts)
  const clear = useCart((s) => s.clear)

  const totals = cartTotals(lines, saleDiscount, vatRate)

  const [payments, setPayments] = useState<Payment<PaymentMethod>[]>([])
  const [method, setMethod] = useState(paymentMethods[0] ?? "cash")
  const [entry, setEntry] = useState("")
  const [error, setError] = useState<string | null>(null)
  /** Non-null while a manager PIN is being asked for; holds the server's reason. */
  const [approvalReason, setApprovalReason] = useState<string | null>(null)
  /**
   * Names this sale attempt. Minted once per payment panel and kept across
   * every retry, which is the whole point: pressing Confirm again after a
   * failure must reach the server as the SAME attempt, so a sale that
   * committed without answering is replayed rather than rung up twice.
   *
   * A lazy initialiser, not a plain useState value — `crypto.randomUUID()` in
   * the argument position would run on every render and mint a fresh key each
   * time, which is exactly the bug this is here to prevent.
   */
  const [saleKey] = useState(() => crypto.randomUUID())
  /**
   * Read from the cart rather than kept locally. They are the same fact — "a
   * submitted sale is unresolved" — and holding it in two places means it can
   * desync: a panel that unmounted would leave the basket frozen with nothing
   * on screen able to unfreeze it.
   */
  const unresolved = useCart((s) => s.settleFrozen)
  const freezeForSettle = useCart((s) => s.freezeForSettle)
  const thawSettle = useCart((s) => s.thawSettle)
  const [done, setDone] = useState<{ change: number; queued: boolean } | null>(null)
  const { pending: queuedCount, refresh: refreshQueue } = useSaleQueue()
  const [saleId, setSaleId] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  const paid = round2(payments.reduce((sum, p) => sum + p.amount, 0))
  const outstanding = outstandingOn(payments, totals.total)
  const entered = Number(entry) || 0

  const addPayment = (amount: number, tendered: number | null) => {
    setPayments((current) => withPayment(current, totals.total, method, amount, tendered))
    setEntry("")
    setError(null)
  }

  /**
   * `approval` is passed in rather than read from state because it arrives from
   * the keypad in the same tick this runs — state would still be the old value.
   */
  const confirm = (approval?: { managerId: string; pin: string }) => {
    setError(null)
    startTransition(async () => {
      // Built once and reused for the call and, if it comes to it, the queue.
      // The two must be byte-identical: a queued sale that differs from the one
      // already sent would replay the original under the same key.
      const payload = {
        shiftId,
        customerId,
        cashierId,
        discount: totals.saleDiscount,
        discounts: appliedDiscounts,
        items: lines.map((l) => ({
          variantId: l.variantId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discount: l.discount,
        })),
        payments,
        approval: approval ?? null,
        idempotencyKey: saleKey,
      }

      let result: Awaited<ReturnType<typeof completeSale>>
      try {
        result = await completeSale(payload)
      } catch {
        // No answer came back, so the sale may or may not have gone through.
        //
        // A sale that needed a manager is NOT queued. Approval is re-verified
        // before the RPC, so a replay would need the PIN again — which would
        // mean writing a manager's PIN to disk on a shared till, to buy
        // nothing. Those hold the cashier on the frozen screen instead.
        if (approval) {
          freezeForSettle()
          setError(null)
          return
        }

        // Otherwise queue it and let the cashier serve the next customer. The
        // queued attempt carries the same idempotency key, so if it did commit
        // the sync replays it rather than charging again.
        const queued = await enqueueSale({
          key: saleKey,
          payload,
          total: totals.total,
          itemCount: totals.itemCount,
        })
        if (queued) {
          await refreshQueue()
          clear()
          setDone({ change: changeDue(payments), queued: true })
          return
        }

        // The queue itself failed. Better to block one sale than to tell
        // somebody it is saved when it is not.
        freezeForSettle()
        setError(null)
        return
      }

      if (!result.ok) {
        // The server decides whether a manager is needed — the till only asks
        // when told to. A wrong PIN comes back here too, so the keypad stays up
        // with the reason rather than dumping the cashier back to the total.
        if (result.needsApproval) {
          setApprovalReason(result.error)
          return
        }
        if (result.uncertain) {
          freezeForSettle()
          setError(result.error)
          return
        }
        // A definite failure: the transaction rolled back, so nothing was
        // charged and the cashier can fix the problem and press Confirm again.
        setError(result.error)
        return
      }

      setApprovalReason(null)
      thawSettle()
      setSaleId(result.saleId)
      clear()
      setDone({ change: changeDue(payments), queued: false })
    })
  }

  if (done) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
        <div
          className={cn(
            "flex size-20 items-center justify-center rounded-full",
            done.queued
              ? "bg-warning-muted text-warning-foreground"
              : "bg-success-muted text-success",
          )}
        >
          {done.queued ? (
            <CloudOff className="size-10" aria-hidden />
          ) : (
            <Check className="size-10" aria-hidden />
          )}
        </div>
        <div>
          {/* Deliberately not "Sale complete" when it is queued. The cash is in
              the drawer and the goods have gone, so the sale is done from the
              customer's side — but the shop's records do not have it yet, and a
              cashier told "complete" would never think to check. */}
          <h2 className="font-heading text-2xl font-semibold">
            {done.queued ? "Saved — waiting for the line" : "Sale complete"}
          </h2>
          {done.change > 0 ? (
            <p className="mt-2 text-lg">
              Change due{" "}
              <span className="text-3xl font-semibold tabular-nums">
                {formatRs(done.change)}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground mt-2">No change due.</p>
          )}
          {done.queued ? (
            <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-sm">
              Take the money and hand the goods over as normal. This sale goes
              through on its own when the connection is back
              {queuedCount > 1 ? ` — ${queuedCount} are waiting` : ""}. No
              receipt until then.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {saleId ? (
            <Button
              variant="outline"
              className="h-14 px-8 text-base"
              // New tab so the print dialog never navigates the till away from
              // the sell screen mid-queue.
              render={<a href={`/pos/receipt/${saleId}`} target="_blank" rel="noreferrer" />}
            >
              <Printer aria-hidden />
              Print receipt
            </Button>
          ) : null}
          <Button className="h-14 px-10 text-base" onClick={onDone}>
            New sale
          </Button>
        </div>
      </div>
    )
  }

  /**
   * The sale was submitted and the till never learned the outcome.
   *
   * The two ways out are not equally safe, and the screen says so rather than
   * offering them as a pair of neutral buttons. Trying again replays the same
   * keyed attempt, so it can never charge twice. Abandoning cannot undo a sale
   * that did commit — it only stops asking — so it sends the cashier to look.
   */
  if (unresolved) {
    return (
      <div className="mx-auto flex h-full w-full max-w-md flex-col justify-center gap-6 p-6">
        <div className="text-center">
          <AlertTriangle
            className="text-warning-foreground mx-auto size-10"
            aria-hidden
          />
          <h2 className="mt-3 text-xl font-semibold">
            Couldn&rsquo;t confirm this sale
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            {formatRs(totals.total)} may or may not have gone through. The basket
            is locked so it cannot change underneath the attempt.
          </p>
          {error ? (
            <p className="text-muted-foreground mt-2 text-xs">{error}</p>
          ) : null}
        </div>

        <Button
          className="h-14 w-full text-base"
          disabled={isPending}
          onClick={() => confirm()}
        >
          {isPending ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden />
              Trying again…
            </>
          ) : (
            "Try again — this cannot charge twice"
          )}
        </Button>

        <div className="space-y-2 text-center">
          <Button
            variant="ghost"
            className="w-full"
            disabled={isPending}
            onClick={() => {
              // Only stops asking. If the sale did commit it is already in the
              // history, which is why the copy sends the cashier to look rather
              // than implying anything was cancelled. `clear()` thaws the
              // basket as part of ending the attempt.
              clear()
              onDone()
            }}
          >
            Give up and check Sales
          </Button>
          <p className="text-muted-foreground text-xs">
            Giving up does not cancel the sale. If it went through, it is in the
            sales list — refund it there.
          </p>
        </div>
      </div>
    )
  }

  // Takes over the whole panel rather than opening a dialog on top of it: the
  // manager needs to see what they are approving, and a modal over a modal on a
  // till is how people tap the wrong thing.
  if (approvalReason !== null) {
    return (
      <div className="mx-auto flex h-full w-full max-w-sm flex-col justify-center p-6">
        <div className="mb-6 text-center">
          <p className="text-muted-foreground text-sm">Total to pay</p>
          <p className="text-4xl font-semibold tabular-nums">
            {formatRs(totals.total)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm tabular-nums">
            Includes {formatRs(totals.saleDiscount)} off
          </p>
        </div>
        <ManagerApproval
          managers={managers}
          reason={approvalReason}
          pending={isPending}
          onApprove={(managerId, pin) => confirm({ managerId, pin })}
          onCancel={() => setApprovalReason(null)}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <section className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        <Button
          variant="ghost"
          className="self-start"
          onClick={onCancel}
          disabled={isPending}
        >
          <ArrowLeft aria-hidden />
          Back to cart
        </Button>

        <div className="text-center">
          <p className="text-muted-foreground text-sm">Total to pay</p>
          <p className="text-5xl font-semibold tabular-nums">
            {formatRs(totals.total)}
          </p>
          {paid > 0 ? (
            <p className="text-muted-foreground mt-2 text-sm tabular-nums">
              Paid {formatRs(paid)} · Outstanding {formatRs(outstanding)}
            </p>
          ) : null}
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>
              {error} Your cart is intact — press Confirm to try again.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {paymentMethods.map((m) => (
            <Button
              key={m}
              variant={method === m ? "default" : "outline"}
              className="h-control"
              onClick={() => setMethod(m)}
            >
              {METHOD_LABELS[m] ?? m}
            </Button>
          ))}
        </div>

        {/* One amount pad for every method. A blank entry means "take the rest",
            which is the common case; typing a smaller figure is what makes a
            split possible at all. */}
        <AmountPad
          method={method}
          outstanding={outstanding}
          entry={entry}
          entered={entered}
          onEntry={setEntry}
          onTake={(amount, tendered) => addPayment(amount, tendered)}
        />
      </section>

      <aside className="bg-card flex min-h-0 w-full flex-col border-t p-4 lg:w-96 lg:border-t-0 lg:border-l">
        <h2 className="font-medium">Payments</h2>

        <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {payments.length === 0 ? (
            <li className="text-muted-foreground text-sm">Nothing taken yet.</li>
          ) : (
            payments.map((payment, index) => (
              <li
                key={`${payment.method}-${index}`}
                className="flex items-center justify-between gap-2 rounded-md border p-2"
              >
                <div>
                  <div className="font-medium">
                    {METHOD_LABELS[payment.method] ?? payment.method}
                  </div>
                  {payment.tendered !== null ? (
                    <div className="text-muted-foreground text-xs tabular-nums">
                      Tendered {formatRs(payment.tendered)}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {formatRs(payment.amount)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      setPayments((c) => c.filter((_, i) => i !== index))
                    }
                    aria-label="Remove payment"
                    disabled={isPending}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            ))
          )}
        </ul>

        <div className="mt-3 space-y-2 border-t pt-3">
          <div className="text-muted-foreground flex justify-between text-sm">
            <span>Cashier</span>
            <span>{cashierName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Outstanding</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                outstanding > 0 ? "text-warning-foreground" : "text-success",
              )}
            >
              {formatRs(outstanding)}
            </span>
          </div>

          <Button
            className="h-14 w-full text-base"
            disabled={outstanding > 0 || payments.length === 0 || isPending}
            // Wrapped: passing `confirm` directly hands it the click event,
            // which it would read as an approval object.
            onClick={() => confirm()}
          >
            {isPending ? (
              <>
                <LoaderCircle className="animate-spin" aria-hidden />
                Completing…
              </>
            ) : (
              "Confirm sale"
            )}
          </Button>
        </div>
      </aside>
    </div>
  )
}

function AmountPad({
  method,
  outstanding,
  entry,
  entered,
  onEntry,
  onTake,
}: {
  method: PaymentMethod
  outstanding: number
  entry: string
  entered: number
  onEntry: (value: string) => void
  onTake: (amount: number, tendered: number | null) => void
}) {
  const isCash = method === "cash"
  // Blank entry = take the whole remainder. A typed figure is capped at the
  // outstanding, because anything beyond it is change, not revenue.
  const take = entry === "" ? outstanding : round2(Math.min(entered, outstanding))
  const change = isCash ? round2(Math.max(0, entered - outstanding)) : 0
  const quick = [outstanding, 100, 500, 1000].filter(
    (v, i, arr) => v > 0 && arr.indexOf(v) === i,
  )

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between rounded-lg border p-4">
        <span className="text-muted-foreground text-sm">
          {isCash ? "Cash received" : `Amount by ${METHOD_LABELS[method] ?? method}`}
        </span>
        <span className="text-3xl font-semibold tabular-nums">
          {entry === "" ? formatRs(outstanding) : formatRs(entered)}
        </span>
      </div>

      {isCash && entered > outstanding ? (
        <div className="bg-muted/40 flex items-baseline justify-between rounded-lg p-4">
          <span className="font-medium">CHANGE DUE</span>
          <span className="text-3xl font-semibold tabular-nums">
            {formatRs(change)}
          </span>
        </div>
      ) : null}

      {entry !== "" && entered < outstanding ? (
        <p className="text-muted-foreground text-sm">
          Part payment — {formatRs(round2(outstanding - entered))} will remain
          outstanding.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {quick.map((amount, index) => (
          <Button
            key={`${amount}-${index}`}
            variant="outline"
            className="h-control"
            onClick={() => onEntry(String(amount))}
          >
            {index === 0 ? `Exact ${formatRs(amount)}` : formatRs(amount)}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "←"].map((key) => (
          <Button
            key={key}
            variant="outline"
            className="h-14 text-lg"
            onClick={() => {
              if (key === "←") onEntry(entry.slice(0, -1))
              // Guard against a second decimal point, which would make the
              // whole entry unparseable.
              else if (key === "." && entry.includes(".")) return
              else onEntry(entry + key)
            }}
          >
            {key}
          </Button>
        ))}
      </div>

      <Button
        className="h-14 w-full text-base"
        // Enabled for any positive amount, not just one that clears the whole
        // balance — that restriction is what made splitting impossible.
        disabled={outstanding <= 0 || take <= 0}
        onClick={() => onTake(take, isCash ? (entry === "" ? take : entered) : null)}
      >
        Take {formatRs(take)} {isCash ? "cash" : `by ${METHOD_LABELS[method] ?? method}`}
      </Button>
    </div>
  )
}
