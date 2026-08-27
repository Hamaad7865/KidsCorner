package mu.kidscorner.till

import mu.kidscorner.till.print.ExchangeReceiptDoc
import mu.kidscorner.till.print.ExchangeReceiptLine
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.buildExchangeReceipt
import mu.kidscorner.till.print.toPlainText
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The printed exchange receipt.
 *
 * An exchange is a return AND a sale in one breath, and its receipt has to tell
 * that whole story — what came back, what went out, the credit against the new
 * goods, and the single gap the customer settled. The raw new-sale receipt
 * cannot: its total is the full replacement price, which hides the credit and
 * reads as a mistake when the shop is handing money back.
 *
 * Checked without hardware, like the other documents: nothing exceeds the paper,
 * a refund never prints as a bare negative, and the settlement wording follows
 * the direction the gap actually ran.
 */
class ExchangeReceiptTest {

    private val shop = ShopIdentity(
        name = "Kids Corner",
        address = "Royal Road, Curepipe",
        phone = "5xxx xxxx",
        vatNumber = "VAT99999999",
    )

    private fun doc(
        creditTotal: Double,
        newGoodsTotal: Double,
        gap: Double,
        vatEnabled: Boolean = false,
    ) = ExchangeReceiptDoc(
        newSaleNo = "S260827-3",
        originalSaleNo = "S260826-13",
        dateIso = "2026-08-27T00:41:00.000Z",
        returned = listOf(ExchangeReceiptLine("1  Canvas sandals Pink EU 24", creditTotal)),
        replacements = listOf(ExchangeReceiptLine("1  Woolly beanie Red S", newGoodsTotal)),
        creditTotal = creditTotal,
        newGoodsTotal = newGoodsTotal,
        gap = gap,
        settlementMethod = "cash",
        vatEnabled = vatEnabled,
        vatRate = if (vatEnabled) 0.15 else 0.0,
        vatNumber = if (vatEnabled) "VAT20123456" else null,
        vatAmount = if (vatEnabled) 19.57 else 0.0,
        cashierName = "Marie",
    )

    @Test
    fun `no line ever exceeds the paper width`() {
        val docs = listOf(
            doc(creditTotal = 300.0, newGoodsTotal = 150.0, gap = -150.0),
            doc(creditTotal = 200.0, newGoodsTotal = 250.0, gap = 50.0),
            doc(creditTotal = 200.0, newGoodsTotal = 200.0, gap = 0.0),
            doc(creditTotal = 300.0, newGoodsTotal = 150.0, gap = -150.0, vatEnabled = true),
        )
        for (width in PaperWidth.entries) {
            for (d in docs) {
                val text = buildExchangeReceipt(d, shop, width).toPlainText(width)
                for (line in text.lines()) {
                    assertTrue("\"$line\" too wide on ${width.label}", line.length <= width.columns)
                }
            }
        }
    }

    @Test
    fun `a trade-down prints the exchange story and a refund, never a bare negative`() {
        for (width in PaperWidth.entries) {
            val text = buildExchangeReceipt(
                doc(creditTotal = 300.0, newGoodsTotal = 150.0, gap = -150.0),
                shop,
                width,
            ).toPlainText(width)

            assertTrue("no EXCHANGE title on ${width.label}", text.contains("EXCHANGE"))
            assertTrue("new sale number missing on ${width.label}", text.contains("S260827-3"))
            assertTrue("original sale not named on ${width.label}", text.contains("S260826-13"))
            assertTrue("no RETURNED section on ${width.label}", text.contains("RETURNED"))
            assertTrue("no NEW section on ${width.label}", text.contains("NEW"))
            assertTrue("returned goods missing on ${width.label}", text.contains("Canvas sandals"))
            assertTrue("new goods missing on ${width.label}", text.contains("Woolly beanie"))
            assertTrue("no Credit subtotal on ${width.label}", text.contains("Credit"))
            assertTrue("no New goods subtotal on ${width.label}", text.contains("New goods"))
            assertTrue("refund not stated on ${width.label}", text.contains("REFUND"))
            assertTrue("refund amount missing on ${width.label}", text.contains("150.00"))
            assertFalse("printed a bare negative on ${width.label}", text.contains("-150"))
        }
    }

    @Test
    fun `a trade-up prints what the customer paid, not a refund`() {
        val text = buildExchangeReceipt(
            doc(creditTotal = 200.0, newGoodsTotal = 250.0, gap = 50.0),
            shop,
            PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)

        assertTrue("customer payment not stated", text.contains("PAID"))
        assertTrue("gap amount missing", text.contains("50.00"))
        assertFalse("a trade-up must not say REFUND", text.contains("REFUND"))
    }

    @Test
    fun `an even swap says so and settles nothing`() {
        val text = buildExchangeReceipt(
            doc(creditTotal = 200.0, newGoodsTotal = 200.0, gap = 0.0),
            shop,
            PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)

        assertTrue("even swap not stated", text.contains("EVEN SWAP"))
        assertFalse("an even swap must not say REFUND", text.contains("REFUND"))
        assertFalse("an even swap must not say PAID", text.contains("PAID"))
    }

    @Test
    fun `VAT wording appears only on a VAT exchange, with the frozen number`() {
        for (width in PaperWidth.entries) {
            val vat = buildExchangeReceipt(
                doc(creditTotal = 300.0, newGoodsTotal = 150.0, gap = -150.0, vatEnabled = true),
                shop,
                width,
            ).toPlainText(width)
            assertTrue("VAT exchange missing VAT wording on ${width.label}", vat.contains("VAT"))
            assertTrue("frozen number missing on ${width.label}", vat.contains("20123456"))
            assertFalse("adopted the shop's number on ${width.label}", vat.contains("99999999"))

            val plain = buildExchangeReceipt(
                doc(creditTotal = 300.0, newGoodsTotal = 150.0, gap = -150.0, vatEnabled = false),
                shop,
                width,
            ).toPlainText(width)
            assertFalse("leaked 'VAT' on a plain exchange on ${width.label}", plain.contains("VAT"))
            assertFalse("leaked 'tax' on a plain exchange on ${width.label}", plain.lowercase().contains("tax"))
        }
    }

    @Test
    fun `sample exchange receipts, for reading`() {
        val cases = listOf(
            "trade-down (refund)" to doc(creditTotal = 300.0, newGoodsTotal = 150.0, gap = -150.0),
            "trade-up (customer pays)" to doc(creditTotal = 200.0, newGoodsTotal = 250.0, gap = 50.0),
            "even swap" to doc(creditTotal = 200.0, newGoodsTotal = 200.0, gap = 0.0),
        )
        for ((label, d) in cases) {
            println("\n--- $label ---")
            println(buildExchangeReceipt(d, shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80))
        }
    }
}
