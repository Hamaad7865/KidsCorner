package mu.kidscorner.till

import mu.kidscorner.till.ui.tenderChips
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The notes a customer would actually hand over.
 *
 * The chips were a fixed 1,000 / 5,000, which for a Rs 2,408.10 basket offered
 * nothing anyone would do — and left out 2,410, which is what most people
 * would. These are derived from the bill instead.
 */
class TenderChipsTest {

    @Test
    fun `the reported basket gets the tenders a customer would use`() {
        // 2,408.10 → coins-and-change, two notes, three round thousand.
        assertEquals(listOf(2410.0, 2500.0, 3000.0), tenderChips(2408.10))
    }

    @Test
    fun `a small bill gets small notes, not a five thousand`() {
        assertEquals(listOf(90.0, 100.0, 500.0), tenderChips(82.50))
    }

    @Test
    fun `a bill already on a round ten skips that step rather than repeating it`() {
        // 80 IS the next ten, so it would duplicate Exact. The row moves up
        // to the notes that are actually different.
        assertEquals(listOf(100.0, 500.0, 1000.0), tenderChips(80.0))
    }

    @Test
    fun `an exact round bill offers only what is above it`() {
        // Exact already covers 500 itself, so it must not appear as a chip.
        val chips = tenderChips(500.0)
        assertTrue("500 was offered twice", chips.none { it == 500.0 })
        assertTrue("every chip must be above the bill", chips.all { it > 500.0 })
    }

    @Test
    fun `never more than three, so the row cannot wrap`() {
        listOf(1.0, 12.34, 507.72, 2408.10, 9999.99).forEach {
            assertTrue("too many chips for $it", tenderChips(it).size <= 3)
        }
    }

    @Test
    fun `nothing to tender against nothing`() {
        assertEquals(emptyList<Double>(), tenderChips(0.0))
        assertEquals(emptyList<Double>(), tenderChips(-5.0))
    }
}
