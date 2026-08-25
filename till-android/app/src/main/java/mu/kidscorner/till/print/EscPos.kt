package mu.kidscorner.till.print

import java.io.ByteArrayOutputStream

/**
 * ESC/POS, the command language nearly every thermal receipt printer speaks.
 *
 * Epson defined it and the rest of the market cloned it, so a 58mm no-name
 * printer off a Mauritian market stall and an Epson TM-T20 both understand
 * these bytes. That is why this targets ESC/POS rather than a vendor SDK: the
 * shop's printer is unknown, and this is the one thing it is nearly certain to
 * accept.
 *
 * Rendered from the same `ReceiptLine` list the preview uses, so the two cannot
 * drift.
 */
object EscPos {

    private const val ESC = 0x1B.toByte()
    private const val GS = 0x1D.toByte()
    private const val LF = 0x0A.toByte()

    /** ESC @ — reset. Clears whatever state the last job left behind. */
    val INIT = byteArrayOf(ESC, 0x40)

    /** ESC a n — 0 left, 1 centre, 2 right. */
    private fun align(n: Int) = byteArrayOf(ESC, 0x61, n.toByte())

    /** ESC E n — emphasis. */
    private fun bold(on: Boolean) = byteArrayOf(ESC, 0x45, if (on) 1 else 0)

    /**
     * GS ! n — character size.
     *
     * The high nibble is width-1 and the low nibble is height-1, so double both
     * is 0x11. Worth stating because 0x10 and 0x01 look interchangeable and are
     * not: one doubles the width and wrecks the column arithmetic.
     */
    private fun size(double: Boolean) = byteArrayOf(GS, 0x21, if (double) 0x11 else 0x00)

    /** ESC d n — feed n lines. */
    private fun feed(n: Int) = byteArrayOf(ESC, 0x64, n.toByte())

    /**
     * GS V 66 n — feed n and partial cut.
     *
     * Partial rather than full: it leaves a small tab holding the receipt on
     * the roll so it does not drop on the floor behind the counter. The feed is
     * not optional — without it the cut lands inside the last printed lines,
     * because the blade sits above the print head.
     */
    fun cut(feedLines: Int = 4) = byteArrayOf(GS, 0x56, 66, feedLines.toByte())

    /**
     * ESC p m t1 t2 — pulse the drawer connector.
     *
     * The drawer is not a printer; it is a solenoid on the printer's RJ11
     * port, and this is the only way to reach it. Pin 2 (m=0) is what almost
     * every till uses — pin 5 exists for a second drawer. The times are in
     * 2ms units: 50ms on, 500ms off, which is the interval nearly every
     * manual gives and is long enough for the latch to throw.
     *
     * A drawer that is not plugged in swallows this silently, which is the
     * right outcome — a shop with no drawer should not see an error every
     * time somebody takes cash.
     */
    fun openDrawer(): ByteArray = byteArrayOf(ESC, 0x70, 0x00, 0x19.toByte(), 0xFA.toByte())

    /** ESC t n — code page. 0 is CP437, which every clone implements. */
    val CODEPAGE_CP437 = byteArrayOf(ESC, 0x74, 0x00)

    /**
     * GS k m n d… — CODE39, for the sale number.
     *
     * CODE39 rather than EAN-13: a sale number like "S260729-60" is
     * alphanumeric with a hyphen, which EAN-13 cannot express at all. The
     * printable set is narrow, so anything outside it is dropped rather than
     * sent — a barcode with an illegal character makes some printers emit
     * nothing and others hang waiting for more data.
     */
    fun barcode(code: String): ByteArray {
        val allowed = code.uppercase().filter { it in CODE39_CHARS }.take(20)
        if (allowed.isEmpty()) return ByteArray(0)

        return ByteArrayOutputStream().apply {
            write(byteArrayOf(GS, 0x68, 60))          // GS h — height in dots
            write(byteArrayOf(GS, 0x77, 2))           // GS w — module width
            write(byteArrayOf(GS, 0x48, 2))           // GS H — print the text below
            write(byteArrayOf(GS, 0x6B, 69))          // GS k 69 — CODE39, length-prefixed
            write(allowed.length)
            write(allowed.toByteArray(Charsets.US_ASCII))
            write(LF.toInt())
        }.toByteArray()
    }

    private const val CODE39_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%"

    /**
     * GS ( k — a QR symbol, for the receipt-recall code.
     *
     * Four commands against the printer's symbol storage: store the payload,
     * pick the module size, pick the error-correction level, print. Module
     * size 5 dots is the compromise between scan distance and paper: the
     * symbol for a sale number is small at either paper width, and a phone
     * camera should read it as easily as the till's scanner. Correction level
     * M tolerates a crease across the corner — exactly where a receipt gets
     * creased in a pocket.
     */
    fun qr(payload: String): ByteArray {
        val data = payload.toByteArray(Charsets.US_ASCII)
        if (data.isEmpty()) return ByteArray(0)

        // The storage command is length-prefixed with the payload plus the
        // function header itself: 2 bytes for "31 50 30" is three — cn, fn, m.
        val len = data.size + 3
        return ByteArrayOutputStream().apply {
            write(
                byteArrayOf(
                    GS, 0x28, 0x6B,
                    (len and 0xFF).toByte(), ((len shr 8) and 0xFF).toByte(),
                    0x31, 0x50, 0x30,
                ),
            )
            write(data)
            write(byteArrayOf(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x05))
            write(byteArrayOf(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x4D))
            write(byteArrayOf(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30))
        }.toByteArray()
    }

