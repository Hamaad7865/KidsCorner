package mu.kidscorner.till.data

/**
 * The basket. Plain immutable state held by the ViewModel.
 *
 * Every figure here is what the *cashier and customer* see. None of it is sent
 * as fact: the sale posts variant ids and quantities, and the server rebuilds
 * the money from `product_variants`. So this is allowed to be a cache of prices
 * that may be minutes old — it can misinform, it cannot overcharge.
 */

data class CartLine(
    val variantId: Int,
    val productName: String,
    val variantLabel: String,
    val colourHex: String?,
    val sku: String,
    val unitPrice: Double,
    val qty: Int,
    /** Money off this line, not a percentage. */
    val discount: Double = 0.0,
    val qtyOnHand: Int,
    /**
     * The product's category.
     *
     * Carried so `categoryTotals` can be built on device: a rule naming a
     * category has to preview against that category's lines, because that is
     * the base `settleDiscounts` will use. Quote and charge from one base.
     */
    val categoryId: Int = 0,
    /**
     * A unit price the cashier set by hand, or null for the list price.
     *
     * Kept beside `discount` rather than replacing `unitPrice`, because
     * `unitPrice` is what the shop charges and the receipt shows both: the list
     * struck through, the agreed price under it. The difference is carried as
     * the line's discount, which is what the server already re-derives, clamps
     * and demands a manager for.
     */
    val priceOverride: Double? = null,
    /**
     * Set only on a custom line, and then it is the line's whole identity —
     * there is no product behind it.
     */
    val description: String? = null,
) {
    /**
     * A custom line: gift wrap, an alteration, stock with no label.
     *
     * Keyed by a NEGATIVE synthetic id so every cart operation — set quantity,
     * remove, discount — keeps working off `variantId` untouched. The sign is
     * what marks it, and it is stripped to null on the way to the server.
     */
    val isCustom: Boolean get() = variantId < 0
    val lineTotal: Double get() = round2(unitPrice * qty - discount)
}

data class CartTotals(
    val subtotal: Double = 0.0,
    val lineDiscounts: Double = 0.0,
    val saleDiscount: Double = 0.0,
    val total: Double = 0.0,
    val vat: Double = 0.0,
    val itemCount: Int = 0,
)

/**
 * Mirrors `cartTotals` in lib/pos/cart-store.ts, including the order of
 * operations: the sale-level discount is applied to what is left *after* line
 * discounts, and clamped so it can never drive the total below zero.
 *
 * VAT is contained in the total rather than added to it, matching the
 * `complete_sale` RPC: `total - total / (1 + rate)`.
 */
fun cartTotals(lines: List<CartLine>, saleDiscount: Double, vatRate: Double): CartTotals {
    val subtotal = round2(lines.sumOf { it.unitPrice * it.qty })
    val lineDiscounts = round2(lines.sumOf { it.discount })
    val afterLines = round2(subtotal - lineDiscounts)
    val applied = minOf(saleDiscount, afterLines)
    val total = round2(afterLines - applied)

    return CartTotals(
        subtotal = subtotal,
        lineDiscounts = lineDiscounts,
        saleDiscount = round2(applied),
        total = total,
        vat = round2(total - total / (1 + vatRate)),
        itemCount = lines.sumOf { it.qty },
    )
}

/**
 * Adds one of a variant, or bumps the line that is already there.
 *
 * Refuses to exceed stock on hand. That is a courtesy, not a guarantee — the
 * real one is the `qty_on_hand >= 0` constraint from migration 009, which is
 * what holds when two tills sell the last unit at the same moment. This just
 * stops the cashier finding out at the payment screen.
 */
fun List<CartLine>.withVariant(variant: CatalogVariant): List<CartLine> {
    val existing = firstOrNull { it.variantId == variant.id }
    if (existing != null) {
        if (existing.qty >= variant.qtyOnHand) return this
        return map { if (it.variantId == variant.id) it.copy(qty = it.qty + 1) else it }
    }
    if (variant.qtyOnHand < 1) return this

    return this + CartLine(
        variantId = variant.id,
        productName = variant.productName,
        variantLabel = variant.variantLabel,
        colourHex = variant.colourHex,
        sku = variant.sku,
        unitPrice = variant.price,
        qty = 1,
        qtyOnHand = variant.qtyOnHand,
        categoryId = variant.categoryId ?: 0,
    )
}

/**
 * Money off one line, as a percentage or a flat amount.
 *
 * Clamped to the line's own gross, so a discount can take a line to zero and no
 * further. Recomputed from the CURRENT quantity, not stored as a percentage — a
 * cashier who applies 10% and then bumps the quantity expects the discount to
 * follow, and `priceItems` on the server clamps whatever arrives against the
 * line's gross anyway.
 *
 * `null` clears it.
 */
