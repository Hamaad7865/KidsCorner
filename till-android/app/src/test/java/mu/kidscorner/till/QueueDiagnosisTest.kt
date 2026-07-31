package mu.kidscorner.till

import mu.kidscorner.till.data.isNetworkish
import mu.kidscorner.till.data.retryDelayMs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Telling "the line is down" apart from "the server said no".
 *
 * These decide what a cashier is told when the till will not close. Get it
 * wrong in the safe direction and somebody checks a router needlessly; get it
 * wrong in the other and they are told to wait for a connection that is
 * already fine, while the day's takings sit on a tablet and never reach the
 * books.
 */
class QueueDiagnosisTest {

    @Test
    fun `transport failures read as the line being down`() {
        for (message in listOf(
            "Could not reach the till server.",
            "Failed to connect to /10.0.2.2:3001",
            "timeout",
            "Connection reset by peer",
            "Unable to resolve host \"shop.local\"",
            "Software caused connection abort",
        )) {
            assertTrue("should be networkish: $message", message.isNetworkish())
        }
    }

    @Test
    fun `a refusal from the server is not the line`() {
        for (message in listOf(
            "Only 1 of Cotton romper is left in stock.",
            "Staff discount cannot be used: it expired on 30 June.",
            "An item in the cart no longer exists. Clear it and rescan.",
            "This queued sale could not be read.",
        )) {
            assertFalse("should NOT be networkish: $message", message.isNetworkish())
        }
    }

    @Test
    fun `an unrecognised message escalates rather than telling someone to wait`() {
        // Conservative on purpose: an unfamiliar error is treated as a refusal
        // so it reaches a person, instead of implying it will clear by itself.
        assertFalse("something nobody has seen before".isNetworkish())
    }

    @Test
    fun `no error yet means nothing has refused it`() {
        assertTrue((null as String?).isNetworkish())
    }

    @Test
    fun `backoff climbs then holds at five minutes`() {
        assertEquals(0L, retryDelayMs(0))
        assertEquals(0L, retryDelayMs(1))
        assertEquals(5_000L, retryDelayMs(2))
        assertEquals(10_000L, retryDelayMs(3))
        assertEquals(5 * 60_000L, retryDelayMs(20))
        // The shl-modulo-64 trap: at ~64 attempts an unclamped shift wraps and
        // the backoff collapses back to seconds. It must stay at the cap.
        assertEquals(5 * 60_000L, retryDelayMs(70))
        assertEquals(5 * 60_000L, retryDelayMs(1_000))
    }
}
