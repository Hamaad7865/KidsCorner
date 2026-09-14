package mu.kidscorner.till

import mu.kidscorner.till.ui.WedgeScanner
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The gun burst rules, checked without hardware.
 *
 * A wedge gun is just fast keystrokes plus Enter — so a burst is defined by
 * timing, not by focus. These pin the two behaviours the counter depends on:
 * a real burst always becomes exactly one code, and stray keys can never
 * glue themselves onto it or fire anything on their own.
 */
class WedgeScannerTest {

    /** Feeds one burst: chars 10ms apart, Enter at the end. */
    private fun burst(scanner: WedgeScanner, code: String, startAt: Long = 1_000L): String? {
        var done: String? = null
        code.forEachIndexed { i, c ->
            done = scanner.key(c.code, startAt + i * 10L)
        }
        return scanner.enter() ?: done
    }

    @Test
    fun `a burst plus terminator yields the code`() {
        val scanner = WedgeScanner()
        // Keys alone never complete anything…
        "6291041".forEachIndexed { i, c -> assertNull(scanner.key(c.code, 1_000L + i * 10L)) }
        // …the terminator does.
        assertEquals("6291041", scanner.enter())
    }

    @Test
    fun `a receipt code survives intact`() {
        assertEquals("S260915-1", burst(WedgeScanner(), "S260915-1"))
    }

    @Test
    fun `a lone terminator is noise, not a code`() {
        val scanner = WedgeScanner()
        assertNull(scanner.enter())
        scanner.key('A'.code, 1_000L)
        assertNull(scanner.enter())
    }

    @Test
    fun `a slow gap restarts the burst instead of gluing keys together`() {
        val scanner = WedgeScanner(interCharTimeoutMs = 150)
        // A stray unterminated fragment…
        scanner.key('9'.code, 1_000L)
        scanner.key('9'.code, 1_010L)
        // …then the real burst, much later: the fragment must not prefix it.
        "1234".forEachIndexed { i, c -> scanner.key(c.code, 11_000L + i * 10L) }
        assertEquals("1234", scanner.enter())
    }

    @Test
    fun `control characters are dropped`() {
        val scanner = WedgeScanner()
        assertNull(scanner.key(0, 1_000L))
        assertNull(scanner.key(31, 1_010L))
        assertNull(scanner.key(127, 1_020L))
        assertEquals("ABCD", burst(scanner, "ABCD", startAt = 1_030L))
    }

    @Test
    fun `backspace edits the burst`() {
        val scanner = WedgeScanner()
        "629104".forEachIndexed { i, c -> scanner.key(c.code, 1_000L + i * 10L) }
        scanner.backspace()
        assertEquals("62910", scanner.enter())
    }

    @Test
    fun `one scanner serves consecutive sales without residue`() {
        val scanner = WedgeScanner()
        assertEquals("629104100101", burst(scanner, "629104100101", startAt = 1_000L))
        assertEquals("629104100102", burst(scanner, "629104100102", startAt = 5_000L))
    }
}
