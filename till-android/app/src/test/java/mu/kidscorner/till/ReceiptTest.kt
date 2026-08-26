package mu.kidscorner.till

import mu.kidscorner.till.data.SaleDetail
import mu.kidscorner.till.data.SaleDetailDiscount
import mu.kidscorner.till.data.SaleDetailLine
import mu.kidscorner.till.data.SaleDetailPayment
import mu.kidscorner.till.print.Align
import mu.kidscorner.till.print.EscPos
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.ReceiptLine
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.buildReceipt
import mu.kidscorner.till.print.columnise
import mu.kidscorner.till.print.renderLine
import mu.kidscorner.till.print.toPlainText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The receipt, checked without a printer.
 *
 * There is no hardware to test against, so the layout is verified against its
 * own arithmetic instead: nothing may exceed the paper width, no figure may be
 * truncated, and the bytes must contain what the preview shows. That is not the
 * same as knowing a given printer accepts them — but it does rule out the
 * failures that would only show up on paper in front of a customer.
 */
class ReceiptTest {

    private val shop = ShopIdentity(
        name = "Kids Corner",
        address = "Royal Road, Curepipe",
        phone = "5xxx xxxx",
        vatNumber = "VAT12345678",
    )

    private fun sale(
        lines: List<SaleDetailLine> = listOf(
            SaleDetailLine(
                id = 1,
                productName = "Cotton tee, short sleeve",
                sizeLabel = "3-6 mths",
                colourName = "Pink",
                sku = "CT-36-PK",
                qty = 2,
                unitPrice = 565.71,
                lineTotal = 1131.42,
            ),
        ),
        payments: List<SaleDetailPayment> = listOf(
            SaleDetailPayment(id = 1, method = "cash", amount = 1131.42, tendered = 1200.0),
        ),
        discounts: List<SaleDetailDiscount> = emptyList(),
        status: String = "completed",
    ) = SaleDetail(
        id = 60,
        saleNo = "S260729-60",
        saleDate = "2026-07-29T14:32:11.000Z",
        status = status,
        subtotal = 1131.42,
        discount = discounts.sumOf { it.amount },
        vatAmount = 147.58,
        total = 1131.42,
        cashierName = "Marie",
        customerName = null,
        lines = lines,
        payments = payments,
        discounts = discounts,
    )

    // ------------------------------------------------------------ the rule

    @Test
    fun `no line ever exceeds the paper width`() {
        for (width in PaperWidth.entries) {
            val text = buildReceipt(sale(), shop, width).toPlainText(width)
            for (line in text.lines()) {
                assertTrue(
                    "\"$line\" is ${line.length} chars on ${width.label} (${width.columns})",
                    line.length <= width.columns,
                )
            }
        }
    }

    @Test
    fun `a double-height line is laid out against half the width`() {
        // Double height is also double width on ESC/POS. Laid out against the
        // full column count, a long shop name would silently wrap.
        val line = ReceiptLine.Text("A shop with a very long name indeed", Align.Centre, big = true)
        assertTrue(renderLine(line, 32).length <= 16)
    }

    // -------------------------------------------------------- the columns

    @Test
    fun `the figure is never truncated and the label always is`() {
        // A name cut to "Cotton tee, short sl" is still recognisable. An amount
        // cut to "Rs 1,2" is a dispute at the counter.
        val result = columnise("Cotton tee, short sleeve, pink, 3-6 mths", "1,131.42", 32)
        assertEquals(32, result.length)
        assertTrue("figure lost", result.endsWith("1,131.42"))
    }

    @Test
    fun `label and figure never touch`() {
        // Without a guaranteed gap "Trousers12.00" reads as one token, and the
        // price is anybody's guess.
        for (label in listOf("a", "ab".repeat(30), "Shorts", "X".repeat(31))) {
            val result = columnise(label, "99.00", 32)
            assertTrue("\"$result\" has no gap", result.contains(" 99.00") || result == "99.00")
            assertTrue(result.length <= 32)
        }
    }

    @Test
    fun `an oversized figure takes the whole line rather than wrapping`() {
        val result = columnise("Total", "1,234,567,890.00", 12)
        assertEquals(12, result.length)
        assertTrue(result.endsWith("890.00"))
    }

