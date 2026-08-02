package mu.kidscorner.till.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException

/**
 * What this tablet remembers so it can open its own lock screen with no line.
 *
 * Before this, a cold start during an outage had nothing: `bootstrap` is the
 * only thing that fetches the roster, so its failure left the keypad with no
 * names to draw and no shop to sell from. The till sat on "could not reach the
 * till server" holding a sale queue nobody could add to.
 *
 * So the last bootstrap the server actually served is kept here whole — roster,
 * shop name, VAT rate, payment methods, verifiers — and the keypad checks a PIN
 * against [PinHasher] locally.
 *
 * THE SERVER'S WORD IS THE WHOLE TRUTH. Whatever the last roster said replaces
 * what was held, nulls included. Carfectionist's till had to reconcile three
 * ways, because it also minted verifiers itself and had to decide whose was
 * fresher. Nothing is minted here, so there is no second opinion to weigh: a
 * verifier that has gone null on the server — PIN cleared, login deactivated,
 * staff member gone — goes null here at the next sync, which is exactly the
 * revocation this design is for.
 *
 * ENCRYPTED, like [SessionStore] and for the same reason. A verifier is a hash
 * of four digits and a rooted tablet will get it either way; the Keystore stops
 * an ADB backup or a curious phone-shop from reading the shop's PINs off a
 * file. `allowBackup="false"` is the other half.
 */
