package mu.kidscorner.till

import mu.kidscorner.till.data.RecoveryBasket
import mu.kidscorner.till.data.RecoveryDiscount
import mu.kidscorner.till.data.RecoveryLine
import mu.kidscorner.till.data.decodeRecovery
import mu.kidscorner.till.data.encodeRecovery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The unsent-basket record, checked without a device.
 *
 * Storage itself is three SharedPreferences lines and needs a device; what is
 * defended here is the shape that crosses a process death — the attempt key
 * above all, because reviving under anything else would double-charge.
 */
class CartRecoveryTest {

    private fun basket() = RecoveryBasket(
        key = "attempt-1",
        lines = listOf(
            RecoveryLine(variantId = 322, qty = 2, discount = 10.0),
            RecoveryLine(variantId = -1, qty = 1, description = "Gift wrap", unitPrice = 50.0),
        ),
        customerId = 43,
        customerName = "Marie",
        discount = RecoveryDiscount(ruleId = 7, label = "Staff", kind = "percent", value = 10.0, amount = 68.0),
        note = "Birthday",
        savedAt = 1_700_000_000_000L,
    )

    @Test
    fun `a basket survives encoding with its attempt key intact`() {
        val revived = decodeRecovery(encodeRecovery(basket()))!!
        assertEquals("attempt-1", revived.key)
        assertEquals(2, revived.lines.size)
        assertEquals(322, revived.lines[0].variantId)
        assertEquals(2, revived.lines[0].qty)
        assertEquals("Gift wrap", revived.lines[1].description)
        assertEquals(43, revived.customerId)
        assertEquals(7, revived.discount?.ruleId)
        assertEquals("Birthday", revived.note)
    }

    @Test
    fun `garbage decodes to nothing, never to a half basket`() {
        assertNull(decodeRecovery(null))
        assertNull(decodeRecovery(""))
        assertNull(decodeRecovery("{not json"))
        assertNull(decodeRecovery("""{"key":"x","lines":[{"variantId":"nan"}]}"""))
    }

    @Test
    fun `an empty basket encodes as empty, so finishing clears the record`() {
        val revived = decodeRecovery(encodeRecovery(RecoveryBasket(key = "k")))!!
        assertEquals("k", revived.key)
        assertEquals(0, revived.lines.size)
    }
}
