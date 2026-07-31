"use client"

import { useState } from "react"
import { Delete, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Cashier } from "@/lib/pos/sale-core"
import { cn } from "@/lib/utils"

/**
 * A manager authorising a discount at the till.
 *
 * Collected at payment rather than when the discount is applied, because the
 * server verifies this PIN against the *final* basket as part of committing the
 * sale. Approving earlier would mean approving a basket that can still change.
 *
 * The PIN is handed straight to `completeSale` and never stored — not in the
 * cart, not in component state beyond this keypad. There is deliberately no
 * "remember this approval": a manager standing at the till for one override is
 * the whole point of the control.
 */
export function ManagerApproval({
  managers,
  reason,
  onApprove,
  onCancel,
  pending,
}: {
  managers: Cashier[]
  /** Why approval is being asked for, in the server's own words. */
  reason: string
  onApprove: (managerId: string, pin: string) => void
  onCancel: () => void
  pending: boolean
}) {
  const [picked, setPicked] = useState<Cashier | null>(
    managers.length === 1 ? managers[0] : null,
  )
  const [pin, setPin] = useState("")

  const withPin = managers.filter((m) => m.hasPin)

  if (withPin.length === 0) {
    return (
      <div className="space-y-4 text-center">
        <ShieldCheck className="text-muted-foreground mx-auto size-8" aria-hidden />
        <p className="text-sm">
          This needs a manager, but no owner or manager has a PIN set. An owner
          sets them in Settings, under Staff PINs.
        </p>
        <Button variant="outline" className="w-full" onClick={onCancel}>
          Back
        </Button>
      </div>
    )
  }

  if (!picked) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground text-center text-sm">{reason}</p>
        <ul className="space-y-2">
          {withPin.map((manager) => (
            <li key={manager.id}>
              <button
                type="button"
                onClick={() => setPicked(manager)}
                className="hover:bg-accent flex min-h-tap w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
              >
                <span className="bg-brand-50 text-brand-700 flex size-10 shrink-0 items-center justify-center rounded-full font-medium">
                  {manager.fullName.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {manager.fullName}
                  </span>
                  <span className="text-muted-foreground block text-xs capitalize">
                    {manager.role}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="font-medium">{picked.fullName}</p>
        <p className="text-muted-foreground text-sm">{reason}</p>
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

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"].map(
          (key, i) =>
            key === "" ? (
              <span key={i} />
            ) : (
              <Button
                key={i}
                variant="outline"
                className="h-14 text-lg"
                disabled={pending}
                onClick={() => {
                  if (key === "back") {
                    setPin((p) => p.slice(0, -1))
                    return
                  }
                  const next = (pin + key).slice(0, 4)
                  setPin(next)
                  // Submits on the fourth digit, as everywhere else a PIN is
                  // typed here — one less thing to explain.
                  if (next.length === 4) {
                    onApprove(picked.id, next)
                    setPin("")
                  }
                }}
              >
                {key === "back" ? <Delete aria-hidden /> : key}
              </Button>
            ),
        )}
      </div>

      <div className="flex gap-2">
        {managers.length > 1 ? (
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => {
              setPicked(null)
              setPin("")
            }}
          >
            Someone else
          </Button>
        ) : null}
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
