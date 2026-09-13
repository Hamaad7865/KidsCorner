package mu.kidscorner.till.data

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * The unsent basket, kept across a process death.
 *
 * WHY THIS EXISTS.
 *
 * The idempotency key, the basket and the frozen tender all lived in memory.
 * Kill the app after the server commits a sale but before its answer arrives
 * — a crash, a dead battery, the OS reclaiming a backgrounded till — and the
 * restart comes up with a fresh key and an empty basket. Nothing is queued,
 * because parking only happens on an *observed* failure, and nothing
 * reconciles on boot. The cashier re-rings the same basket under a new key
 * and the customer pays twice.
 *
 * So every cart mutation also writes this record: the attempt key plus just
 * enough to rebuild the basket for review. On the next start a non-empty
 * record is revived into the cart UNDER ITS ORIGINAL KEY and the cashier is
 * asked to review and Pay again. A retry then replays the same attempt — the
 * server's idempotency lookup runs before it validates anything, so a sale
 * that did commit answers with its original receipt instead of charging
 * again, and one that never committed simply commits.
 *
 * WHAT IS (AND IS NOT) IN HERE.
 *
 * Only the inputs a retry needs: variant ids and quantities, custom-line
 * text and prices, the customer, the discount's scalars, the note, the key.
 * Display fields (names, prices, stock) are re-read from the catalog at
 * revive time, because the shelf may have moved while the app was dead — and
 * the server re-prices everything at commit anyway, so a stale label here can
 * misinform for a moment but can never overcharge.
 *
 * Plain SharedPreferences, deliberately: a basket is not a secret, the file
 * is app-private, and allowBackup is false. The one thing that must never be
 * persisted here is any approval PIN — approvals are re-asked, never replayed.
 */
@Serializable
data class RecoveryLine(
    val variantId: Int,
    val qty: Int,
    val discount: Double = 0.0,
    /** Set only on custom lines: their whole identity, there is no product. */
    val description: String? = null,
    /** The cashier's word, custom lines only. */
    val unitPrice: Double = 0.0,
)

@Serializable
data class RecoveryDiscount(
    /** Null when the rule is gone or was never a rule: re-asked as a manager discount. */
    val ruleId: Int? = null,
    val label: String,
    val kind: String,
    val value: Double,
    val amount: Double,
)

@Serializable
data class RecoveryBasket(
    /** The attempt key. Reviving under anything else would double-charge. */
    val key: String,
    val lines: List<RecoveryLine> = emptyList(),
    val customerId: Int? = null,
    val customerName: String? = null,
    val discount: RecoveryDiscount? = null,
    val note: String = "",
    val savedAt: Long = 0L,
)

private val recoveryJson = Json { ignoreUnknownKeys = true }

/** Encode/decode kept pure so the round trip is testable without a device. */
fun encodeRecovery(basket: RecoveryBasket): String = recoveryJson.encodeToString(basket)

fun decodeRecovery(raw: String?): RecoveryBasket? {
    if (raw.isNullOrBlank()) return null
    return runCatching { recoveryJson.decodeFromString<RecoveryBasket>(raw) }.getOrNull()
}

class CartStore(context: Context) {
    private val prefs = context.getSharedPreferences("till-cart", Context.MODE_PRIVATE)

    fun save(basket: RecoveryBasket) {
        runCatching { prefs.edit().putString(KEY_BASKET, encodeRecovery(basket)).apply() }
    }

    fun load(): RecoveryBasket? = runCatching {
        decodeRecovery(prefs.getString(KEY_BASKET, null))
    }.getOrNull()

    fun clear() {
        runCatching { prefs.edit().remove(KEY_BASKET).apply() }
    }

    private companion object {
        const val KEY_BASKET = "basket"
    }
}
