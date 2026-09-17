package mu.kidscorner.till.ui

/**
 * Where a finished gun burst goes. Decided by MainActivity from what is
 * actually on screen — never by focus, because scan mode holds none.
 */
sealed interface ScanRoute {
    /** Scan mode off, or a screen that takes no scans: keys flow through untouched. */
    data object None : ScanRoute

    /** The sell screen is showing: the code rings a line up. */
    data object Sell : ScanRoute

    /** Past sales is open: the code recalls a receipt. */
    data object Recall : ScanRoute

    /** Stock check is showing: the code looks the product up. */
    data object StockCheck : ScanRoute
}

/**
 * Assembles a keyboard-wedge gun burst without any text field.
 *
 * A wedge gun is a keyboard: characters arrive as key events with a
 * terminator (Enter) at the end. The old design caught them in a focused
 * (hidden) text field — but this terminal's IME shows itself on every focus
 * gain, suppression flag or not, so any focus-based capture summons the
 * keyboard. This takes the events in MainActivity.onKeyDown instead, where
 * no focus and no InputConnection exist for the IME to attach to.
 *
 * Pure — no Android imports — so the burst rules are unit-tested without a
 * device, the way the receipt layout is. The caller maps hardware keys to
 * [key]/[backspace]/[enter]; timing uses the event clock.
 *
 * @param interCharTimeoutMs a burst is keystrokes closer than this. A gun
 *   fires ~5–30ms apart; anything slower restarts the buffer, so a stray
 *   key can never glue itself onto the next scan.
 * @param minLength a terminator with fewer chars is stray noise (a lone
 *   Enter), not a code. Real barcodes and receipt codes are far longer.
 */
class WedgeScanner(
    private val interCharTimeoutMs: Long = 150,
    private val minLength: Int = 3,
) {
    private val buf = StringBuilder()
    private var lastAtMs: Long = Long.MIN_VALUE

    /**
     * One decoded character from the gun. Returns a finished code when this
     * character completes one, else null. Control characters are dropped —
     * only the terminator, handled in [enter], ends a burst.
     */
    fun key(unicodeChar: Int, eventTimeMs: Long): String? {
        if (unicodeChar < 32 || unicodeChar == 127) return null
        if (buf.isNotEmpty() && eventTimeMs - lastAtMs > interCharTimeoutMs) buf.clear()
        lastAtMs = eventTimeMs
        buf.append(unicodeChar.toChar())
        return null
    }

    /** The gun's terminator. Returns the burst, or null when it was noise. */
    fun enter(): String? {
        val code = buf.toString().trim()
        buf.clear()
        return code.takeIf { it.length >= minLength }
    }

    fun backspace() {
        if (buf.isNotEmpty()) buf.deleteCharAt(buf.length - 1)
    }

    fun reset() {
        buf.clear()
    }
}
