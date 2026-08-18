package mu.kidscorner.till

import mu.kidscorner.till.print.CreditNoteDoc
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.buildCreditNote
import mu.kidscorner.till.print.toPlainText
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The printed credit note.
 *
 * Like the receipt it is checked without hardware: nothing exceeds the paper,
 * and — the part this feature adds — the document type and VAT wording follow
 * the credit note's OWN frozen snapshot, so a return prints correctly even when
 * the shop's current registration is the opposite of the sale's.
 */
class CreditNoteTest {

    private val shop = ShopIdentity(
        name = "Kids Corner",
        address = "Royal Road, Curepipe",
        phone = "5xxx xxxx",
        vatNumber = "VAT99999999",
    )

    private fun doc(
        vatEnabled: Boolean,
        vatNumber: String? = if (vatEnabled) "VAT20123456" else null,
        vatAmount: Double = if (vatEnabled) 32.61 else 0.0,
    ) = CreditNoteDoc(
        creditNo = "CN0001",
        saleNo = "S260729-60",
        dateIso = "2026-08-18T10:15:00.000Z",
        refundMethod = "cash",
        total = 250.0,
        vatEnabled = vatEnabled,
        vatRate = if (vatEnabled) 0.15 else 0.0,
        vatNumber = vatNumber,
        vatAmount = vatAmount,
        cashierName = "Marie",
    )

    @Test
    fun `no line ever exceeds the paper width`() {
        for (width in PaperWidth.entries) {
            for (enabled in listOf(true, false)) {
                val text = buildCreditNote(doc(enabled), shop, width).toPlainText(width)
                for (line in text.lines()) {
                    assertTrue("\"$line\" too wide on ${width.label}", line.length <= width.columns)
                }
            }
        }
    }

    @Test
    fun `a VAT sale's return prints a VAT credit note with the frozen number`() {
        // Even though the shop's current number is different, the note carries
        // its own frozen one — a return processed after the shop's registration
        // changed still reverses the original VAT.
        for (width in PaperWidth.entries) {
            val text = buildCreditNote(doc(vatEnabled = true), shop, width).toPlainText(width)
            assertTrue("no VAT CREDIT NOTE on ${width.label}", text.contains("VAT CREDIT NOTE"))
            assertTrue("frozen number missing on ${width.label}", text.contains("20123456"))
            assertFalse("adopted the shop's number on ${width.label}", text.contains("99999999"))
            assertTrue("VAT reversed missing on ${width.label}", text.contains("VAT reversed"))
            assertTrue("credit number missing on ${width.label}", text.contains("CN0001"))
        }
    }

    @Test
    fun `a non-VAT sale's return prints a plain credit note with no VAT wording`() {
        for (width in PaperWidth.entries) {
            val text = buildCreditNote(doc(vatEnabled = false), shop, width).toPlainText(width)
            assertTrue("no CREDIT NOTE on ${width.label}", text.contains("CREDIT NOTE"))
            assertFalse("says VAT CREDIT NOTE on ${width.label}", text.contains("VAT CREDIT NOTE"))
            assertFalse("leaked 'VAT' on ${width.label}", text.contains("VAT"))
            assertFalse("leaked 'tax' on ${width.label}", text.lowercase().contains("tax"))
            assertFalse("leaked 'excl' on ${width.label}", text.lowercase().contains("excl"))
            // The refund itself is still stated.
            assertTrue("refund missing on ${width.label}", text.contains("Refunded"))
            assertTrue("credit number missing on ${width.label}", text.contains("CN0001"))
        }
    }

    @Test
    fun `a reprint says so`() {
        val original = buildCreditNote(doc(true), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        val copy = buildCreditNote(doc(true), shop, PaperWidth.Mm80, reprint = true)
            .toPlainText(PaperWidth.Mm80)
        assertFalse(original.contains("REPRINT"))
        assertTrue(copy.contains("REPRINT"))
    }

    @Test
    fun `sample credit notes, for reading`() {
        for (enabled in listOf(true, false)) {
            println("\n--- ${if (enabled) "VAT" else "plain"} credit note ---")
            println(buildCreditNote(doc(enabled), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80))
        }
    }
}
