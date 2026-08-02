package mu.kidscorner.till.data

import java.security.MessageDigest
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Checking a PIN with no server in reach.
 *
 * The till's sale queue has always been able to park a sale through an outage.
 * What it could not do was let anybody IN — /api/till/pin is a network call, so
 * a cashier switch or an app restart mid-outage left the counter dead behind
 * its own keypad. This is the other half.
 *
 * VERIFY ONLY — this file cannot mint a verifier, and that is deliberate.
 * Carfectionist's till minted its own at each online sign-in, which meant a
 * verifier existed on a given tablet only for people who had signed in on THAT
 * tablet; a fresh device, or a cashier who had only ever used the other till,
 * was still locked out during an outage. Kids Corner takes the shape
 * Carfectionist ended up at: the server mints (lib/pos/device-verifier.ts) and
 * hands one to every till on the roster, so one sync admits everybody. With
 * nothing minted here there is also nothing to drift — the tablet holds
 * exactly what the server said and no locally-derived second opinion.
 *
 * A 4-digit PIN is 10,000 values, so the iteration count is not what makes
 * this safe; [PinThrottle] and a tablet that gets reported missing are. What
 * the verifier buys is that it is NOT `profiles.pin_code` — the value the
 * server authenticates against never reaches the device — and that clearing a
 * PIN in the back office revokes it at the next sync.
 */
object PinHasher {

    private const val ALGORITHM = "PBKDF2WithHmacSHA256"
    private const val KEY_BITS = 256

    /**
     * Constant-time verification against `pbkdf2:sha256:<iters>:<salt>:<dk>`.
     *
     * Anything malformed verifies nothing. That includes a `pin_code`, which
     * uses `$` separators for exactly this reason: if the wrong column ever
     * reached a tablet it would fail closed here rather than quietly work.
     */
    fun verify(pin: String, stored: String?): Boolean {
        if (stored.isNullOrBlank()) return false
        val parts = stored.split(":")
        if (parts.size != 5 || parts[0] != "pbkdf2" || parts[1] != "sha256") return false

        val iterations = parts[2].toIntOrNull() ?: return false
        if (iterations < 1) return false

        val decoder = Base64.getDecoder()
        val salt = runCatching { decoder.decode(parts[3]) }.getOrNull() ?: return false
        val expected = runCatching { decoder.decode(parts[4]) }.getOrNull() ?: return false
        if (salt.isEmpty() || expected.isEmpty()) return false

        return MessageDigest.isEqual(expected, derive(pin, salt, iterations))
    }

    private fun derive(pin: String, salt: ByteArray, iterations: Int): ByteArray =
        SecretKeyFactory.getInstance(ALGORITHM)
            .generateSecret(PBEKeySpec(pin.toCharArray(), salt, iterations, KEY_BITS))
            .encoded
}

/**
 * The keypad's brake, standing in for the server's lockout.
 *
 * `register_pin_attempt` lives in the database precisely so reinstalling the
 * app cannot reset it — and offline, that counter is out of reach. This one
 * can be reset by wiping the app, which is a real weakness and worth naming:
 * it is a speed bump for someone holding the tablet, not a wall. It is the
 * best available with no network, and the wall is still there the moment the
 * line comes back.
 *
 * Pure arithmetic over (consecutive fails, when the last one was) so it can be
 * tested with no clock and no storage.
 */
object PinThrottle {

    /** Misses before the keypad starts making somebody wait. */
    const val FREE_ATTEMPTS = 5

    private const val BASE_LOCK_MS = 60_000L
    private const val MAX_LOCK_MS = 15 * 60_000L

    /**
     * The same sentence the server sends, so a cashier who is locked out sees
     * one wording whether the shop's line is up or down. Mirrors
     * `waitMessage` in lib/pos/sale-core.ts — phrased for somebody standing at
     * a till with a customer waiting, in units a person counts in.
     */
    fun waitMessage(remainingMs: Long): String {
        val seconds = ((remainingMs + 999) / 1000).toInt()
        if (seconds < 60) return "Too many tries. Wait $seconds seconds."
        val minutes = (seconds + 59) / 60
        return "Too many tries. Wait $minutes minute${if (minutes == 1) "" else "s"}."
    }

    /** How much longer the keypad stays shut, or 0 when a try is allowed. */
    fun lockRemainingMs(fails: Int, lastFailAtMs: Long, nowMs: Long): Long {
        if (fails < FREE_ATTEMPTS) return 0
        // Capped before the shift so 2^n cannot run away into a negative.
        val exponent = (fails - FREE_ATTEMPTS).coerceIn(0, 20)
        val lock = (BASE_LOCK_MS shl exponent).coerceAtMost(MAX_LOCK_MS)
        // A tablet whose clock jumped backwards would otherwise lock the till
        // for however far it jumped. Clamped to the cap, not to the raw sum.
        return (lastFailAtMs + lock - nowMs).coerceIn(0, MAX_LOCK_MS)
    }
}
