package mu.kidscorner.till.data

/**
 * A parked basket.
 *
 * Held sales are local to this device on purpose: parking one is a "hold this
 * while I fetch another size" action, not something the till at the other end
 * of the shop should see. Nothing about them has touched the database, so a
 * held sale has reserved no stock — the quantities are re-checked when it is
 * resumed and again when it is paid.
 *
 * Kept in memory only. A held sale that survived a reboot would be a basket
 * nobody remembers parking, quietly holding a customer's items against a stock
 * count that has since moved on.
 */
data class HeldSale(
    val id: String,
    val label: String,
    val lines: List<CartLine>,
    val customer: Customer?,
    val discount: AppliedDiscountLocal?,
    /** Epoch millis, for "held 6 minutes ago". */
    val heldAt: Long,
) {
    val itemCount: Int get() = lines.sumOf { it.qty }
    val total: Double get() = round2(lines.sumOf { it.unitPrice * it.qty - it.discount })
}

/**
 * `h.ago` — "just now", "6 min ago", "2 h ago".
 *
 * Coarse on purpose. The question a cashier is answering is "is this the basket
 * from a minute ago or the one from before lunch", and a figure that ticks over
 * every second invites reading it as precise when the clock behind it is a
 * device clock nobody has checked.
 */
fun heldAgo(heldAt: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = ((now - heldAt) / 60_000L).coerceAtLeast(0)
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min ago"
        minutes < 1_440 -> "${minutes / 60} h ago"
        else -> "${minutes / 1_440} d ago"
    }
}

/**
 * A discount the cashier has put on the basket, before the server settles it.
 *
 * `amount` here is a preview. `settleDiscounts` recomputes it from the rule row
 * at commit time, so this figure decides what the screen says and nothing else.
 */
data class AppliedDiscountLocal(
    val rule: DiscountRule?,
    val label: String,
    val kind: String,
    val value: Double,
    val amount: Double,
) {
    /** A manual discount has no rule behind it, so it always needs a manager. */
    val needsManager: Boolean get() = rule == null || rule.requiresManager

    fun toRequest(): AppliedDiscount = AppliedDiscount(
        discountId = rule?.id,
        label = label,
        kind = kind,
        value = value,
        amount = amount,
        approvedBy = null,
    )
}
