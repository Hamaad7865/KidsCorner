package mu.kidscorner.till.ui

import mu.kidscorner.till.data.CatalogVariant
import mu.kidscorner.till.data.StockCheckLocation
import mu.kidscorner.till.data.StockCheckQuantity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StockCheckSearchTest {
    private val catalog = listOf(
        CatalogVariant(
            id = 101,
            productId = 10,
            productName = "Chemise cotton",
            shelfLocation = "A12",
            productCode = "PC-1023",
            sizeLabel = "6",
            colourName = "Blue",
            sku = "CH010-6-BLUE",
            barcode = "6291041500213",
            qtyOnHand = 110,
        ),
        CatalogVariant(
            id = 102,
            productId = 10,
            productName = "Chemise cotton",
            shelfLocation = "A12",
            productCode = "PC-1023",
            sizeLabel = "7",
            colourName = "Red",
            sku = "CH010-7-RED",
            barcode = "6291041500214",
            qtyOnHand = 4,
        ),
        CatalogVariant(
            id = 201,
            productId = 20,
            productName = "Canvas sandals",
            shelfLocation = "S08",
            sizeLabel = "EU 24",
            colourName = "Pink",
            sku = "SAN-24-PINK",
            barcode = "6291041500999",
            qtyOnHand = 6,
        ),
    )

    @Test
    fun `product name search is case insensitive and keeps every variant`() {
        val matches = stockCheckMatches("CHEMISE", catalog)

        assertEquals(1, matches.size)
        assertEquals(10, matches.single().productId)
        assertEquals("A12", matches.single().shelfLocation)
        assertEquals("PC-1023", matches.single().productCode)
        assertEquals(listOf(101, 102), matches.single().variants.map { it.id })
        assertFalse(matches.single().barcodeMatch)
    }

    @Test
    fun `sku substring finds its product`() {
        val matches = stockCheckMatches("7-red", catalog)

        assertEquals(listOf(10), matches.map { it.productId })
    }

    @Test
    fun `product code substring finds its product, case insensitively`() {
        val matches = stockCheckMatches("pc-1023", catalog)

        assertEquals(listOf(10), matches.map { it.productId })
    }

    @Test
    fun `a product with no code yet is unaffected by a code query`() {
        val matches = stockCheckMatches("PC-1023", catalog)

        assertEquals(listOf(10), matches.map { it.productId })
        assertTrue(matches.none { it.productId == 20 })
    }

    @Test
    fun `exact barcode selects that product first`() {
        val matches = stockCheckMatches("6291041500214", catalog)

        assertEquals(10, matches.first().productId)
        assertTrue(matches.first().barcodeMatch)
        assertEquals(2, matches.first().variants.size)
    }

    @Test
    fun `blank and unknown queries have no matches`() {
        assertTrue(stockCheckMatches("   ", catalog).isEmpty())
        assertTrue(stockCheckMatches("not in catalogue", catalog).isEmpty())
    }

    @Test
    fun `a missing location balance is explicitly zero`() {
        val warehouse = StockCheckLocation(
            id = 2,
            name = "Warehouse",
            quantities = listOf(StockCheckQuantity(variantId = 101, qty = 100)),
        )

        assertEquals(100, quantityAt(warehouse, 101))
        assertEquals(0, quantityAt(warehouse, 102))
    }
}
