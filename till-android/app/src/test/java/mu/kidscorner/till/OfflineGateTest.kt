package mu.kidscorner.till

import mu.kidscorner.till.data.Bootstrap
import mu.kidscorner.till.data.Cashier
import mu.kidscorner.till.data.DeviceInfo
import mu.kidscorner.till.data.OfflineGate
import mu.kidscorner.till.data.OpenShift
import mu.kidscorner.till.data.PinThrottle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * The two decisions the offline gate makes.
 *
 * Storage is not exercised here — that needs a device — so both rules were
 * lifted out of it and are checked as arithmetic. What is being defended is
 * the shape of the answer, not the file it came out of.
 */
class OfflineGateTest {

    private val verifier =
        "pbkdf2:sha256:1000:S2lkc0Nvcm5lclRpbGwhIQ==:AC4CSs7AfaJLrvK/10tjh3K/JebHyW4cydmO8KKHW8A="

    private fun priya(v: String? = verifier) =
        Cashier("s1", "Priya Ramdin", "owner", hasPin = true, verifier = v)

    private fun shopWithShiftOpenedAt(openedAt: String?) = Bootstrap(
        device = DeviceInfo("d1", "Till 1", "owner"),
        shopName = "Kids Corner",
        vatRate = 0.15,
        paymentMethods = listOf("cash"),
        shift = openedAt?.let { OpenShift(id = 42, openedAt = it, openingFloat = 1_000.0) },
        cashiers = listOf(priya()),
    )

    // ------------------------------------------------------------- the shift

    @Test
    fun `a shift opened today is still the shift`() {
        val shop = shopWithShiftOpenedAt("2026-08-03T05:12:00Z")
        val kept = OfflineGate.freshen(shop, LocalDate.parse("2026-08-03"))
        assertEquals(42, kept.shift?.id)
    }

    @Test
    fun `a till forgotten overnight does not trade on yesterday's drawer`() {
        // The one field on a cached bootstrap that goes off. Everything else —
        // the roster, the VAT rate — is as true this morning as it was last
        // night; a drawer is not.
        val shop = shopWithShiftOpenedAt("2026-08-02T05:12:00Z")
        val freshened = OfflineGate.freshen(shop, LocalDate.parse("2026-08-03"))
        assertNull(freshened.shift)
        // And nothing else is thrown away with it — the cashier still has a
        // roster to sign in against and a shop to sell from.
        assertEquals(1, freshened.cashiers.size)
        assertEquals("Kids Corner", freshened.shopName)
    }

    @Test
    fun `a stamp that will not parse keeps the shift`() {
        // "Cannot tell" is not "not today". Guessing the other way sends a
        // cashier to count a float for a drawer that is already open, which
        // ends in two shifts and a reconciliation nobody asked for.
        val shop = shopWithShiftOpenedAt("not a timestamp")
        assertNotNull(OfflineGate.freshen(shop, LocalDate.parse("2026-08-03")).shift)
    }

    @Test
    fun `no shift is simply no shift`() {
        assertNull(OfflineGate.freshen(shopWithShiftOpenedAt(null), LocalDate.now()).shift)
    }

    // --------------------------------------------------------------- the PIN

    @Test
    fun `the right PIN gets in, and brings no secret with it`() {
        val out = OfflineGate.decide(priya(), fails = 0, lastFailAtMs = 0, pin = "4271", nowMs = 1)
        assertTrue(out is OfflineGate.Unlock.Ok)
        // What lands in screen state is read by every composable on the till.
        assertNull((out as OfflineGate.Unlock.Ok).cashier.verifier)
        assertEquals("Priya Ramdin", out.cashier.fullName)
    }

    @Test
    fun `the wrong PIN does not`() {
        assertEquals(
            OfflineGate.Unlock.WrongPin,
            OfflineGate.decide(priya(), 0, 0, "9999", 1),
        )
    }

    @Test
    fun `somebody this till has never been told about cannot be admitted`() {
        // The server is still the only thing that can let a person in for the
        // first time. Offline this is a dead end by design, and the lock
        // screen greys the tile rather than waiting to say so at the keypad.
        assertEquals(
            OfflineGate.Unlock.Unknown,
            OfflineGate.decide(priya(v = null), 0, 0, "4271", 1),
        )
        assertEquals(
            OfflineGate.Unlock.Unknown,
            OfflineGate.decide(null, 0, 0, "4271", 1),
        )
    }

    @Test
    fun `a locked keypad refuses the right PIN too`() {
        val now = 1_000_000L
        val out = OfflineGate.decide(priya(), PinThrottle.FREE_ATTEMPTS, now, "4271", now)
        assertTrue(out is OfflineGate.Unlock.Locked)
        assertEquals(60_000L, (out as OfflineGate.Unlock.Locked).remainingMs)
    }

    @Test
    fun `no verifier beats the lockout, so a dead end costs no attempts`() {
        // Order matters: asked the other way round, tapping a name the till
        // cannot check would burn throttle attempts against a PIN that was
        // never going to be checked at all.
        val now = 1_000_000L
        assertEquals(
            OfflineGate.Unlock.Unknown,
            OfflineGate.decide(priya(v = null), 99, now, "4271", now),
        )
    }
}
