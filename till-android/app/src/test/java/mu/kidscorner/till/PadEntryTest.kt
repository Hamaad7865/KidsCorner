package mu.kidscorner.till

import mu.kidscorner.till.ui.appendPadKey
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The keypad now feeds three screens — cash tendered, the opening float and the
 * drawer count. All three are money someone types under time pressure, and all
 * three post a figure that has to reconcile, so the rules for what a keystroke
 * does live in one function and are pinned here.
 */
class PadEntryTest {

    @Test
    fun `digits accumulate`() {
        assertEquals("1", "".appendPadKey("1"))
        assertEquals("12", "1".appendPadKey("2"))
        assertEquals("1250", "125".appendPadKey("0"))
    }

    @Test
    fun `a leading zero is replaced, not built on`() {
        // The well shows "0" when empty; typing 5 means 5, never 05.
        assertEquals("5", "0".appendPadKey("5"))
    }

    @Test
    fun `the decimal point opens the cents`() {
        assertEquals("0.", "".appendPadKey("."))
        assertEquals("565.", "565".appendPadKey("."))
        assertEquals("565.7", "565.".appendPadKey("7"))
        assertEquals("565.71", "565.7".appendPadKey("1"))
    }

    @Test
    fun `a second point is ignored`() {
        assertEquals("565.7", "565.7".appendPadKey("."))
    }

    @Test
    fun `cents stop at two`() {
        // Rs 565.719 is not a thing the drawer can hold.
        assertEquals("565.71", "565.71".appendPadKey("9"))
    }

    @Test
    fun `length is capped`() {
        assertEquals("1234567890", "1234567890".appendPadKey("1"))
        assertEquals("12345678901", "1234567890".appendPadKey("1", maxLength = 12))
    }

    @Test
    fun `the cap does not block finishing the cents`() {
        // A 10-char cap must not leave someone stuck at "12345678.9" — the
        // second decimal is inside the cap here, so it lands.
        assertEquals("1234567.89", "1234567.8".appendPadKey("9"))
    }
}
