package mu.kidscorner.till

import mu.kidscorner.till.data.VatDisplay
import mu.kidscorner.till.data.ZVatBand
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the live selling UI is allowed to SAY about VAT.
 *
 * The rule under test: while the shop is not registered, no basket or payment
 * label may carry a VAT, tax or exclusive-price word — but a historical report
 * still shows the VAT it actually took, because that is driven by frozen data
 * rather than the current setting.
 */
class VatUiPolicyTest {

    @Test
    fun `an enabled shop labels the contained VAT with its rate`() {
        val note = VatDisplay.sellVatNote(vatEnabled = true, effectiveRate = 0.15, vatAmount = 83.82)
        assertEquals("incl. VAT 15%  83.82", note)
    }

    @Test
    fun `a disabled shop shows no VAT note at all`() {
        // Null, not "VAT 0%": the line is removed from the basket footer.
        assertNull(VatDisplay.sellVatNote(vatEnabled = false, effectiveRate = 0.0, vatAmount = 0.0))
    }

    @Test
    fun `the payment breakdown's VAT row names the rate and the contained amount`() {
        val row = VatDisplay.paymentVatRow(vatEnabled = true, effectiveRate = 0.15, vatAmount = 83.82)
        assertEquals("VAT (15%) incl." to "83.82", row)
    }

    @Test
    fun `a disabled shop's payment breakdown has no VAT row at all`() {
        // Null, not a "VAT (0%)" row: the breakdown omits the line entirely.
        assertNull(VatDisplay.paymentVatRow(vatEnabled = false, effectiveRate = 0.0, vatAmount = 0.0))
    }

    @Test
    fun `the payment total is labelled inclusive of tax only when VAT is on`() {
        assertEquals("Total incl. tax", VatDisplay.paymentTotalLabel(vatEnabled = true))
        // Disabled: a plain "Total" with no tax or exclusive wording anywhere.
        val disabled = VatDisplay.paymentTotalLabel(vatEnabled = false)
        assertEquals("Total", disabled)
        assertFalse(disabled.lowercase().contains("vat"))
        assertFalse(disabled.lowercase().contains("tax"))
        assertFalse(disabled.lowercase().contains("excl"))
    }

    @Test
    fun `a mixed historical shift shows its frozen VAT bands even when now disabled`() {
        // The bands come from the frozen slip, so the current setting is
        // irrelevant: a shift closed while VAT was on keeps its bands afterwards.
        val bands = listOf(ZVatBand(rate = 0.15, label = "VAT 15%", excl = 200.0, vat = 30.0, incl = 230.0))
        assertTrue(VatDisplay.shiftVatVisible(bands))
    }

    @Test
    fun `a disabled-only shift with no bands shows no VAT section`() {
        assertFalse(VatDisplay.shiftVatVisible(emptyList()))
    }
}
