package mu.kidscorner.till.data

import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import kotlinx.serialization.json.Json

/**
 * Sales the till could not confirm, held until it can.
 *
 * WHY THIS IS SAFE TO HAVE AT ALL.
 *
 * Queuing a sale whose outcome is unknown would normally be reckless — it may
 * already have committed, and sending it again would charge twice. It is only
 * safe because every attempt carries an idempotency key (migration 011): a
 * queued sale that already went through replays and returns the original id
 * rather than making a second one. The key is this table's primary key for
 * exactly that reason, so the same attempt cannot be enqueued twice either.
 *
 * WHAT IS DELIBERATELY NOT QUEUED.
 *
 * A sale that needed a manager's approval. Approval is re-verified server-side
 * before every commit, so a replay would need the PIN again — which would mean
 * writing a manager's PIN to disk on a shared till, to buy nothing. Those hold
 * the cashier on the frozen payment screen instead.
 */
@Entity(tableName = "queued_sales")
data class QueuedSale(
    /** The idempotency key. Primary key, so re-queuing an attempt is a no-op. */
    @PrimaryKey val key: String,
    /** The SaleRequest as JSON, frozen. Sent byte-identical on every retry. */
    val payload: String,
    val queuedAt: Long,
    val attempts: Int,
    val lastAttemptAt: Long? = null,
    val lastError: String? = null,
    /** Kept alongside so the queue can be shown without decoding the payload. */
    val total: Double,
    val itemCount: Int,
)

@Dao
interface SaleQueueDao {
    /**
     * IGNORE, not REPLACE.
     *
     * Re-queuing the same attempt after another failed retry must not reset its
     * `attempts` or `queuedAt` — that would restart the backoff and lose its
     * place in the drain order. The payload for a given key is by definition
     * the same sale, so there is nothing to update.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueue(sale: QueuedSale): Long

    /** Oldest first — a queue drained out of order applies stock out of order. */
    @Query("SELECT * FROM queued_sales ORDER BY queuedAt ASC")
    suspend fun all(): List<QueuedSale>

    @Query("SELECT COUNT(*) FROM queued_sales")
    suspend fun count(): Int

    /**
     * Sales the server has actually looked at and refused.
     *
     * Distinct from a sale still waiting on the line: this one will be refused
     * again on every retry, so nobody should be told to check the connection.
     * `attempts > 0 AND lastError IS NOT NULL` is the signal — a network
     * failure records an error too, so the caller reads the text to tell them
     * apart. Newest error first, which is the one worth reading.
     */
    @Query(
        """
        SELECT * FROM queued_sales
         WHERE lastError IS NOT NULL
         ORDER BY lastAttemptAt DESC
        """,
    )
    suspend fun failing(): List<QueuedSale>

    /** Called only once the server has confirmed the sale — including a replay. */
    @Query("DELETE FROM queued_sales WHERE `key` = :key")
    suspend fun remove(key: String)

    @Query(
        """
        UPDATE queued_sales
           SET attempts = attempts + 1, lastAttemptAt = :at, lastError = :error
         WHERE `key` = :key
        """,
    )
    suspend fun recordAttempt(key: String, at: Long, error: String?)
}

/**
 * How long to wait before trying a queued sale again.
 *
 * Backs off so a sale the server keeps rejecting — a discount rule deleted
 * mid-queue, say — does not spin against it every few seconds all afternoon,
 * while a sale waiting only on the line coming back still goes out promptly.
 */
fun retryDelayMs(attempts: Int): Long {
    if (attempts <= 1) return 0L
    // Clamped before the shift. Kotlin's `shl` takes its count modulo 64, so
    // `1L shl 68` is `1L shl 4` — at around 64 attempts the backoff would
    // silently collapse back to seconds and start hammering the server again.
    // Six doublings already reaches the cap, so anything beyond is the cap.
    val doublings = (attempts - 2).coerceIn(0, 20)
    return minOf(5 * 60_000L, 5_000L * (1L shl doublings))
}

/** Whether this queued sale is due another try. */
fun QueuedSale.isDue(now: Long = System.currentTimeMillis()): Boolean {
    val last = lastAttemptAt ?: return true
    return now - last >= retryDelayMs(attempts)
}

/**
 * Serialiser for the frozen payload.
 *
 * `encodeDefaults` is on so a field left at its default still appears in the
 * JSON. Without it a sale with no customer would serialise without the key, and
 * the replay would differ from the original request — harmless today, but the
 * whole point of this row is that it is sent verbatim.
 */
val queueJson = Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
}

/**
 * Whether a queued sale's last error was the line, rather than the server.
 *
 * The two need opposite advice at close of day: a sale waiting on the network
 * sends itself once the network is back, while one the server has refused will
 * be refused identically forever — and telling that cashier to check the
 * connection leaves them unable to close the till at all.
 *
 * Matched on the text because that is all the queue keeps. Deliberately
 * conservative: anything unrecognised is treated as a REFUSAL, so an unfamiliar
 * message escalates to a person instead of quietly implying "wait and it will
 * sort itself out" about money that is on a tablet and not in the books.
 */
fun String?.isNetworkish(): Boolean {
    val text = this?.lowercase() ?: return true
    return listOf(
        "could not reach",
        "timeout",
        "timed out",
        "unable to resolve",
        "failed to connect",
        "connection reset",
        "network is unreachable",
        "no route to host",
        "software caused connection abort",
    ).any { it in text }
}
