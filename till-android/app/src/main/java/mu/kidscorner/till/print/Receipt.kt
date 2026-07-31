package mu.kidscorner.till.print

/**
 * A receipt as a list of lines, before it is anything a printer understands.
 *
 * This intermediate exists so the on-screen preview and the bytes that reach
 * the paper are generated from the *same* list. A preview built separately
 * drifts from what prints, and the first anyone knows about it is a customer
 * holding a receipt that does not match the screen.
 *
 * It also makes the layout testable without a printer, which matters here
 * because there is no printer to test against yet.
 */
sealed interface ReceiptLine {
    /** One run of text, optionally centred, bold or double-height. */
    data class Text(
        val text: String,
        val align: Align = Align.Left,
        val bold: Boolean = false,
        val big: Boolean = false,
    ) : ReceiptLine

    /** A label on the left and a figure on the right, filled with spaces. */
    data class Columns(
        val left: String,
        val right: String,
        val bold: Boolean = false,
        val big: Boolean = false,
        /** Indents the left side, for a variant under its product name. */
        val indent: Int = 0,
    ) : ReceiptLine

    /** A full-width rule of dashes. */
    data object Rule : ReceiptLine

    /** Vertical space. */
    data class Feed(val lines: Int = 1) : ReceiptLine

    /** A machine-readable sale number, where the printer supports it. */
    data class Barcode(val code: String) : ReceiptLine
}

enum class Align { Left, Centre, Right }

/**
 * Characters per line.
 *
 * Thermal printers are sized in millimetres of paper, not columns: a 58mm roll
 * fits 32 characters of Font A, an 80mm roll 48. Getting this wrong does not
 * error — it wraps mid-figure, so a total prints across two lines.
 */
enum class PaperWidth(val columns: Int, val label: String) {
    Mm58(32, "58 mm"),
    Mm80(48, "80 mm"),
}

/**
 * Lays a line list out as monospaced text.
 *
 * This is what the preview shows, and — byte encoding aside — exactly what the
 * printer receives, because `EscPos` renders from the same list through the
 * same column arithmetic.
 */
fun List<ReceiptLine>.toPlainText(width: PaperWidth): String =
    joinToString("\n") { line -> renderLine(line, width.columns) }

internal fun renderLine(line: ReceiptLine, columns: Int): String = when (line) {
    is ReceiptLine.Text -> {
        // A double-height line is also double-*width* on ESC/POS, so it fits
        // half as many characters. Laying it out against the full width would
        // silently wrap the shop name onto a second line.
        val usable = if (line.big) columns / 2 else columns
        val text = line.text.take(usable)
        when (line.align) {
            Align.Left -> text
            // Centred against the paper, not against the usable count. A
            // double-width glyph eats two columns, so a big line of n
            // characters occupies 2n — padding it by (usable - n) / 2 would sit
            // it left of centre in the preview while the printer centred it
            // properly, and the preview is supposed to be the receipt.
            Align.Centre -> {
                val occupies = if (line.big) text.length * 2 else text.length
                " ".repeat(((columns - occupies) / 2).coerceAtLeast(0)) + text
            }
            Align.Right -> text.padStart(usable)
        }
    }

    is ReceiptLine.Columns -> {
        val usable = if (line.big) columns / 2 else columns
        columnise(line.left, line.right, usable, line.indent)
    }

    ReceiptLine.Rule -> "-".repeat(columns)

    is ReceiptLine.Feed -> "\n".repeat((line.lines - 1).coerceAtLeast(0))

    is ReceiptLine.Barcode -> line.code
}

/**
 * Left label, right figure, one line, never wider than the paper.
 *
 * The right side is never truncated and the left always is. On a receipt the
 * figure is the whole point — a product name cut to "Cotton tee, short sl" is
 * still recognisable, an amount cut to "Rs 1,2" is a dispute at the counter.
 *
 * At least one space always separates them, so a long name cannot run into its
 * own price and read as a different number.
 */
internal fun columnise(left: String, right: String, columns: Int, indent: Int = 0): String {
    val pad = " ".repeat(indent.coerceAtLeast(0))
    // A label on its own — an approver's name, say — should not be padded out
    // to the full width with trailing spaces it does not need.
    if (right.isEmpty()) return (pad + left).take(columns)

    // The right side wins the whole line if it somehow exceeds it; nothing
    // useful can be shown alongside, and the figure still has to be readable.
    if (right.length >= columns) return right.takeLast(columns)

    val room = columns - right.length - 1
    val label = (pad + left).let { if (it.length > room) it.take(room) else it }
    return label.padEnd(columns - right.length) + right
}
