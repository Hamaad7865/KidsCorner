package mu.kidscorner.till.data

/**
 * What the live selling UI says about VAT, decided by the current policy.
 *
 * Lifted out of the composables so the rule — not the pixels — can be tested.
 * The single principle: while the shop is not VAT registered, every VAT, tax
 * and exclusive-price word disappears from the basket and the payment screen,
 * and the payable total is unchanged because prices are VAT-inclusive either
 * way. Historical reports are the opposite case and are driven by their own
 * frozen data, never by this current flag — see [shiftVatVisible].
 */
object VatDisplay {

    /**
     * The contained-VAT note under TOTAL on the sell screen, or null to omit it.
     *
     * Null while disabled — the line is removed, not rendered as "VAT 0%". The
     * rate is the effective rate, so an enabled shop shows "incl. VAT 15%".
     */
    fun sellVatNote(vatEnabled: Boolean, effectiveRate: Double, vatAmount: Double): String? {
        if (!vatEnabled) return null
        return "incl. VAT ${ratePercent(effectiveRate)}%  ${formatAmount(vatAmount)}"
    }

    /**
     * The total's label on the payment screen.
     *
     * "Total incl. tax" only when VAT is charged; a plain "Total" otherwise, so a
     * non-registered shop never implies tax it does not take.
     */
    fun paymentTotalLabel(vatEnabled: Boolean): String =
        if (vatEnabled) "Total incl. tax" else "Total"

    /**
     * Whether a shift report (X-read or Z) should draw its VAT section.
     *
     * Driven by the frozen bands the report actually carries, never the current
     * bootstrap: a mixed shift closed while VAT was on still shows its bands
     * after the shop disables VAT, and a shift that only ever sold with VAT off
     * carries no bands and shows nothing.
     */
    fun shiftVatVisible(bands: List<ZVatBand>): Boolean = bands.isNotEmpty()

    /** 0.15 -> 15, 0.125 -> 12 (whole percent, matching the sell-screen note). */
    private fun ratePercent(rate: Double): Int = (rate * 100).toInt()
}
