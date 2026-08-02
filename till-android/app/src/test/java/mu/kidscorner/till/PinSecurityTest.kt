package mu.kidscorner.till

import mu.kidscorner.till.data.PinHasher
import mu.kidscorner.till.data.PinThrottle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The tablet's half of an agreement with the server.
 *
 * `lib/pos/device-verifier.ts` mints; this verifies. They are two
 * implementations of one format in two languages, and nothing in either build
 * would notice them drifting apart — so the vector below is checked on both
 * sides, and it is the one thing here that must not be changed alone.
 */
class PinSecurityTest {

    /**
     * Minted by node:crypto and asserted identically in device-verifier.test.ts.
     * If you change this, change it there.
     *
     * 1000 iterations rather than the 310,000 that ships. The vector is proving
     * that Kotlin and Node derive the same bytes — the salt encoding, the
     * 32-byte output, the UTF-8 of the PIN — and none of that depends on the
     * iteration count. What ships is pinned on the TypeScript side, where the
     * minting happens.
     */
    private val vector =
        "pbkdf2:sha256:1000:S2lkc0Nvcm5lclRpbGwhIQ==:AC4CSs7AfaJLrvK/10tjh3K/JebHyW4cydmO8KKHW8A="

    @Test
    fun `agrees with the server on a shared vector`() {
        assertTrue(PinHasher.verify("4271", vector))
        assertFalse(PinHasher.verify("4272", vector))
        assertFalse(PinHasher.verify("427", vector))
        assertFalse(PinHasher.verify("", vector))
    }

    @Test
    fun `refuses a pin_code, which is the other hash entirely`() {
        // profiles.pin_code — the value the SERVER authenticates against. The
        // formats differ by their separator precisely so that one arriving
        // here fails closed instead of quietly working.
        val serverHash = "pbkdf2\$100000\$S2lkc0Nvcm5lclRpbGwhIQ==\$AC4CSs7AfaJLrvK/10tjh3K/JebHyW4cydmO8KKHW8A="
        assertFalse(PinHasher.verify("4271", serverHash))
    }

    @Test
    fun `verifies nothing when there is nothing to verify against`() {
        listOf(
            null,
            "",
            "   ",
            "pbkdf2:sha256:0:AA==:AA==", // no work at all
            "pbkdf2:sha256:x:AA==:AA==", // iterations not a number
            "pbkdf2:sha512:1000:AA==:AA==", // a digest this does not implement
            "pbkdf2:sha256:1000::AA==", // no salt
            "pbkdf2:sha256:1000:AA==", // truncated
            "pbkdf2:sha256:1000:AA==:AA==:AA==", // one field too many
            "nonsense",
        ).forEach { assertFalse("accepted $it", PinHasher.verify("4271", it)) }
    }

    // ------------------------------------------------------------- throttle

    @Test
    fun `the first misses are free, then the wait doubles`() {
        val now = 1_000_000L
        // Under the free limit nothing locks — a cashier fat-fingering a digit
        // at a counter is the common case, not an attack.
        for (fails in 0 until PinThrottle.FREE_ATTEMPTS) {
            assertEquals(0L, PinThrottle.lockRemainingMs(fails, now, now))
        }
        assertEquals(60_000L, PinThrottle.lockRemainingMs(5, now, now))
        assertEquals(120_000L, PinThrottle.lockRemainingMs(6, now, now))
        assertEquals(240_000L, PinThrottle.lockRemainingMs(7, now, now))
    }

    @Test
    fun `the wait is capped, however many times somebody tries`() {
        val now = 1_000_000L
        val cap = 15 * 60_000L
        assertEquals(cap, PinThrottle.lockRemainingMs(9, now, now))
        assertEquals(cap, PinThrottle.lockRemainingMs(40, now, now))
        // Far enough past the shift to overflow a Long if it were not clamped.
        assertEquals(cap, PinThrottle.lockRemainingMs(1_000, now, now))
    }

    @Test
    fun `the wait runs down, and is over when it is over`() {
        val at = 1_000_000L
        assertEquals(60_000L, PinThrottle.lockRemainingMs(5, at, at))
        assertEquals(20_000L, PinThrottle.lockRemainingMs(5, at, at + 40_000))
        assertEquals(0L, PinThrottle.lockRemainingMs(5, at, at + 60_000))
        assertEquals(0L, PinThrottle.lockRemainingMs(5, at, at + 600_000))
    }

    @Test
    fun `a tablet whose clock jumped cannot lock the till for a year`() {
        // The counter is on the device and the clock is the device's, so a
        // wrong date is not hypothetical. Clamped to the cap, not to the raw
        // arithmetic, so the worst a bad clock costs the shop is 15 minutes.
        val lastFail = 1_000_000L
        val nowIsWayBehind = 0L
        assertEquals(
            15 * 60_000L,
            PinThrottle.lockRemainingMs(5, lastFail, nowIsWayBehind),
        )
    }

    @Test
    fun `says how long to wait the way the server says it`() {
        assertEquals("Too many tries. Wait 30 seconds.", PinThrottle.waitMessage(30_000))
        assertEquals("Too many tries. Wait 1 minute.", PinThrottle.waitMessage(60_000))
        assertEquals("Too many tries. Wait 2 minutes.", PinThrottle.waitMessage(61_000))
        assertEquals("Too many tries. Wait 15 minutes.", PinThrottle.waitMessage(15 * 60_000))
    }
}
