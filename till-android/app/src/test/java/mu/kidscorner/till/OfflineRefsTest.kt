package mu.kidscorner.till

import mu.kidscorner.till.data.OfflineRefs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Provisional offline refs: never an `S...`, never colliding across tills.
 *
 * The till mints these with no line. The server still owns `SYYMMDD-N`
 * (gapless, transactional). An OFF ref that looked like an S number — or two
 * tills minting the same ref — would put duplicate paper in customers' hands
 * and a UNIQUE violation on sync, after the sale already left the counter.
 */
class OfflineRefsTest {

    @Test
    fun `format is CODE39-safe and zero-padded`() {
        assertEquals("OFF-07-260914-012", OfflineRefs.format("07", "260914", 12))
        assertEquals("OFF-00-260914-001", OfflineRefs.format("", "260914", 1))
    }

    @Test
    fun `device tag is two digits, unknown is 00`() {
        assertEquals("07", OfflineRefs.deviceTag(7))
        assertEquals("00", OfflineRefs.deviceTag(null))
        assertEquals("07", OfflineRefs.deviceTag(107))
    }

    @Test
    fun `provisional never parses as final and vice versa`() {
        assertTrue(OfflineRefs.isProvisional("OFF-07-260914-012"))
        assertFalse(OfflineRefs.isProvisional("S260914-12"))
        assertFalse(OfflineRefs.isProvisional(null))

        assertTrue(OfflineRefs.isFinalSaleNo("S260914-12"))
        assertFalse(OfflineRefs.isFinalSaleNo("OFF-07-260914-012"))
        assertFalse(OfflineRefs.isFinalSaleNo(null))
    }

    @Test
    fun `day formats as YYMMDD`() {
        assertEquals(
            "260914",
            OfflineRefs.dayOf(java.time.LocalDate.of(2026, 9, 14)),
        )
    }
}
