package mu.kidscorner.till

import mu.kidscorner.till.print.EscPos
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.ReceiptLine
import mu.kidscorner.till.print.buildLabel
import mu.kidscorner.till.print.toPlainText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Shelf labels, checked without a printer.
 *
 * Same discipline as the receipt tests: the layout is verified against its
 * own arithmetic, and the EAN-13 bytes are checked structurally — GS k 67
 * with twelve digits, so the printer computes the check digit itself. A
 * short code must emit nothing: a truncated symbol scans as a different
 * product, which is worse than no symbol.
 */
class LabelPrintTest {

    @Test
    fun `label carries name, variant, price and barcode`() {
        val lines = buildLabel(
            productName = "Cotton tee",
            variantLabel = "Pink · 3-4y",
            price = 450.0,
            barcode = "6291041000416",
            width = PaperWidth.Mm58,
        )
        val text = lines.toPlainText(PaperWidth.Mm58)
        assertTrue(text.contains("Cotton tee"))
        assertTrue(text.contains("Pink · 3-4y"))
        assertTrue(text.contains("Rs 450"))
        assertTrue(text.contains("[EAN13: 6291041000416]"))
        for (line in text.lines()) {
            assertTrue(line.length <= PaperWidth.Mm58.columns)
        }
    }

    /** Finds GS k 67 and returns the bytes that follow it (length + payload). */
    private fun ean13Payload(bytes: List<Int>): List<Int> {
        val at = bytes.indices.first { i ->
            i + 2 < bytes.size && bytes[i] == 0x1D && bytes[i + 1] == 0x6B && bytes[i + 2] == 67
        }
        return bytes.drop(at + 3)
    }

    @Test
    fun `ean13 sends twelve digits under GS k 67`() {
        val bytes = EscPos.ean13("6291041000416").toList().map { it.toInt() and 0xFF }
        val after = ean13Payload(bytes)
        // A thirteen-digit code goes out as its first twelve — the printer
        // recomputes the same check digit from those.
        assertEquals(12, after[0])
        val digits = after.drop(1).take(12).map { it.toChar() }.joinToString("")
        assertEquals("629104100041", digits)
    }

    @Test
    fun `ean13 accepts twelve digits as-is`() {
        val bytes = EscPos.ean13("629104100041").toList().map { it.toInt() and 0xFF }
        val after = ean13Payload(bytes)
        assertEquals(12, after[0])
        val digits = after.drop(1).take(12).map { it.toChar() }.joinToString("")
        assertEquals("629104100041", digits)
    }

    @Test
    fun `ean13 emits nothing for a short code`() {
        assertEquals(0, EscPos.ean13("12345").size)
        assertEquals(0, EscPos.ean13("").size)
    }

    @Test
    fun `ean13 strips non-digits before counting`() {
        assertEquals(
            EscPos.ean13("629104100041").size,
            EscPos.ean13("6291-0410 0041").size,
        )
    }

    @Test
    fun `encoded label contains the barcode command`() {
        val lines = buildLabel("Cotton tee", "Pink", 450.0, "6291041000416", PaperWidth.Mm80)
        val bytes = EscPos.encode(lines, PaperWidth.Mm80).toList().map { it.toInt() and 0xFF }
        val after = ean13Payload(bytes)
        assertEquals(12, after[0])
    }

    @Test
    fun `ean13 line encodes through the normal pipeline`() {
        val bytes = EscPos.encode(
            listOf(ReceiptLine.Ean13("6291041000416")),
            PaperWidth.Mm80,
        ).toList().map { it.toInt() and 0xFF }
        assertTrue(bytes.contains(0x6B))
    }
}
