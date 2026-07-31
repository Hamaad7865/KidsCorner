"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { Delete, LockKeyhole } from "lucide-react"

import { pinLockSeconds, switchCashier } from "@/lib/pos/actions"
import type { Cashier } from "@/lib/pos/sale-core"
import { useCart } from "@/lib/pos/cart-store"
import { initialsOf } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The till's front door.
 *
 * On a kiosk tablet the device stays signed into Supabase permanently, so this
 * — not an email form — is what a cashier meets. It covers the whole screen
 * until somebody has identified themselves, and comes back after a spell of
 * inactivity so a walked-away till cannot be used under the last person's name.
 *
 * Designed for staff who do not use computers: two actions, no typing, no
 * words they have to read to get through it. Tap the face, tap four digits.
 * The fourth digit submits on its own — no "OK" to find, and nothing on screen
 * that does not lead forward.
 *
 * The lockout it enforces is the database's, not this component's: a counter
 * here would reset every time the app restarted.
 */

/** Idle time before the till re-locks. Long enough to serve a slow customer. */
const IDLE_MS = 5 * 60 * 1000

export function TillLock({ cashiers }: { cashiers: Cashier[] }) {
  const cashierId = useCart((s) => s.cashierId)
  const setCashier = useCart((s) => s.setCashier)

  const [picked, setPicked] = useState<Cashier | null>(null)
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  const [shake, setShake] = useState(false)
  const [isPending, startTransition] = useTransition()

  const withPin = cashiers.filter((c) => c.hasPin)

  // A shop that has not set any PINs yet must not find its till bricked. Until
  // somebody has one, the gate stands aside and the session user owns the sale
  // — which is exactly how the till behaved before this screen existed. The
  // moment the first PIN is set, the door closes.
  const locked = cashierId === null && withPin.length > 0

  // Re-lock on inactivity. Any touch anywhere counts, so simply using the till
  // keeps it open — the timer only runs down when nobody is there.
  useEffect(() => {
    if (locked) return

    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setCashier(null, null), IDLE_MS)
    }

    const events = ["pointerdown", "keydown"] as const
    for (const event of events) window.addEventListener(event, reset)
    reset()

    return () => {
      clearTimeout(timer)
      for (const event of events) window.removeEventListener(event, reset)
    }
  }, [locked, setCashier])

  // Counts a lockout down so the keypad can say when, not just "too many".
  useEffect(() => {
    if (wait <= 0) return
    const timer = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000)
    return () => clearInterval(timer)
  }, [wait])

  const choose = useCallback(async (cashier: Cashier) => {
    setPicked(cashier)
    setPin("")
    setError(null)
    // Asked up front so somebody mid-lockout is told immediately, rather than
    // tapping four digits to be refused.
    setWait(await pinLockSeconds(cashier.id))
  }, [])

  const submit = (value: string) => {
    if (!picked || value.length !== 4) return
    startTransition(async () => {
      const result = await switchCashier(picked.id, value)
      if (!result.ok || !result.cashier) {
        setError(result.error ?? "Wrong PIN.")
        setWait(result.lockedFor ?? 0)
        setPin("")
        setShake(true)
        setTimeout(() => setShake(false), 400)
        return
      }
      setCashier(result.cashier.id, result.cashier.fullName)
      setPicked(null)
      setPin("")
      setError(null)
    })
  }

  if (!locked) return null

  return (
    <div className="bg-background fixed inset-0 z-50 flex flex-col items-center justify-center p-8">
      {!picked ? (
        <>
          <p className="text-muted-foreground mb-8 text-lg">Who is on the till?</p>
          {/* Centred wrap rather than a fixed grid. A shop with one or two
              staff is the common case here, and a grid leaves a lone tile
              stranded in the first column under a centred heading. */}
          <ul className="flex max-w-4xl flex-wrap justify-center gap-4">
            {withPin.map((cashier) => (
              <li key={cashier.id}>
                <button
                  type="button"
                  onClick={() => choose(cashier)}
                  className="hover:border-brand-500 hover:bg-accent bg-card flex w-48 flex-col items-center gap-3 rounded-2xl border p-6 transition-colors"
                >
                  <span className="bg-brand-50 text-brand-700 flex size-20 items-center justify-center rounded-full text-2xl font-medium">
                    {initialsOf(cashier.fullName)}
                  </span>
                  <span className="text-lg font-medium">
                    {cashier.fullName.split(" ")[0]}
                  </span>
                </button>
              </li>
            ))}
          </ul>

        </>
      ) : (
        <div className="w-full max-w-xs">
          <div className="mb-6 flex flex-col items-center gap-2">
            <span className="bg-brand-50 text-brand-700 flex size-16 items-center justify-center rounded-full text-xl font-medium">
              {initialsOf(picked.fullName)}
            </span>
            <p className="text-lg font-medium">{picked.fullName.split(" ")[0]}</p>
          </div>

          <div
            className={cn("mb-6 flex justify-center gap-4", shake && "animate-pulse")}
            aria-live="polite"
          >
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  "size-5 rounded-full border-2 transition-colors",
                  i < pin.length ? "bg-brand-600 border-brand-600" : "border-input",
                )}
              />
            ))}
          </div>

          {/* One line, one instruction. A locked-out cashier is told the wait
              in seconds so they can see it ticking rather than guess. */}
          {wait > 0 ? (
            <p className="text-destructive mb-4 flex items-center justify-center gap-2 text-center">
              <LockKeyhole className="size-4" aria-hidden />
              Wait {wait} second{wait === 1 ? "" : "s"}
            </p>
          ) : error ? (
            <p className="text-destructive mb-4 text-center">{error}</p>
          ) : null}

          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"].map(
              (key, i) =>
                key === "" ? (
                  <span key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    disabled={isPending || wait > 0}
                    onClick={() => {
                      setError(null)
                      if (key === "back") {
                        setPin((p) => p.slice(0, -1))
                        return
                      }
                      const next = (pin + key).slice(0, 4)
                      setPin(next)
                      // Submits itself on the fourth digit: there is no button
                      // to find, which is one less thing to teach.
                      if (next.length === 4) submit(next)
                    }}
                    className="bg-card hover:bg-accent flex h-16 items-center justify-center rounded-xl border text-2xl font-medium transition-colors active:scale-95 disabled:opacity-40"
                    aria-label={key === "back" ? "Delete" : key}
                  >
                    {key === "back" ? <Delete className="size-6" aria-hidden /> : key}
                  </button>
                ),
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setPicked(null)
              setPin("")
              setError(null)
              setWait(0)
            }}
            className="text-muted-foreground hover:text-foreground mt-6 h-12 w-full text-base"
          >
            Someone else
          </button>
        </div>
      )}
    </div>
  )
}