@Suppress("DEPRECATION")
class OfflineGate(context: Context) {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /**
     * Built on first use, never at construction.
     *
     * Opening this costs a Keystore round trip and a file read, and this class
     * is constructed while the till is putting its first screen up. Every
     * caller below is already inside [Dispatchers.IO], so the cost lands
     * there rather than on the frame the shop is looking at.
     */
    private val prefs: SharedPreferences by lazy {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            // Its own file, not the session's: signing the device out must take
            // this with it, but locking the screen must not.
            "till-offline-gate",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /** Consecutive misses at the offline keypad, per staff member. */
    @Serializable
    private data class FailState(val fails: Int = 0, val lastFailAt: Long = 0)

    /** What the offline keypad can say back. */
    sealed interface Unlock {
        data class Ok(val cashier: Cashier) : Unlock
        data object WrongPin : Unlock
        data class Locked(val remainingMs: Long) : Unlock

        /**
         * There is nothing here to check this PIN against. Either the tablet
         * has never synced, or this person has no verifier — which the lock
         * screen can see coming and says on the tile, so reaching this is the
         * unusual case rather than the normal one.
         */
        data object Unknown : Unlock
    }

    // ------------------------------------------------------------ the shop

    /**
     * Remember a bootstrap the server actually served.
     *
     * Only ever called with a real response, so there is no "the server said
     * nothing" case to guard: a failed fetch never reaches here and what was
     * held stays held.
     */
    suspend fun remember(shop: Bootstrap) = io {
        prefs.edit()
            .putString(KEY_SHOP, json.encodeToString(shop))
            .putLong(KEY_SHOP_AT, System.currentTimeMillis())
            .apply()
    }

    /**
     * The last bootstrap, with a stale shift dropped.
     *
     * The shift is the one field that goes off. Everything else — the roster,
     * the VAT rate, what the shop is called — is as good this morning as it was
     * last night, but a drawer opened yesterday was closed at the end of the
     * day and a till coming up offline must not go on ringing into it. When the
     * cached shift was not opened today, the cashier lands on the float screen
     * and opens one, which is what they would have done anyway.
     *
     * The other direction is left alone: a shift that IS from today is offered,
     * even though the back office may have closed it since. The till finds that
     * out the moment the line returns, and sending somebody to count a float
     * for a drawer that is already open is the worse mistake.
     */
    suspend fun cachedShop(): Bootstrap? = io {
        val raw = prefs.getString(KEY_SHOP, null) ?: return@io null
        val shop = runCatching { json.decodeFromString<Bootstrap>(raw) }.getOrNull()
            ?: return@io null
        freshen(shop, LocalDate.now())
    }

    // ------------------------------------------------------------- the PIN

    /**
     * Check a PIN with nothing to ask.
     *
     * Throttled here because the database's counter is out of reach — see
     * [PinThrottle], which is honest about what that is worth.
     */
    suspend fun unlock(
        profileId: String,
        pin: String,
        nowMs: Long = System.currentTimeMillis(),
    ): Unlock = io {
        val cashier = cachedShop()?.cashiers?.firstOrNull { it.id == profileId }
        val fail = failStates()[profileId] ?: FailState()
        val outcome = decide(cashier, fail.fails, fail.lastFailAt, pin, nowMs)

        when (outcome) {
            is Unlock.Ok -> putFailStates(failStates() - profileId)
            Unlock.WrongPin ->
                putFailStates(failStates() + (profileId to FailState(fail.fails + 1, nowMs)))
            // A locked keypad does not advance the count — otherwise leaning on
            // a key during a lockout would extend it without a single guess
            // ever being checked. Nor does Unknown: there is nothing to guess.
            else -> Unit
        }
        outcome
    }

    /**
     * The server has spoken, so the local count is spent.
     *
     * Called on a successful ONLINE sign-in. Without it, five bad offline tries
     * would keep somebody waiting even after the line came back and the server
     * had already let them in.
     */
    suspend fun noteOnlineSuccess(profileId: String) = io {
        putFailStates(failStates() - profileId)
    }

    /**
     * The server refused a PIN that the held verifier accepts.
     *
     * That means the PIN was changed in the back office and this tablet has not
     * caught up. The server is the authority, so the stale verifier goes — the
     * old PIN must stop opening this till, and the next successful bootstrap
     * will bring the new one.
     */
    suspend fun noteServerRefusal(profileId: String, refusedPin: String) = io {
        val shop = cachedShop() ?: return@io
        val cashier = shop.cashiers.firstOrNull { it.id == profileId } ?: return@io
        if (!PinHasher.verify(refusedPin, cashier.verifier)) return@io // an ordinary typo

        remember(
            shop.copy(
                cashiers = shop.cashiers.map {
                    if (it.id == profileId) it.copy(verifier = null) else it
                },
            ),
        )
    }

    /** Signing the device out takes the shop's PINs with it. */
    suspend fun clear() = io { prefs.edit().clear().apply() }

    /**
     * Every read and write here opens an encrypted file and, the first time,
     * the Keystore. None of that belongs on the thread drawing the counter.
     */
    private suspend fun <T> io(block: suspend () -> T): T =
        withContext(Dispatchers.IO) { block() }

    // ---------------------------------------------------------------------

    private fun failStates(): Map<String, FailState> =
        prefs.getString(KEY_FAILS, null)
            ?.let { runCatching { json.decodeFromString<Map<String, FailState>>(it) }.getOrNull() }
            ?: emptyMap()

    private fun putFailStates(states: Map<String, FailState>) {
        prefs.edit().putString(KEY_FAILS, json.encodeToString(states)).apply()
    }

    /**
     * The two decisions this class makes, lifted out of the storage that holds
     * them so they can be tested without a device. Everything above is reading
     * and writing; everything here is the rule.
     */
    companion object {

        /**
         * A remembered bootstrap with a shift that is no longer today's taken
         * off it.
         *
         * A drawer opened yesterday was closed at the end of the day, and a
         * till coming up offline the next morning must not go on ringing into
         * it — every sale would name a shift that is shut, and the Z report
         * for yesterday has already been printed without them.
         *
         * A stamp that will not parse KEEPS the shift. "Cannot tell" is not
         * "not today", and the cost of guessing wrong in that direction is a
         * cashier sent to count a float for a drawer that is already open,
         * which ends in two shifts and a reconciliation nobody asked for.
         */
        fun freshen(shop: Bootstrap, today: LocalDate): Bootstrap {
            val opened = shop.shift?.openedAt ?: return shop
            val on = localDateOf(opened) ?: return shop
            return if (on == today) shop else shop.copy(shift = null)
        }

        /**
         * Who gets in, given what this tablet holds. No storage, no clock.
         *
         * Order matters and is the whole rule: somebody with no verifier is
         * Unknown before anything else is considered, so a name the till
         * cannot check never burns a throttle attempt; the lockout is read
         * before the PIN, so guessing during a lockout costs the guesser the
         * wait rather than a free check.
         */
        fun decide(
            cashier: Cashier?,
            fails: Int,
            lastFailAtMs: Long,
            pin: String,
            nowMs: Long,
        ): Unlock {
            val verifier = cashier?.verifier ?: return Unlock.Unknown

            val wait = PinThrottle.lockRemainingMs(fails, lastFailAtMs, nowMs)
            if (wait > 0) return Unlock.Locked(wait)

            return if (PinHasher.verify(pin, verifier)) {
                Unlock.Ok(cashier.withoutSecret())
            } else {
                Unlock.WrongPin
            }
        }

        private const val KEY_SHOP = "shop"
        private const val KEY_SHOP_AT = "shop_at"
        private const val KEY_FAILS = "fails"
    }
}

/**
 * The tablet's calendar date for a server timestamp.
 *
 * The device's own zone, which for this shop is Mauritius and for a tablet
 * bought elsewhere is whatever it was set to — the same assumption the rest of
 * the till already makes in [clockOf]. An unparseable stamp returns null, and
 * the caller treats that as "cannot tell", never as "not today".
 */
fun localDateOf(iso: String?): LocalDate? {
    if (iso.isNullOrBlank()) return null
    return try {
        Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()
    } catch (_: DateTimeParseException) {
        try {
            java.time.OffsetDateTime.parse(iso.replace(' ', 'T'))
                .atZoneSameInstant(ZoneId.systemDefault())
                .toLocalDate()
        } catch (_: DateTimeParseException) {
            null
        }
    }
}
