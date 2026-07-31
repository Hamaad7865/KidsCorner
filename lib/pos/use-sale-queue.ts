"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { completeSale } from "@/lib/pos/actions"
import {
  countQueuedSales,
  isDue,
  listQueuedSales,
  recordAttempt,
  removeQueuedSale,
  type QueuedSale,
} from "@/lib/pos/queue"

/**
 * Drains the queue of unconfirmed sales.
 *
 * Sales go out ONE AT A TIME and strictly oldest first. Firing them in parallel
 * would be faster and wrong: two queued sales for the last of a variant would
 * race, and the stock floor would reject whichever lost — which is correct, but
 * the shop wants the earlier customer to win, not an arbitrary one.
 *
 * A drain never throws. It is background work happening while a cashier serves
 * the next customer, and an unhandled rejection there would be invisible.
 */
export function useSaleQueue() {
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  // Guards against two drains overlapping — the online event and the interval
  // can fire together, and both would then send the same sale.
  const draining = useRef(false)

  const refresh = useCallback(async () => {
    setPending(await countQueuedSales())
  }, [])

  const drain = useCallback(async () => {
    if (draining.current) return
    draining.current = true

    try {
      // Read before touching state, deliberately. Every state update here then
      // lands after an await rather than synchronously inside the effect that
      // kicked the first drain off — and there is no point flashing "syncing"
      // on a till with nothing waiting.
      const queued = await listQueuedSales()
      setPending(queued.length)
      if (queued.length === 0) return
      if (typeof navigator !== "undefined" && !navigator.onLine) return

      setSyncing(true)
      for (const sale of queued) {
        if (!isDue(sale)) continue
        if (typeof navigator !== "undefined" && !navigator.onLine) break

        let result: Awaited<ReturnType<typeof completeSale>> | null = null
        try {
          result = await completeSale(
            sale.payload as Parameters<typeof completeSale>[0],
          )
        } catch (cause) {
          // Still no line. Left in place, untouched, for the next drain.
          await recordAttempt(
            sale.key,
            cause instanceof Error ? cause.message : "No connection",
          )
          break
        }

        if (result.ok) {
          // Includes the replay case: the server recognised the key and handed
          // back the sale it already made. Either way this one is settled.
          await removeQueuedSale(sale.key)
          setLastError(null)
          continue
        }

        if (result.uncertain) {
          await recordAttempt(sale.key, result.error)
          break
        }

        // A definite refusal — the stock went, a discount rule was deleted, the
        // shift closed. Retrying will not change it, so it stays queued with the
        // reason showing rather than being dropped: somebody has to decide what
        // happens to a sale the shop already took money for.
        await recordAttempt(sale.key, result.error)
        setLastError(result.error)
      }
    } finally {
      draining.current = false
      setSyncing(false)
      await refresh()
    }
  }, [refresh])

  useEffect(() => {
    // `drain` reads the queue before it sets anything, and reports the count on
    // the way through, so it doubles as the initial load.
    void drain()

    const onOnline = () => void drain()
    window.addEventListener("online", onOnline)

    // Also on a timer: `online` fires for the network interface coming back,
    // which is not the same as the server being reachable again.
    const timer = setInterval(() => void drain(), 30_000)

    return () => {
      window.removeEventListener("online", onOnline)
      clearInterval(timer)
    }
  }, [drain])

  return { pending, syncing, lastError, drain, refresh }
}

export type { QueuedSale }
