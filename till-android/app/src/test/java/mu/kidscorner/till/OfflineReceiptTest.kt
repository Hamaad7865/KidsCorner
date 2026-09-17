package mu.kidscorner.till

import mu.kidscorner.till.print.OfflineReceiptDiscountSnapshot
import mu.kidscorner.till.print.OfflineReceiptDoc
import mu.kidscorner.till.print.OfflineReceiptLineSnapshot
import mu.kidscorner.till.print.OfflineReceiptPaymentSnapshot
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.buildOfflineReceipt
import mu.kidscorner.till.print.decodeOfflineReceipt
import mu.kidscorner.till.print.encodeOfflineReceipt
import mu.kidscorner.till.print.toPlainText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The provisional offline paper, checked without a printer.
 *
 * Same bar as the final receipt (`ReceiptTest`): nothing exceeds the paper,
 * no figure is truncated. Plus the offline contract: bannered provisional,
 * numbered OFF (never S...), QR/barcode recall the OFF ref, snapshot round
 * trips so a reprint while still queued matches the original.
 */
class OfflineReceiptTest {

    private val shop = ShopIdentity(
        name = "Kids Corner",
        address = "Royal Road, Curepipe",
        phone = "5xxx xxxx",
        vatNumber = "VAT12345678",
    )

    private fun doc(
        ref: String = "OFF-07-260914-012",
        vatEnabled: Boolean = true,
    ) = OfflineReceiptDoc(
        provisionalRef = ref,
        saleKey = "a3f9c2e1-0000-4000-8000-000000000000",
        saleDateIso = "2026-09-14T10:00:00.000Z",
        cashierName = "Marie",
        customerName = null,
        note = null,
        lines = listOf(
            OfflineReceiptLineSnapshot(
                productName = "Cotton tee",
                sizeLabel = "3-6 mths",
                colourName = "Pink",
                sku = "CT-36-PK",
                qty = 2,
                unitPrice = 565.71,
                discount = 0.0,
                lineTotal = 1131.42,
            ),
        ),
        payments = listOf(
            OfflineReceiptPaymentSnapshot(method = "cash", amount = 1131.42, tendered = 1200.0),
        ),
        discounts = emptyList(),
        subtotal = 1131.42,
        total = 1131.42,
        vatAmount = 147.58,
        change = 68.58,
        vatEnabled = vatEnabled,
        vatNumber = "VAT12345678",
    )

    @Test
    fun `no line ever exceeds the paper width`() {
        for (width in PaperWidth.entries) {
            val text = buildOfflineReceipt(doc(), shop, width).toPlainText(width)
            for (line in text.lines()) {
                assertTrue(
                    "\"$line\" is ${line.length} chars on ${width.label} (${width.columns})",
                    line.length <= width.columns,
                )
            }
        }
    }

    @Test
    fun `bannered provisional and never an S number`() {
        val text = buildOfflineReceipt(doc(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("OFFLINE SALE — QUEUED"))
        assertTrue(text.contains("OFF-07-260914-012"))
        assertTrue(text.contains("PROVISIONAL"))
        assertTrue(text.contains("Final invoice follows when sent"))
        assertFalse(text.contains("No. S"))
    }

    @Test
    fun `change shows even offline — cashier still owes coins now`() {
        val text = buildOfflineReceipt(doc(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("68.58"))
    }

    @Test
    fun `disabled VAT prints plain with no VAT wording`() {
        val text = buildOfflineReceipt(doc(vatEnabled = false), shop, PaperWidth.Mm80)
            .toPlainText(PaperWidth.Mm80)
        assertFalse(text.contains("VAT"))
        assertFalse(text.contains("excl."))
    }

    @Test
    fun `snapshot round trips for queued reprint`() {
        val d = doc().copy(
            discounts = listOf(OfflineReceiptDiscountSnapshot("Staff", 50.0, null)),
        )
        assertEquals(d, decodeOfflineReceipt(encodeOfflineReceipt(d)))
    }

    @Test
    fun `recall code is the OFF ref`() {
        val text = buildOfflineReceipt(doc(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("[QR: OFF-07-260914-012]"))
        assertTrue(text.lines().any { it.trim() == "OFF-07-260914-012" })
    }

    @Test
    fun `a rounded offline sale names its rounding`() {
        // The provisional paper must foot the same way the final invoice will:
        // subtotal − discount + rounding = total, frozen at checkout.
        val rounded = doc().copy(subtotal = 1131.42, total = 1129.42, rounding = -2.0)
        for (width in PaperWidth.entries) {
            val text = buildOfflineReceipt(rounded, shop, width).toPlainText(width)
            assertTrue("no Rounding line on ${width.label}", text.contains("Rounding"))
            assertTrue("figure missing on ${width.label}", text.contains("-2.00"))
            for (line in text.lines()) {
                assertTrue(
                    "\"$line\" is ${line.length} chars on ${width.label} (${width.columns})",
                    line.length <= width.columns,
                )
            }
        }
    }

    @Test
    fun `an unrounded offline sale prints no rounding line`() {
        val text = buildOfflineReceipt(doc(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        assertFalse(text.contains("Rounding"))
    }
}
