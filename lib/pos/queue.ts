/**
 * Durable queue for sales the till could not confirm.
 *
 * WHY THIS IS SAFE TO HAVE AT ALL.
 *
 * Queuing a sale whose outcome is unknown would normally be reckless — it may
 * already have committed, and sending it again would charge twice. It is only
 * safe because every attempt carries an idempotency key (migration 011): a
 * queued sale that already went through replays and returns the original id
 * rather than making a second one. The key is the queue's primary key here for
 * exactly that reason, so the same attempt can never be enqueued twice either.
 *
 * WHY IndexedDB AND NOT localStorage.
 *
 * These rows are money. localStorage is synchronous, roughly 5MB, and cleared
 * by "clear site data" alongside caches — the sort of thing someone does to a
 * misbehaving tablet. IndexedDB survives that better and is the store Android's
 * WebView persists most reliably.
 *
 * Everything here is browser-only and guards on `indexedDB` being present, so
 * importing it from a component that also renders on the server is harmless.
 */

const DB_NAME = "kids-corner-till"
const DB_VERSION = 1
const STORE = "queued-sales"

/** What a queued sale carries. `payload` is sent verbatim on every retry. */
export type QueuedSale = {
  /** The idempotency key. Primary key, so re-queuing an attempt is a no-op. */
  key: string
  /** Exactly what `completeSale` was called with, frozen at the time. */
  payload: unknown
  queuedAt: number
  attempts: number
  lastAttemptAt: number | null
  lastError: string | null
  /** Kept alongside so the queue can be shown without decoding the payload. */
  total: number
  itemCount: number
}

function available(): boolean {
  return typeof indexedDB !== "undefined"
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Could not open the till database"))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error("Till database write failed"))
      // A transaction can abort without the request itself erroring — quota,
      // or the store being closed underneath us.
      tx.onabort = () => reject(tx.error ?? new Error("Till database transaction aborted"))
    })
  } finally {
    db.close()
  }
}

/**
 * Adds a sale to the queue, or leaves an existing one alone.
 *
 * `put` rather than `add`: re-queuing the same attempt after another failed
 * retry must not throw, and the key means it overwrites itself rather than
 * accumulating duplicates of one sale.
 */
export async function enqueueSale(
  sale: Omit<QueuedSale, "queuedAt" | "attempts" | "lastAttemptAt" | "lastError">,
): Promise<boolean> {
  if (!available()) return false
  try {
    const existing = await withStore<QueuedSale | undefined>("readonly", (s) =>
      s.get(sale.key) as IDBRequest<QueuedSale | undefined>,
    )
    await withStore("readwrite", (s) =>
      s.put({
        ...sale,
        queuedAt: existing?.queuedAt ?? Date.now(),
        attempts: existing?.attempts ?? 0,
        lastAttemptAt: existing?.lastAttemptAt ?? null,
        lastError: existing?.lastError ?? null,
      } satisfies QueuedSale),
    )
    return true
  } catch {
    // Reported as a failure so the caller can fall back to holding the cashier
    // on screen rather than silently losing a sale it thinks it saved.
    return false
  }
}

/** Oldest first — a queue drained out of order would apply stock out of order. */
export async function listQueuedSales(): Promise<QueuedSale[]> {
  if (!available()) return []
  try {
    const all = await withStore<QueuedSale[]>("readonly", (s) =>
      s.getAll() as IDBRequest<QueuedSale[]>,
    )
    return all.sort((a, b) => a.queuedAt - b.queuedAt)
  } catch {
    return []
  }
}

export async function countQueuedSales(): Promise<number> {
  if (!available()) return 0
  try {
    return await withStore<number>("readonly", (s) => s.count())
  } catch {
    return 0
  }
}

/** Called only once the server has confirmed the sale — including a replay. */
export async function removeQueuedSale(key: string): Promise<void> {
  if (!available()) return
  try {
    await withStore("readwrite", (s) => s.delete(key))
  } catch {
    // Left in the queue. The next drain replays it, which the key makes safe.
  }
}

/** Records a failed drain so the till can show why, and stop hammering. */
export async function recordAttempt(key: string, error: string | null): Promise<void> {
  if (!available()) return
  try {
    const existing = await withStore<QueuedSale | undefined>("readonly", (s) =>
      s.get(key) as IDBRequest<QueuedSale | undefined>,
    )
    if (!existing) return
    await withStore("readwrite", (s) =>
      s.put({
        ...existing,
        attempts: existing.attempts + 1,
        lastAttemptAt: Date.now(),
        lastError: error,
      } satisfies QueuedSale),
    )
  } catch {
    // Not worth failing a drain over.
  }
}

/**
 * How long to wait before trying a queued sale again.
 *
 * Backs off so a sale the server keeps rejecting — a discount rule deleted
 * mid-queue, say — does not spin against it every few seconds all afternoon,
 * while a sale waiting only on the line coming back still goes out promptly.
 */
export function retryDelayMs(attempts: number): number {
  if (attempts <= 1) return 0
  return Math.min(5 * 60_000, 5_000 * 2 ** (attempts - 2))
}

/** Whether this queued sale is due another try. */
export function isDue(sale: QueuedSale, now = Date.now()): boolean {
  if (sale.lastAttemptAt === null) return true
  return now - sale.lastAttemptAt >= retryDelayMs(sale.attempts)
}