    @Test
    fun `indent shifts the label without pushing the figure off`() {
        val result = columnise("Pink 3-6 mths  2 x 565.71", "1,131.42", 32, indent = 2)
        assertEquals(32, result.length)
        assertTrue(result.startsWith("  "))
        assertTrue(result.endsWith("1,131.42"))
    }

    // ------------------------------------------------------- what it says

    @Test
    fun `a unit price is never truncated, at any paper width`() {
        // Caught by reading the sample output: on 58mm the variant plus the sum
        // plus the total did not fit, and columnise truncated the LEFT — so
        // "2 x 565.71" printed as "2 x 56", which reads as a unit price of 56.
        //
        // The layout is Carfectionist's four columns now, and it defends the
        // same thing a different way: the designation is truncated on purpose,
        // and UP and Total are padStart'd so they always survive whole.
        val long = SaleDetailLine(
            id = 9,
            productName = "Cotton tee, short sleeve",
            sizeLabel = "3-6 mths",
            colourName = "Pink",
            sku = "CT-36-PK",
            qty = 2,
            unitPrice = 565.71,
            lineTotal = 1131.42,
        )

        for (width in PaperWidth.entries) {
            val text = buildReceipt(sale(lines = listOf(long)), shop, width).toPlainText(width)
            assertTrue(
                "unit price truncated on ${width.label}:\n$text",
                text.contains("565.71"),
            )
            assertTrue("line total lost on ${width.label}", text.contains("1131.42"))
        }
    }

    @Test
    fun `the exchange terms are never cut off`() {
        // The one line a customer comes back holding.
        for (width in PaperWidth.entries) {
            val text = buildReceipt(sale(), shop, width).toPlainText(width)
            assertTrue(
                "exchange terms truncated on ${width.label}",
                text.contains("Exchange within 7 days"),
            )
            assertTrue(
                "no-return policy missing on ${width.label}",
                text.contains("No return"),
            )
            assertTrue(
                "a dangling 'with this' on ${width.label}",
                !text.contains("with this\n") && !text.trimEnd().endsWith("with this"),
            )
        }
    }

    @Test
    fun `a big centred line is centred against the paper, not the character count`() {
        // Double-width glyphs occupy two columns each, so centring against the
        // usable count sits the shop name left of centre in the preview while
        // the printer centres it properly — and the preview is meant to BE the
        // receipt.
        val rendered = renderLine(ReceiptLine.Text("Kids Corner", Align.Centre, big = true), 32)
        val leading = rendered.takeWhile { it == ' ' }.length
        // "Kids Corner" is 11 chars = 22 columns, leaving 10 to split.
        assertEquals(5, leading)
    }

    @Test
    fun `a label with no figure is not padded with trailing spaces`() {
        assertEquals("  approved by Sheik", columnise("approved by Sheik", "", 32, indent = 2))
    }

