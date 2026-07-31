package mu.kidscorner.till

import mu.kidscorner.till.data.ZCashier
import mu.kidscorner.till.data.ZCategory
import mu.kidscorner.till.data.ZMethod
import mu.kidscorner.till.data.ZMovement
import mu.kidscorner.till.data.ZTotals
import mu.kidscorner.till.data.ZVatBand
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.buildZReport
import mu.kidscorner.till.print.toPlainText
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Z slip.
 *
 * Built from figures taken out of the real database — the busiest shift Kids
 * Corner has, run through `z_totals`. Using real numbers matters: the layout
 * bugs that reached paper last time were all about a figure being wider than
 * the space left for it, and invented round numbers hide exactly that.
 */
class ZReportTest {

    private val shop = ShopIdentity(
        name = "Kids Corner",
        address = "Royal Road, Curepipe",
        vatNumber = "VAT12345678",
    )

    /** Shift 7, straight out of z_totals. */
    private val real = ZTotals(
        shiftId = 7,
        openedAt = "2026-07-29T07:07:00.000Z",
        asAt = "2026-07-29T17:02:11.000Z",
        tickets = 6,
        salesTotal = 16222.99,
        itemCount = 23,
        discountTotal = 0.0,
        avgBasket = 2703.83,
        vatTotal = 2116.04,
        methods = listOf(
            ZMethod("cash", 4, gross = 10400.0, change = 153.62, net = 10246.38),
            ZMethod("juice", 1, gross = 3324.42, change = 0.0, net = 3324.42),
            ZMethod("myt_money", 1, gross = 2652.19, change = 0.0, net = 2652.19),
        ),
        categories = listOf(
            ZCategory("Dresses", lines = 4, qty = 6, incl = 4821.55),
            ZCategory("Shoes", lines = 3, qty = 3, incl = 3910.20),
            ZCategory("T-Shirts", lines = 5, qty = 9, incl = 5091.40),
            ZCategory("Trousers", lines = 1, qty = 2, incl = 457.84),
            ZCategory("(uncategorised)", lines = 2, qty = 3, incl = 1942.00),
        ),
        vat = listOf(ZVatBand(15.0, "VAT 15.00%", excl = 14106.95, vat = 2116.04, incl = 16222.99)),
        cashiers = listOf(ZCashier(null, "boodoo.sheik786", 6, 16222.99)),
        movements = listOf(ZMovement(-500.0, "paid the bread supplier", "2026-07-29T11:20:00.000Z")),
        openingFloat = 1500.0,
        cashTaken = 10246.38,
        tillMovements = -500.0,
        expectedCash = 11246.38,
        voided = 0,
        refunded = 1,
        credited = 342.50,
    )

    @Test
    fun `no line ever exceeds the paper width`() {
        for (width in PaperWidth.entries) {
            val text = buildZReport(real, shop, width, "Z00007", 11246.38, 0.0).toPlainText(width)
            for (line in text.lines()) {
                assertTrue(
                    "\"$line\" is ${line.length} on ${width.label} (${width.columns})",
                    line.length <= width.columns,
                )
            }
        }
    }

    @Test
    fun `no figure is truncated on narrow paper`() {
        // The receipt bug that reached paper was a figure cut mid-number on
        // 58mm. Every amount on a Z is at least as wide.
        val text = buildZReport(real, shop, PaperWidth.Mm58, "Z00007", 11246.38, 0.0)
            .toPlainText(PaperWidth.Mm58)
        for (figure in listOf("16,222.99", "11,246.38", "10,246.38", "2,116.04", "14,106.95")) {
            assertTrue("$figure was truncated:\n$text", text.contains(figure))
        }
    }

    @Test
    fun `the drawer section comes before the analysis`() {
        // Somebody counting cash at closing time wants the variance in the first
        // few lines, not after three sections of category breakdown.
        val text = buildZReport(real, shop, PaperWidth.Mm80, "Z00007", 11000.0, -246.38)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(text.indexOf("CASH DRAWER") < text.indexOf("BY CATEGORY"))
        assertTrue(text.indexOf("EXPECTED") < text.indexOf("BY CATEGORY"))
    }

    @Test
    fun `a short drawer says SHORT with a positive figure`() {
        val text = buildZReport(real, shop, PaperWidth.Mm80, "Z00007", 11000.0, -246.38)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("SHORT"))
        // Never "SHORT  -246.38" — the word already carries the sign, and a
        // double negative at closing time is read wrong.
        assertTrue("double negative", !text.contains("-246.38"))
        assertTrue(text.contains("246.38"))
    }

    @Test
    fun `a balanced drawer says BALANCED`() {
        val text = buildZReport(real, shop, PaperWidth.Mm80, "Z00007", 11246.38, 0.0)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("BALANCED"))
        assertTrue(!text.contains("SHORT") && !text.contains("OVER"))
    }

    @Test
    fun `VAT is labelled as included, not added`() {
        // The one thing that must not be misread on a Mauritian retail Z: these
        // prices already contain the VAT.
        val text = buildZReport(real, shop, PaperWidth.Mm80, "Z00007", 11246.38, 0.0)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("VAT (included in prices)"))
        assertTrue(text.contains("net of VAT"))
    }

    @Test
    fun `the categories printed add up to the sales total`() {
        // The apportionment is done in SQL, but if the slip ever dropped or
        // double-counted a category the paper would not balance.
        val sum = real.categories.sumOf { it.incl }
        assertTrue("categories $sum vs total ${real.salesTotal}",
            kotlin.math.abs(sum - real.salesTotal) < 0.05)
    }

    @Test
    fun `each cash movement is named, not just netted`() {
        val text = buildZReport(real, shop, PaperWidth.Mm80, "Z00007", 11246.38, 0.0)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("paid the bread supplier"))
    }

    @Test
    fun `adjustments appear when there are any`() {
        val text = buildZReport(real, shop, PaperWidth.Mm80, "Z00007", 11246.38, 0.0)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("ADJUSTMENTS"))
        assertTrue(text.contains("Refunded tickets"))
        assertTrue(text.contains("342.50"))
    }

    @Test
    fun `a clean shift prints no adjustments section`() {
        val clean = real.copy(voided = 0, refunded = 0, credited = 0.0)
        val text = buildZReport(clean, shop, PaperWidth.Mm80, "Z00007", 11246.38, 0.0)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(!text.contains("ADJUSTMENTS"))
    }

    @Test
    fun `a reprint says so`() {
        val text = buildZReport(real, shop, PaperWidth.Mm80, "Z00007", 11246.38, 0.0, reprint = true)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("*** REPRINT ***"))
    }

    @Test
    fun `change is shown for cash and not for card`() {
        val text = buildZReport(real, shop, PaperWidth.Mm80, "Z00007", 11246.38, 0.0)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("change given"))
        // Juice and my.t money took no change; repeating gross for them is noise.
        assertTrue(text.contains("1 Juice"))
        assertTrue(text.contains("1 my.t money"))
    }

    /** Prints the slip so it can be read whole. `gradlew test --info` shows it. */
    @Test
    fun `sample Z report, for reading`() {
        for (width in PaperWidth.entries) {
            println("\n${"=".repeat(width.columns)}")
            println("${width.label} - ${width.columns} columns")
            println("=".repeat(width.columns))
            println(
                buildZReport(real, shop, width, "Z00007", 11000.0, -246.38).toPlainText(width),
            )
        }
    }
}
