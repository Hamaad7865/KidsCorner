"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PowerOff } from "lucide-react"

import { closeShiftRemotely } from "@/lib/pos/actions"
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
import { formatRs, round2 } from "@/lib/format"
import type { OpenTill } from "@/lib/pos/overview"

/**
 * Carfectionist's "power off" — closing a till from the back office.
 *
 * The case it exists for is mundane and constant: the shop shuts, everyone goes
 * home, and nobody pressed Close on the tablet. Without this the shift stays
 * open, the next day's sales land inside it, and the Z covers two days.
 *
 * It asks for the counted cash rather than assuming, because a shift closed
 * with an invented figure is worse than one left open — it produces a variance
 * of exactly zero and quietly asserts the drawer was right.
 */
export function CloseTillRemotely({ till }: { till: OpenTill }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [entry, setEntry] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Blank means "the drawer matched" — the same shorthand the tablet uses.
  const counted = entry.trim() === "" ? till.expected : Number(entry)
  const valid = Number.isFinite(counted) && counted >= 0
  const variance = valid ? round2(counted - till.expected) : null

  async function confirm() {
    if (!valid) {
      setError("Enter the counted cash.")
      return
    }
    setError(null)
    setBusy(true)
    const result = await closeShiftRemotely({
      shiftId: till.shiftId,
      countedCash: counted,
      notes: notes.trim() || null,
    })
    setBusy(false)
    if (result.ok) {
      setOpen(false)
      setEntry("")
      setNotes("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PowerOff aria-hidden />
        Close the day
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close the till?</DialogTitle>
          <DialogDescription>
            Counts the drawer and closes this shift. The sales in it are not
            touched — the Z report is frozen from what the server already has.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/40 rounded-lg p-3">
              <div className="text-muted-foreground text-xs">Cash collected</div>
              <div className="mt-1 font-semibold tabular-nums">
                {formatRs(till.cashCollected)}
              </div>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <div className="text-muted-foreground text-xs">Expected in drawer</div>
              <div className="mt-1 font-semibold tabular-nums">
                {formatRs(till.expected)}
              </div>
              {/* Spelled out, because otherwise "collected 5,158 · expected
                  7,158" reads as a fault rather than as the float. */}
              <div className="text-muted-foreground mt-0.5 text-[11px]">
                incl. {formatRs(till.openingFloat)} float
                {till.tillMovements !== 0
                  ? ` · ${formatRs(till.tillMovements)} paid in/out`
                  : ""}
                {till.cashRefunded !== 0
                  ? ` · ${formatRs(till.cashRefunded)} refunded`
                  : ""}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="counted">Counted cash</Label>
            <Input
              id="counted"
              inputMode="decimal"
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder={`${formatRs(till.expected)} (expected)`}
              autoFocus
            />
          </div>

          {variance !== null ? (
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">
                Variance (counted − expected)
              </span>
              <span
                className={
                  variance === 0
                    ? "font-semibold tabular-nums text-emerald-600"
                    : variance < 0
                      ? "text-destructive font-semibold tabular-nums"
                      : "font-semibold tabular-nums text-amber-600"
                }
              >
                {formatRs(variance)}
              </span>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="close-notes">Note (optional)</Label>
            <Input
              id="close-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Closed from the back office — tablet left open"
            />
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? "Closing…" : "Close the till"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
