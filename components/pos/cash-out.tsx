"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Banknote } from "lucide-react"

import { cashOutRemotely } from "@/lib/pos/actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatRs } from "@/lib/format"
import type { TillDrawer } from "@/lib/pos/overview"

/**
 * Carfectionist's Cash out button — a disbursement recorded from the back
 * office against a till someone else is standing at.
 *
 * Amount and reason, nothing else. The reason is not decoration: it is the
 * only record of why cash left the drawer, it is what the Cash outflows table
 * and the traceability feed print, and the ledger it lands in is append-only —
 * a mistake is corrected with an opposite movement, never an edit.
 */
export function CashOut({ till, deviceName }: { till: TillDrawer; deviceName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const figure = Number(amount)
  const valid = Number.isFinite(figure) && figure > 0 && reason.trim().length >= 3

  async function confirm() {
    setError(null)
    setBusy(true)
    const result = await cashOutRemotely({
      shiftId: till.shiftId,
      amount: figure,
      reason: reason.trim(),
    })
    setBusy(false)
    if (result.ok) {
      setOpen(false)
      setAmount("")
      setReason("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Banknote aria-hidden />
        Cash out
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take cash out of {deviceName}</DialogTitle>
          <DialogDescription>
            Disbursement for small purchases. {formatRs(till.expected)} is in
            the drawer right now, and the ledger will refuse more than that.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cash-out-amount">Amount (Rs)</Label>
            <Input
              id="cash-out-amount"
              inputMode="decimal"
              placeholder="e.g. 190"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cash-out-reason">Reason</Label>
            <Input
              id="cash-out-reason"
              placeholder="e.g. gift wrap, cleaner, courier"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Shows in Cash outflows and the traceability trail.
            </p>
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy || !valid}>
            {busy ? "Recording…" : "Record cash out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