    /**
     * The whole job: init, the lines, a feed and a cut.
     *
     * Text is encoded as CP437 rather than UTF-8. A thermal printer has a byte
     * per glyph and no notion of multi-byte characters, so a UTF-8 "·" arrives
     * as two bytes and prints as two pieces of line noise. Anything outside the
     * code page is replaced by '?' at the encoder rather than sent raw.
     */
    fun encode(lines: List<ReceiptLine>, width: PaperWidth): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(INIT)
        out.write(CODEPAGE_CP437)

        for (line in lines) {
            when (line) {
                is ReceiptLine.Barcode -> {
                    out.write(align(1))
                    out.write(barcode(line.code))
                    out.write(align(0))
                }

                is ReceiptLine.Qr -> {
                    out.write(align(1))
                    out.write(qr(line.payload))
                    out.write(align(0))
                }

                is ReceiptLine.Feed -> out.write(feed(line.lines))

                else -> {
                    val big = (line as? ReceiptLine.Text)?.big
                        ?: (line as? ReceiptLine.Columns)?.big
                        ?: false
                    val emphasised = (line as? ReceiptLine.Text)?.bold
                        ?: (line as? ReceiptLine.Columns)?.bold
                        ?: false
                    val alignment = when ((line as? ReceiptLine.Text)?.align) {
                        Align.Centre -> 1
                        Align.Right -> 2
                        else -> 0
                    }

                    if (big) out.write(size(true))
                    if (emphasised) out.write(bold(true))
                    // Centring is done by the printer for text lines, so the
                    // renderer's own padding is trimmed off first — otherwise
                    // the line gets centred twice and drifts right.
                    val text = renderLine(line, width.columns)
                        .let { if (alignment != 0) it.trim() else it }
                    if (alignment != 0) out.write(align(alignment))

                    out.write(toCp437(text))
                    out.write(LF.toInt())

                    if (alignment != 0) out.write(align(0))
                    if (emphasised) out.write(bold(false))
                    if (big) out.write(size(false))
                }
            }
        }

        out.write(cut())
        return out.toByteArray()
    }

    /**
     * CP437, with the handful of substitutions a receipt actually needs.
     *
     * The interpunct and en dash come from the app's own strings, so they are
     * mapped rather than lost. Everything else outside ASCII becomes '?', which
     * is ugly but legible — unlike a raw high byte, which prints as a box-
     * drawing character and looks like a fault.
     */
    /**
     * The accented letters CP437 actually encodes.
     *
     * These were being replaced with '?' along with everything else non-ASCII,
     * which mangled a French catalogue on every receipt the shop hands out —
     * "Robe Bébé" printed as "Robe B?b?". CP437 has had these code points since
     * 1981; the printer renders them correctly, nothing was asking it to.
     *
     * One character still yields one byte, so the column arithmetic that lays
     * out a receipt is unaffected.
     */
    private val CP437_ACCENTS: Map<Char, Int> = mapOf(
        'ç' to 0x87, 'ü' to 0x81, 'é' to 0x82, 'â' to 0x83, 'ä' to 0x84,
        'à' to 0x85, 'å' to 0x86, 'ê' to 0x88, 'ë' to 0x89, 'è' to 0x8A,
        'ï' to 0x8B, 'î' to 0x8C, 'ì' to 0x8D, 'Ä' to 0x8E, 'Å' to 0x8F,
        'É' to 0x90, 'æ' to 0x91, 'Æ' to 0x92, 'ô' to 0x93, 'ö' to 0x94,
        'ò' to 0x95, 'û' to 0x96, 'ù' to 0x97, 'ÿ' to 0x98, 'Ö' to 0x99,
        'Ü' to 0x9A, 'ñ' to 0xA4, 'Ñ' to 0xA5, 'º' to 0xA7, 'ª' to 0xA6,
        'Ç' to 0x80, 'ß' to 0xE1, 'µ' to 0xE6, '°' to 0xF8,
    )

    internal fun toCp437(text: String): ByteArray {
        val out = ByteArray(text.length)
        for (i in text.indices) {
            val c = text[i]
            out[i] = when {
                c.code in 0x20..0x7E -> c.code.toByte()
                CP437_ACCENTS.containsKey(c) -> CP437_ACCENTS.getValue(c).toByte()
                c == '·' -> 0xFA.toByte()
                c == '–' || c == '—' -> '-'.code.toByte()
                c == '’' || c == '‘' -> '\''.code.toByte()
                c == '“' || c == '”' -> '"'.code.toByte()
                c == '…' -> '.'.code.toByte()
                else -> '?'.code.toByte()
            }
        }
        return out
    }
}
