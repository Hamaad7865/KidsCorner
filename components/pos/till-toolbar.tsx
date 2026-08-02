"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import {
  Delete,
  KeyRound,
  MoonStar,
  PauseCircle,
  Receipt,
  RefreshCw,
  WifiOff,
} from "lucide-react"

import { TillMovementDialog } from "@/components/pos/till-movement-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatRs } from "@/lib/format"
import { switchCashier } from "@/lib/pos/actions"
import type { Cashier } from "@/lib/pos/sale-core"
import { useCart } from "@/lib/pos/cart-store"
import { useSaleQueue } from "@/lib/pos/use-sale-queue"
import { cn } from "@/lib/utils"

/**
 * The till's chrome: who is ringing up, parked sales, and whether the network
 * is there. All three are things a cashier needs at a glance mid-queue.
 */
export function TillToolbar({
  cashiers,
  fallbackName,
  shiftId,
}: {
  cashiers: Cashier[]
  fallbackName: string
  /** The open shift, for the two controls that act on the drawer. */
  shiftId: number
}) {
  const [pinOpen, setPinOpen] = useState(false)
  const [heldOpen, setHeldOpen] = useState(false)
  const online = useOnline()
  const { pending: queued, syncing } = useSaleQueue()

  const cashierName = useCart((s) => s.cashierName)
  const held = useCart((s) => s.held)
  const lines = useCart((s) => s.lines)
  const holdSale = useCart((s) => s.holdSale)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Three states, because "offline" and "behind" are different problems.
          A queue that is still draining after the line is back is worth seeing;
          so is being offline with nothing waiting, which is merely awkward
          rather than money sitting unsent. */}
      {!online || queued > 0 ? (
        <Badge
          variant="outline"
          className="text-warning-foreground gap-1.5"
          title={
            queued > 0
              ? "Sales taken while the connection was down. They go through on their own."
              : undefined
          }
        >
          {syncing ? (
            <RefreshCw className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <WifiOff className="size-3.5" aria-hidden />
          )}
          {!online ? "Offline" : "Syncing"}
          {queued > 0 ? ` · ${queued} sale${queued === 1 ? "" : "s"} queued` : ""}
        </Badge>
      ) : null}

      <Button variant="outline" size="sm" onClick={() => setPinOpen(true)}>
        <KeyRound aria-hidden />
        {cashierName ?? fallbackName}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => holdSale(new Date().toLocaleTimeString("en-GB"))}
        disabled={lines.length === 0}
      >
        <PauseCircle aria-hidden />
        Hold
      </Button>

      <Button
        variant={held.length > 0 ? "secondary" : "outline"}
        size="sm"
        onClick={() => setHeldOpen(true)}
        disabled={held.length === 0}
      >
        Held
        {held.length > 0 ? <Badge variant="outline">{held.length}</Badge> : null}
      </Button>

      {/* A customer coming back for another receipt used to need a manager,
          because sales history lives in the back office and cashiers cannot
          reach it. */}
      <Button variant="outline" size="sm" render={<Link href="/pos/sales" />}>
        <Receipt aria-hidden />
        Past sales
      </Button>

      {/* These two were unreachable. Cash in/out and closing the drawer both
          live on /pos/shift, and nothing in the whole web till linked to it —
          a cashier could take money all day and then have no way to count it
          out short of typing the URL. The Android till has had both on its
          own footer since it was built. */}
      <TillMovementDialog shiftId={shiftId} size="sm" />

      <Button variant="outline" size="sm" render={<Link href="/pos/shift" />}>
        <MoonStar aria-hidden />
        End of day
      </Button>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Who&rsquo;s on the till?</DialogTitle>
            <DialogDescription>
              Every sale records the cashier who rang it up.
            </DialogDescription>
          </DialogHeader>
          <PinSwitcher cashiers={cashiers} onDone={() => setPinOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Held sales</DialogTitle>
            <DialogDescription>
              Parked on this device only. Resuming parks whatever is in the cart
              now, so nothing is lost.
            </DialogDescription>
          </DialogHeader>
          <HeldList onDone={() => setHeldOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Reflects real connectivity so the cashier knows before pressing Confirm. */
function useOnline(): boolean {
  // Starts true so the server render and first client render agree; the real
  // value is read in the effect below.
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  return online
}

function PinSwitcher({
  cashiers,
  onDone,
}: {
  cashiers: Cashier[]
  onDone: () => void
}) {
  const [picked, setPicked] = useState<Cashier | null>(null)
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const setCashier = useCart((s) => s.setCashier)

  const submit = (value: string) => {
    if (!picked || value.length !== 4) return
    startTransition(async () => {
      const result = await switchCashier(picked.id, value)
      if (!result.ok || !result.cashier) {
        setError(result.error ?? "Wrong PIN.")
        setPin("")
        return
      }
      setCashier(result.cashier.id, result.cashier.fullName)
      onDone()
    })
  }

  if (!picked) {
    return (
      <ul className="grid gap-2 sm:grid-cols-2">
        {cashiers.map((cashier) => (
          <li key={cashier.id}>
            <button
              type="button"
              onClick={() => {
                setPicked(cashier)
                setError(null)
                setPin("")
              }}
              disabled={!cashier.hasPin}
              className={cn(
                "hover:bg-accent flex min-h-tap w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                !cashier.hasPin && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="bg-brand-50 text-brand-700 flex size-10 shrink-0 items-center justify-center rounded-full font-medium">
                {cashier.fullName.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {cashier.fullName}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {cashier.hasPin ? cashier.role : "no PIN set"}
                </span>
              </span>
            </button>
          </li>
        ))}
        {cashiers.every((c) => !c.hasPin) ? (
          <li className="text-muted-foreground col-span-full text-sm">
            Nobody has a PIN yet. An owner sets them in Settings → Staff PINs.
          </li>
        ) : null}
      </ul>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="font-medium">{picked.fullName}</p>
        <p className="text-muted-foreground text-sm">Enter their 4-digit PIN</p>
      </div>

      <div className="flex justify-center gap-3" aria-live="polite">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "size-4 rounded-full border-2",
              i < pin.length ? "bg-brand-600 border-brand-600" : "border-input",
            )}
          />
        ))}
      </div>

      {error ? (
        <p className="text-destructive text-center text-sm">{error}</p>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "←"].map((key, i) =>
          key === "" ? (
            <span key={i} />
          ) : (
            <Button
              key={i}
              variant="outline"
              className="h-14 text-lg"
              disabled={isPending}
              onClick={() => {
                setError(null)
                if (key === "←") {
                  setPin((p) => p.slice(0, -1))
                  return
                }
                const next = (pin + key).slice(0, 4)
                setPin(next)
                // Submits itself on the fourth digit — no extra tap in a queue.
                if (next.length === 4) submit(next)
              }}
            >
              {key === "←" ? <Delete aria-hidden /> : key}
            </Button>
          ),
        )}
      </div>

      <Button variant="ghost" className="w-full" onClick={() => setPicked(null)}>
        Someone else
      </Button>
    </div>
  )
}

function HeldList({ onDone }: { onDone: () => void }) {
  const held = useCart((s) => s.held)
  const resumeSale = useCart((s) => s.resumeSale)
  const dropHeld = useCart((s) => s.dropHeld)

  if (held.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing is held.</p>
  }

  return (
    <ul className="space-y-2">
      {held.map((sale) => {
        const total = sale.lines.reduce(
          (sum, l) => sum + l.unitPrice * l.qty - l.discount,
          0,
        )
        return (
          <li
            key={sale.id}
            className="flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <div className="font-medium">{sale.label}</div>
              <div className="text-muted-foreground text-xs">
                {sale.lines.length} line{sale.lines.length === 1 ? "" : "s"} ·{" "}
                {formatRs(total)}
                {sale.customerName ? ` · ${sale.customerName}` : ""}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  resumeSale(sale.id)
                  onDone()
                }}
              >
                Resume
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dropHeld(sale.id)}
                aria-label={`Discard ${sale.label}`}
              >
                Discard
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
