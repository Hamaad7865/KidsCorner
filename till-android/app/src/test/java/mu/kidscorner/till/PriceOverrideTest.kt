package mu.kidscorner.till

import mu.kidscorner.till.data.CartLine
import mu.kidscorner.till.data.withLineDiscount
import mu.kidscorner.till.data.withPriceOverride
import mu.kidscorner.till.data.withQty
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A hand-set unit price is carried as the line's discount, so the arithmetic
 * has to hold in both directions — and it decides what a customer is charged.
 */
class PriceOverrideTest {

    private fun cart(qty: Int = 1, price: Double = 565.71) = listOf(
        CartLine(
            variantId = 1,
            productName = "Cotton romper",
            variantLabel = "Coral · 3-6m",
            colourHex = null,
            sku = "KC-0102",
            unitPrice = price,
            qty = qty,
            qtyOnHand = 20,
        ),
    )

    @Test
    fun `an override becomes the difference off the line`() {
        val out = cart(qty = 2).withPriceOverride(1, 500.0).first()
        assertEquals(500.0, out.priceOverride!!, 0.0)
        // (565.71 - 500.00) x 2
        assertEquals(131.42, out.discount, 0.0)
        // and the line charges the agreed price twice
        assertEquals(1000.0, out.lineTotal, 0.0)
    }

    @Test
    fun `a price above the list price is refused, not clamped`() {
        val out = cart().withPriceOverride(1, 900.0).first()
        assertNull("the override must not stick", out.priceOverride)
        assertEquals(0.0, out.discount, 0.0)
        assertEquals(565.71, out.lineTotal, 0.0)
    }

    @Test
    fun `the list price itself is allowed and discounts nothing`() {
        val out = cart().withPriceOverride(1, 565.71).first()
        assertEquals(565.71, out.priceOverride!!, 0.0)
        assertEquals(0.0, out.discount, 0.0)
    }

    @Test
    fun `null returns the line to list`() {
        val set = cart(qty = 2).withPriceOverride(1, 500.0)
        val out = set.withPriceOverride(1, null).first()
        assertNull(out.priceOverride)
        assertEquals(0.0, out.discount, 0.0)
        assertEquals(1131.42, out.lineTotal, 0.0)
    }

    @Test
    fun `the override follows a quantity change`() {
        // Agreed at 500 on one unit, then the customer takes three.
        val out = cart(qty = 1).withPriceOverride(1, 500.0).withQty(1, 3).first()
        assertEquals(3, out.qty)
        // (565.71 - 500.00) x 3, not the figure sized for one
        assertEquals(197.13, out.discount, 0.0)
        assertEquals(1500.0, out.lineTotal, 0.0)
    }

    @Test
    fun `a chip discount clears a hand-set price`() {
        val out = cart(qty = 2)
            .withPriceOverride(1, 500.0)
            .withLineDiscount(1, "percent", 10.0)
            .first()
        assertNull("one reduction on a line, not two", out.priceOverride)
        // 10% of the full gross, not of the overridden one
        assertEquals(113.14, out.discount, 0.0)
    }

    @Test
    fun `a hand-set price clears a chip discount`() {
        val out = cart(qty = 2)
            .withLineDiscount(1, "percent", 10.0)
            .withPriceOverride(1, 500.0)
            .first()
        assertEquals(500.0, out.priceOverride!!, 0.0)
        assertEquals(131.42, out.discount, 0.0)
    }

    @Test
    fun `an override can take a line to zero but not below`() {
        val out = cart(qty = 2).withPriceOverride(1, 0.0).first()
        assertEquals(0.0, out.priceOverride!!, 0.0)
        assertEquals(1131.42, out.discount, 0.0)
        assertEquals(0.0, out.lineTotal, 0.0)
    }
}
