package mu.kidscorner.till.data

import java.math.BigDecimal
import java.math.MathContext
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs
import kotlin.math.sign

/**
 * The web till's money helpers, ported so the two screens never disagree about
 * a total by a cent.
 *
 * These figures are for display. The server re-prices every line and re-settles
 * every discount before committing, so a rounding difference here would be a
 * cosmetic bug, not a financial one — but a cashier reading Rs 340.00 on the
 * tablet and Rs 339.99 on the receipt would rightly stop trusting both.
 */

/**
 * Two decimal places, ties away from zero.
 *
 * The multiply-then-round-to-12-significant-digits step is not decoration. A
 * price like 1.005 is held in binary as 1.00499999999999989…, so rounding it
 * directly gives 1.00 where a person expects 1.01. Twelve digits is enough to
 * snap that back without disturbing any figure a shop actually deals in. The
 * TypeScript does the same thing with `toPrecision(12)`.
 */
fun round2(value: Double): Double {
    if (!value.isFinite()) return 0.0
    val scaled = BigDecimal(abs(value) * 100).round(MathContext(12)).toDouble()
    // `Math.round`, deliberately, NOT `kotlin.math.round`. Kotlin's is
    // ties-to-even — it is `rint` under the skin — so it rounds 100.5 down to
    // 100, and round2(1.005) came out as 1.00 where the web till and the
    // `complete_sale` RPC both say 1.01. Java's rounds ties up, which is what
    // JavaScript's Math.round does and therefore what the rest of this system
    // assumes. Applied after abs(), so "up" and "away from zero" agree.
    val rounded = sign(value) * Math.round(scaled).toDouble()
    // A negative input that rounds to zero yields -0.0, which formats as
    // "Rs -0.00". Collapsed here, because -0.0 == 0.0 is true and nothing
    // downstream can detect it — the sign only reappears at format time.
    return (if (rounded == 0.0) 0.0 else rounded) / 100
}

private val AMOUNT = DecimalFormat("#,##0.00", DecimalFormatSymbols(Locale.UK))
private val COUNT = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.UK))

/** `formatRs(1250.5)` -> `"Rs 1,250.50"` */
fun formatRs(value: Double): String = "Rs ${AMOUNT.format(round2(value))}"

/** Amount without the symbol, for rows that carry their own header. */
fun formatAmount(value: Double): String = AMOUNT.format(round2(value))

fun formatQty(value: Int): String = COUNT.format(value)

/** `"Rs 120.00 – Rs 340.00"`, collapsing to one value when they match. */
fun formatPriceRange(min: Double, max: Double): String =
    if (round2(min) == round2(max)) formatRs(min) else "${formatRs(min)} – ${formatRs(max)}"
