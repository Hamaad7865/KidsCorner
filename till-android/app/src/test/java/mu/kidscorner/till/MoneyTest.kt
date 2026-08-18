package mu.kidscorner.till

import mu.kidscorner.till.data.CartLine
import mu.kidscorner.till.data.cartTotals
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.retryDelayMs
import mu.kidscorner.till.data.round2
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The money path, checked against the web till's arithmetic.
 *
 * These are the figures a cashier reads out to a customer. They are not what
 * gets charged — the server re-prices every sale — but a tablet that says
 * Rs 340.00 and a receipt that says Rs 339.99 costs the shop its trust in both.
 */
class MoneyTest {

    @Test
    fun `round2 matches the toPrecision(12) guard`() {
        // The case the guard exists for: 1.005 is held in binary as
        // 1.00499999999999989…, so a naive round gives 1.00.
        assertEquals(1.01, round2(1.005), 0.0)
        assertEquals(2.68, round2(2.675), 0.0)
        assertEquals(0.3, round2(0.1 + 0.2), 0.0)
        assertEquals(565.71, round2(565.714), 0.0)
        assertEquals(565.72, round2(565.715), 0.0)
    }

    @Test
    fun `round2 never yields negative zero`() {
        // -0.0 formats as "Rs -0.00" and compares equal to 0.0, so nothing
        // downstream can detect it — the sign only reappears at format time.
        val result = round2(-0.001)
        assertEquals(0.0, result, 0.0)
        assertFalse("negative zero leaked", 1.0 / result < 0)
        assertEquals("Rs 0.00", formatRs(-0.001))
    }

    @Test
    fun `round2 survives non-finite input`() {
        assertEquals(0.0, round2(Double.NaN), 0.0)
        assertEquals(0.0, round2(Double.POSITIVE_INFINITY), 0.0)
    }

    private fun line(price: Double, qty: Int, discount: Double = 0.0) = CartLine(
        variantId = 1,
        productName = "Test",
        variantLabel = "",
        colourHex = null,
        sku = "T1",
        unitPrice = price,
        qty = qty,
        discount = discount,
        qtyOnHand = 99,
    )

    @Test
    fun `VAT is contained in the total, not added to it`() {
        // The figure the emulator showed: 642.64 - 642.64 / 1.15 = 83.82.
        // Mirrors the complete_sale RPC exactly.
        val totals = cartTotals(listOf(line(642.64, 1)), saleDiscount = 0.0, vatRate = 0.15)
        assertEquals(642.64, totals.total, 0.0)
        assertEquals(83.82, totals.vat, 0.0)
    }

    @Test
    fun `a disabled shop charges the same total with exactly zero VAT`() {
        // The whole promise of the toggle: prices are inclusive, so turning VAT
        // off must not move the payable total — only the contained VAT, to zero.
        val enabled = cartTotals(listOf(line(642.64, 1)), saleDiscount = 0.0, vatRate = 0.15)
        val disabled = cartTotals(listOf(line(642.64, 1)), saleDiscount = 0.0, vatRate = 0.0)

        assertEquals(enabled.total, disabled.total, 0.0)
        // Exactly zero — no 642.64 - 642.64/1.0 rounding tail.
        assertEquals(0.0, disabled.vat, 0.0)
    }

    @Test
    fun `a zero rate yields no divide or rounding anomaly across awkward totals`() {
        for (price in listOf(0.01, 1.005, 99.99, 642.64, 12_345.67)) {
            val totals = cartTotals(listOf(line(price, 1)), saleDiscount = 0.0, vatRate = 0.0)
            assertEquals("total unchanged at rate 0 for $price", round2(price), totals.total, 0.0)
            assertEquals("zero VAT at rate 0 for $price", 0.0, totals.vat, 0.0)
        }
    }

    @Test
    fun `a sale discount applies after line discounts and cannot go below zero`() {
        val lines = listOf(line(100.0, 2, discount = 20.0))
        // 200 gross, 20 off the line = 180, then a 500 sale discount clamps to 180.
        val totals = cartTotals(lines, saleDiscount = 500.0, vatRate = 0.15)
        assertEquals(200.0, totals.subtotal, 0.0)
        assertEquals(20.0, totals.lineDiscounts, 0.0)
        assertEquals(180.0, totals.saleDiscount, 0.0)
        assertEquals(0.0, totals.total, 0.0)
        assertEquals(0.0, totals.vat, 0.0)
    }

    @Test
    fun `item count sums quantities, not lines`() {
        val totals = cartTotals(
            listOf(line(10.0, 3), line(5.0, 2).copy(variantId = 2)),
            saleDiscount = 0.0,
            vatRate = 0.15,
        )
        assertEquals(5, totals.itemCount)
        assertEquals(40.0, totals.subtotal, 0.0)
    }

    @Test
    fun `retry backoff doubles to a five minute cap`() {
        assertEquals(0L, retryDelayMs(0))
        assertEquals(0L, retryDelayMs(1))
        assertEquals(5_000L, retryDelayMs(2))
        assertEquals(10_000L, retryDelayMs(3))
        assertEquals(20_000L, retryDelayMs(4))
        assertEquals(40_000L, retryDelayMs(5))
        assertEquals(80_000L, retryDelayMs(6))
        assertEquals(160_000L, retryDelayMs(7))
        assertEquals(300_000L, retryDelayMs(8))
    }

    @Test
    fun `retry backoff stays capped past the shl wraparound`() {
        // `1L shl 68` is `1L shl 4` — without the clamp, a queue that had been
        // failing all day would drop back to 80 seconds and start hammering.
        for (attempts in intArrayOf(9, 40, 64, 66, 70, 200, Int.MAX_VALUE)) {
            assertEquals("attempts=$attempts", 300_000L, retryDelayMs(attempts))
        }
    }

    @Test
    fun `formatRs groups thousands and always shows two places`() {
        assertEquals("Rs 1,250.50", formatRs(1250.5))
        assertEquals("Rs 0.00", formatRs(0.0))
        assertEquals("Rs 1,000,000.00", formatRs(1_000_000.0))
    }

    private fun assertFalse(message: String, condition: Boolean) =
        assertTrue(message, !condition)
}