fun List<CartLine>.withLineDiscount(
    variantId: Int,
    kind: String?,
    value: Double,
): List<CartLine> = map { line ->
    if (line.variantId != variantId) return@map line
    if (kind == null) return@map line.copy(discount = 0.0, priceOverride = null)

    val gross = round2(line.unitPrice * line.qty)
    val raw = if (kind == "percent") gross * value / 100 else value
    // Setting a chip discount drops any hand-set price: the line carries one
    // reduction, not two stacked on each other.
    line.copy(discount = round2(minOf(maxOf(0.0, raw), gross)), priceOverride = null)
}

/**
 * Sets a unit price by hand — `atSell`'s "Price" key in POS v2.
 *
 * The override is carried as this line's discount: `(list - agreed) x qty`.
 * That is not a trick, it is what it is — selling below the ticket price IS a
 * discount, and routing it here means it inherits everything that already
 * guards a discount: `priceItems` re-derives it from the catalogue and clamps
 * it to the line, and `settleDiscounts` demands a manager's PIN for any line
 * discount at all.
 *
 * A price ABOVE the list price is refused rather than clamped. There is nowhere
 * to record it — a negative discount is not a thing the schema has — so
 * accepting it would show one figure on screen and charge another. Raising a
 * price is the back office's job, not a counter's.
 *
 * `null` returns the line to the list price.
 */
fun List<CartLine>.withPriceOverride(variantId: Int, price: Double?): List<CartLine> = map { line ->
    if (line.variantId != variantId) return@map line
    if (price == null) return@map line.copy(priceOverride = null, discount = 0.0)

    val agreed = round2(price)
    if (agreed > line.unitPrice) return@map line

    line.copy(
        priceOverride = agreed,
        discount = round2((line.unitPrice - agreed) * line.qty),
    )
}

/**
 * What each category is worth in this cart, net of line discounts.
 *
 * The base a category-scoped rule is measured against. Mirrors the map
 * `settleDiscounts` builds server-side from the re-priced lines, so the figure
 * on screen is the figure charged.
 */
/**
 * Adds a custom line — `modalCustom` in POS v2.
 *
 * Its price is the cashier's word, so the server treats such a line the way it
 * treats a hand-set price: it takes the posted figure because there is nothing
 * to check it against, and demands a manager's PIN before the sale commits.
 *
 * The synthetic key counts down from -1 so two "Gift wrap" lines at different
 * prices stay separate rows rather than merging into one.
 */
fun List<CartLine>.withCustomItem(description: String, price: Double): List<CartLine> {
    val label = description.trim()
    if (label.isEmpty() || price <= 0) return this
    val nextKey = (minOfOrNull { it.variantId } ?: 0).coerceAtMost(0) - 1
    return this + CartLine(
        variantId = nextKey,
        productName = label,
        variantLabel = "Custom item",
        colourHex = null,
        sku = "",
        unitPrice = round2(price),
        qty = 1,
        // Not stock-tracked: there is no shelf behind it, so nothing caps the
        // quantity a cashier can ring up.
        qtyOnHand = Int.MAX_VALUE,
        description = label,
    )
}

fun List<CartLine>.categoryTotals(): Map<Int, Double> {
    val totals = mutableMapOf<Int, Double>()
    for (line in this) {
        totals[line.categoryId] = round2((totals[line.categoryId] ?: 0.0) + line.lineTotal)
    }
    return totals
}

/**
 * Sets a line's quantity, clamped to stock. Zero removes it.
 *
 * A hand-set price is per UNIT, so its discount is recomputed here — bumping
 * from 1 to 3 on an overridden line must charge the agreed price three times,
 * not leave a discount sized for one.
 */
fun List<CartLine>.withQty(variantId: Int, qty: Int): List<CartLine> =
    if (qty <= 0) {
        filterNot { it.variantId == variantId }
    } else {
        map { line ->
            if (line.variantId != variantId) return@map line
            val next = minOf(qty, line.qtyOnHand)
            line.copy(
                qty = next,
                // A hand-set price is per unit, so its discount is re-derived
                // for the new quantity. A chip discount is left alone: it was
                // sized against the old gross and `withLineDiscount` is where
                // it gets resized.
                discount = line.priceOverride
                    ?.let { round2((line.unitPrice - it) * next) }
                    ?: line.discount,
            )
        }
    }

fun List<CartLine>.without(variantId: Int): List<CartLine> =
    filterNot { it.variantId == variantId }