    @Test
    fun `a reprint says so, prominently`() {
        val original = buildReceipt(sale(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        val copy = buildReceipt(sale(), shop, PaperWidth.Mm80, reprintNumber = 3)
            .toPlainText(PaperWidth.Mm80)

        assertTrue("original should not claim to be a reprint", !original.contains("REPRINT"))
        assertTrue(copy.contains("REPRINT #3"))
    }

    @Test
    fun `a refunded sale says so on its own face`() {
        // A reprint of a refunded sale that looks like a normal receipt is the
        // document someone uses to claim the goods a second time.
        val text = buildReceipt(sale(status = "refunded"), shop, PaperWidth.Mm80)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("*** REFUNDED ***"))
    }

    @Test
    fun `a cash refund on an exchange prints as REFUND, not a negative figure`() {
        val text = buildReceipt(
            sale(payments = listOf(SaleDetailPayment(id = 1, method = "cash", amount = -100.0, tendered = null))),
            shop,
            PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)

        assertTrue("expected a REFUND line:\n$text", text.contains("CASH REFUND"))
        assertTrue("printed a bare negative figure:\n$text", !text.contains("-100.00"))
        assertTrue("the refunded amount should read positive:\n$text", text.contains("100.00"))
    }

    @Test
    fun `an approved discount names its approver`() {
        val text = buildReceipt(
            sale(
                discounts = listOf(
                    SaleDetailDiscount(
                        label = "Staff discount",
                        kind = "percent",
                        value = 10.0,
                        amount = 113.14,
                        approvedByName = "Sheik",
                    ),
                ),
            ),
            shop,
            PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)

        assertTrue(text.contains("Staff discount"))
        assertTrue(text.contains("approved by Sheik"))
    }

    @Test
    fun `change is shown when cash was over-tendered`() {
        val text = buildReceipt(sale(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("Change :"))
        assertTrue(text.contains("68.58"))
    }

    @Test
    fun `no change line when the cash was exact`() {
        val text = buildReceipt(
            sale(
                payments = listOf(
                    SaleDetailPayment(id = 1, method = "cash", amount = 1131.42, tendered = 1131.42),
                ),
            ),
            shop,
            PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)
        assertTrue(!text.contains("CHANGE"))
    }

    @Test
    fun `a missing VAT number omits the line rather than printing null`() {
        val text = buildReceipt(sale(), shop.copy(vatNumber = null), PaperWidth.Mm80)
            .toPlainText(PaperWidth.Mm80)
        assertTrue(!text.contains("VAT12345678"))
        assertTrue(!text.lowercase().contains("null"))
    }

    @Test
    fun `the method label is the shop's word, not the database's`() {
        val text = buildReceipt(
            sale(payments = listOf(SaleDetailPayment(id = 1, method = "myt_money", amount = 1131.42))),
            shop,
            PaperWidth.Mm80,
        ).toPlainText(PaperWidth.Mm80)
        // Uppercased on the tender line, as the reference slip has it — but
        // still the shop's word for it, never the database's column value.
        assertTrue(text.contains("MY.T MONEY"))
        assertTrue(!text.contains("myt_money"))
    }

    // ------------------------------------------------------------- bytes

    @Test
    fun `the encoded job initialises and cuts`() {
        val bytes = EscPos.encode(buildReceipt(sale(), shop, PaperWidth.Mm80), PaperWidth.Mm80)
        assertTrue("missing ESC @", bytes.take(2) == listOf(0x1B.toByte(), 0x40.toByte()))
        // GS V 66 n
        val tail = bytes.takeLast(4)
        assertEquals(0x1D.toByte(), tail[0])
        assertEquals(0x56.toByte(), tail[1])
        assertEquals(66.toByte(), tail[2])
    }

    @Test
    fun `the bytes contain what the preview shows`() {
        val lines = buildReceipt(sale(), shop, PaperWidth.Mm80)
        val bytes = EscPos.encode(lines, PaperWidth.Mm80)
        val ascii = String(bytes, Charsets.ISO_8859_1)

        // No thousands separator now — the reference's slip prints
        // "1131.42", and a comma costs a column on 58mm paper.
        for (needle in listOf("KIDS CORNER", "S260729-60", "Cotton tee", "1131.42", "Change")) {
            assertTrue("bytes are missing \"$needle\"", ascii.contains(needle))
        }
    }

    @Test
    fun `non-ASCII is mapped rather than sent raw`() {
        // A UTF-8 interpunct arrives at a thermal printer as two bytes and
        // prints as two pieces of line noise.
        val bytes = EscPos.toCp437("Pink · 3-6 mths — “tee”")
        assertEquals(23, bytes.size)
        assertEquals(0xFA.toByte(), bytes[5])
        assertTrue("em dash should become a hyphen", bytes.contains('-'.code.toByte()))
        assertTrue("no byte should be zero", bytes.none { it == 0.toByte() })
    }

    @Test
    fun `an accented letter is encoded, not replaced`() {
        // CP437 has these; replacing them with '?' printed a French catalogue
        // as "Robe B?b?" on every receipt the shop hands out.
        assertEquals(byteArrayOf(0x82.toByte()).toList(), EscPos.toCp437("é").toList())
        assertEquals(
            listOf(0x93, 0x87, 0x85, 0x96).map { it.toByte() },
            EscPos.toCp437("ôçàû").toList(),
        )
    }

    @Test
    fun `an accented name keeps its width, so columns still line up`() {
        // One character, one byte — the receipt's column arithmetic counts
        // characters, so an encoding that emitted two would shift every total.
        assertEquals("Robe Bebe".length, EscPos.toCp437("Robe Bébé").size)
    }

    @Test
    fun `a genuinely unencodable character becomes a question mark, not a box`() {
        // A raw high byte prints as a box-drawing glyph and looks like a fault.
        val bytes = EscPos.toCp437("h你llo")
        assertEquals("h?llo", String(bytes, Charsets.US_ASCII))
    }

    @Test
    fun `a barcode drops characters CODE39 cannot express`() {
        // A barcode carrying an illegal character makes some printers emit
        // nothing and others hang waiting for more data.
        val bytes = EscPos.barcode("S260729-60")
        val ascii = String(bytes, Charsets.ISO_8859_1)
        assertTrue(ascii.contains("S260729-60"))

        val dirty = EscPos.barcode("s26_07*29")
        val cleaned = String(dirty, Charsets.ISO_8859_1)
        assertTrue("underscore should be dropped", !cleaned.contains("_"))
        assertTrue("asterisk should be dropped", !cleaned.contains("*"))
        assertTrue(cleaned.contains("S260729"))
    }

    @Test
    fun `an entirely unprintable barcode emits nothing rather than a malformed command`() {
        assertEquals(0, EscPos.barcode("____").size)
    }

    /**
     * Prints a full receipt to the test output.
     *
     * Not an assertion — a way to *look* at the thing. Every other test here
     * checks a property in isolation; a receipt is also a document somebody
     * reads standing at a counter, and the only way to judge that is to see it
     * whole. `gradlew test --info` shows it.
     */
    @Test
    fun `sample receipt, for reading`() {
        val basket = listOf(
            SaleDetailLine(
                id = 1, productName = "Cotton tee, short sleeve",
                sizeLabel = "3-6 mths", colourName = "Pink", sku = "CT-36-PK",
                qty = 2, unitPrice = 565.71, lineTotal = 1131.42,
            ),
            SaleDetailLine(
                id = 2, productName = "Denim jeans, slim",
                sizeLabel = "2-3 yrs", colourName = "Beige", sku = "DJ-23-BG",
                qty = 1, unitPrice = 642.64, discount = 42.64, lineTotal = 600.00,
            ),
            SaleDetailLine(
                id = 3, productName = "Sandals",
                sizeLabel = "EU 27", colourName = "White", sku = "SD-27-WH",
                qty = 1, unitPrice = 899.00, lineTotal = 899.00,
            ),
        )

        val full = SaleDetail(
            id = 61, saleNo = "S260729-61",
            saleDate = "2026-07-29T14:32:11.000Z",
            subtotal = 2630.42, discount = 263.04, vatAmount = 308.79, total = 2367.38,
            cashierName = "Marie", customerName = "Rita Appadoo",
            lines = basket,
            payments = listOf(
                SaleDetailPayment(id = 1, method = "card", amount = 1500.0),
                SaleDetailPayment(id = 2, method = "cash", amount = 867.38, tendered = 1000.0),
            ),
            discounts = listOf(
                SaleDetailDiscount(
                    label = "Staff discount", kind = "percent", value = 10.0,
                    amount = 263.04, approvedByName = "Sheik",
                ),
            ),
        )

        for (width in PaperWidth.entries) {
            println("\n${"=".repeat(width.columns)}")
            println("${width.label} — ${width.columns} columns")
            println("=".repeat(width.columns))
            println(buildReceipt(full, shop, width, reprintNumber = 2).toPlainText(width))
        }
    }

    // ---------------------------------------------------- the gift receipt

    @Test
    fun `a gift receipt names the goods and shows no money at all`() {
        for (width in PaperWidth.entries) {
            val text = buildReceipt(sale(), shop, width, gift = true).toPlainText(width)

            // What it is, and where it came from.
            assertTrue("product missing on ${width.label}", text.contains("Cotton tee"))
            assertTrue("sale number missing on ${width.label}", text.contains("S260729-60"))
            assertTrue("not labelled a gift receipt on ${width.label}", text.contains("Gift receipt"))

            // And not a single figure. A gift receipt that leaks the price is
            // the one thing it must never do.
            // "VAT" on its own is not a price — the shop's registration
            // number is in the header and belongs there. What must not appear
            // is a figure or a totals-block label.
            for (money in listOf("565.71", "1,131.42", "1,451.42", "TOTAL", "of which VAT", "Subtotal")) {
                assertFalse(
                    "gift receipt leaked $money on ${width.label}",
                    text.contains(money),
                )
            }
        }
    }

    @Test
    fun `gift receipt, for reading`() {
        println(buildReceipt(sale(), shop, PaperWidth.Mm58, gift = true).toPlainText(PaperWidth.Mm58))
    }

    @Test
    fun `a gift receipt carries no character the printer cannot encode`() {
        // An em dash here printed as "?" on paper. Caught by reading the
        // rendered output, which is the only way to catch it.
        val text = buildReceipt(sale(), shop, PaperWidth.Mm58, gift = true)
            .toPlainText(PaperWidth.Mm58)
        val unencodable = text.filter { it.code > 126 }
        assertTrue("gift receipt has non-ASCII: $unencodable", unencodable.isEmpty())
    }

    @Test
    fun `an ordinary receipt still shows the money`() {
        val text = buildReceipt(sale(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("Total:"))
        assertTrue(text.contains("565.71"))
    }

    // -------------------------------------------------- the VAT registration

    private fun enabledSale() = sale().copy(
        vatEnabled = true,
        vatRate = 0.15,
        vatNumber = "VAT20123456",
        vatAmount = 147.58,
    )

    private fun disabledSale() = sale().copy(
        vatEnabled = false,
        vatRate = 0.0,
        vatNumber = null,
        vatAmount = 0.0,
    )

    @Test
    fun `a VAT-enabled sale prints a VAT invoice with the frozen number and breakdown`() {
        // The shop identity passed in carries a DIFFERENT number and the sale is
        // still printed from its own frozen snapshot — a reprint must not adopt
        // today's registration.
        for (width in PaperWidth.entries) {
            val text = buildReceipt(enabledSale(), shop.copy(vatNumber = "VAT99999999"), width)
                .toPlainText(width)
            assertTrue("no VAT INVOICE label on ${width.label}", text.contains("VAT INVOICE"))
            assertTrue("frozen number missing on ${width.label}", text.contains("20123456"))
            assertFalse("adopted the shop's current number on ${width.label}", text.contains("99999999"))
            assertTrue("VAT amount missing on ${width.label}", text.contains("147.58"))
        }
    }

    @Test
    fun `a disabled sale prints a plain receipt with no VAT wording anywhere`() {
        for (width in PaperWidth.entries) {
            val text = buildReceipt(disabledSale(), shop, width).toPlainText(width)
            assertTrue("no RECEIPT label on ${width.label}", text.contains("RECEIPT"))
            assertFalse("says VAT INVOICE on ${width.label}", text.contains("VAT INVOICE"))
            // Not one VAT, tax or exclusive word — the header number is gone too.
            assertFalse("leaked 'VAT' on ${width.label}", text.contains("VAT"))
            assertFalse("leaked 'tax' on ${width.label}", text.lowercase().contains("tax"))
            assertFalse("leaked 'excl' on ${width.label}", text.lowercase().contains("excl"))
            // The money the customer paid is still there.
            assertTrue("total missing on ${width.label}", text.contains("Total:"))
        }
    }

    @Test
    fun `an enabled zero-total sale is still a VAT invoice`() {
        // Explicit status, never inferred from vatAmount > 0.
        val zero = enabledSale().copy(
            subtotal = 0.0, total = 0.0, vatAmount = 0.0,
            lines = listOf(
                SaleDetailLine(id = 1, productName = "Replacement", qty = 1, unitPrice = 0.0, lineTotal = 0.0),
            ),
            payments = emptyList(),
        )
        val text = buildReceipt(zero, shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("VAT INVOICE"))
    }

    @Test
    fun `a legacy sale detail with no VAT fields prints as a VAT invoice`() {
        // The default fixture leaves the new fields at their decode defaults —
        // vatEnabled true — exactly as a detail from a pre-feature server would.
        val text = buildReceipt(sale(), shop, PaperWidth.Mm80).toPlainText(PaperWidth.Mm80)
        assertTrue(text.contains("VAT INVOICE"))
    }
}
