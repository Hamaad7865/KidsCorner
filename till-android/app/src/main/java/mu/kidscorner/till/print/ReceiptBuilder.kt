package mu.kidscorner.till.print

import mu.kidscorner.till.data.SaleDetail
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatQty

/**
 * Details the shop puts at the top of every receipt.
 *
 * `vatNumber` is not optional decoration in Mauritius: a VAT-registered
 * business must show its registration number on the receipts it issues. It is
 * nullable here only because the setting may not be filled in yet — the builder
 * omits the line rather than printing "null", and the settings screen is where
 * that gets fixed.
 */
data class ShopIdentity(
    val name: String,
    val address: String? = null,
    val phone: String? = null,
    val vatNumber: String? = null,
)

/**
 * Turns a sale into a receipt.
 *
 * Composes the line list only — nothing here knows about ESC/POS, Bluetooth, or
 * paper. That separation is what lets the layout be tested against expected
 * text, which is the only verification available while there is no printer.
 *
 * `reprintNumber` is 1 for the original. Anything higher prints a REPRINT
 * banner, deliberately prominent: a second copy of a receipt can be used to
 * claim a refund twice, and the person receiving it should be able to see at a
 * glance that it is not the original.
 *
 * `gift` prints the same receipt with every figure removed — what was bought
 * and where it came from, but not what it cost. It still carries the sale
 * number, because the whole point is that the recipient can exchange it.
 */
fun buildReceipt(
    sale: SaleDetail,
    shop: ShopIdentity,
    width: PaperWidth,
    reprintNumber: Int = 1,
    currency: String = "Rs",
    gift: Boolean = false,
): List<ReceiptLine> = buildList {
    add(ReceiptLine.Text(shop.name, Align.Centre, bold = true, big = true))
    shop.address?.takeIf { it.isNotBlank() }?.let {
        add(ReceiptLine.Text(it, Align.Centre))
    }
    shop.phone?.takeIf { it.isNotBlank() }?.let {
        add(ReceiptLine.Text("Tel $it", Align.Centre))
    }
    shop.vatNumber?.takeIf { it.isNotBlank() }?.let {
        add(ReceiptLine.Text("VAT $it", Align.Centre))
    }

    add(ReceiptLine.Feed())
    add(ReceiptLine.Text(sale.saleNo, Align.Centre, bold = true))
    add(ReceiptLine.Text(readableDate(sale.saleDate), Align.Centre))
    sale.cashierName?.let { add(ReceiptLine.Text("Served by $it", Align.Centre)) }
    sale.customerName?.let { add(ReceiptLine.Text(it, Align.Centre)) }

    if (reprintNumber > 1) {
        add(ReceiptLine.Feed())
        add(ReceiptLine.Text("*** REPRINT #$reprintNumber ***", Align.Centre, bold = true))
    }

    // A sale that has been voided or refunded must say so on its own face. A
    // reprint of a refunded sale that looks like a normal receipt is exactly
    // the document someone would use to claim the goods a second time.
    if (sale.status != "completed") {
        add(ReceiptLine.Feed())
        add(ReceiptLine.Text("*** ${sale.status.uppercase()} ***", Align.Centre, bold = true))
    }

    add(ReceiptLine.Rule)

    for (line in sale.lines) {
        add(ReceiptLine.Text(line.productName))

        val variant = listOf(line.colourName, line.sizeLabel)
            .filter { it.isNotBlank() && it != "—" }
            .joinToString(" ")
            .ifBlank { line.sku }

        // The arithmetic is shown rather than just the answer, because checking
        // it is most of what a receipt is for.
        // On a gift receipt the quantity stays and the money goes.
        val sum = if (gift) formatQty(line.qty) + " x" else
            "${formatQty(line.qty)} x ${formatAmount(line.unitPrice)}"
        val lineTotal = if (gift) "" else formatAmount(line.lineTotal)

        // Split onto two lines when they will not both fit.
        //
        // `columnise` only guarantees the RIGHT figure survives — it truncates
        // the left. On 58mm paper that put "2 x 565.71" out as "2 x 56", which
        // reads as a unit price of 56 and is worse than using another line of
        // paper. So the fit is checked here, where the width is known:
        // 2 for the indent, 2 for the gap between variant and sum, 1 for the
        // mandatory gap before the figure.
        val fits = 2 + variant.length + 2 + sum.length + 1 + lineTotal.length <= width.columns

        if (fits) {
            add(ReceiptLine.Columns("$variant  $sum", lineTotal, indent = 2))
        } else {
            add(ReceiptLine.Text("  $variant"))
            add(ReceiptLine.Columns(sum, lineTotal, indent = 2))
        }

        if (line.discount > 0 && !gift) {
            add(
                ReceiptLine.Columns(
                    left = "discount",
                    right = "-${formatAmount(line.discount)}",
                    indent = 2,
                ),
            )
        }
    }

    add(ReceiptLine.Rule)

    // Everything from here down is money, so a gift receipt stops here and
    // says why — a receipt that simply ends looks like it failed to print.
    if (gift) {
        add(ReceiptLine.Text("Gift receipt - no prices shown", Align.Centre))
        add(ReceiptLine.Feed())
        add(ReceiptLine.Text("Exchangeable with this receipt", Align.Centre))
        add(ReceiptLine.Feed())
        add(ReceiptLine.Feed())
        return@buildList
    }

    add(ReceiptLine.Columns("Subtotal", formatAmount(sale.subtotal)))

    for (discount in sale.discounts) {
        add(ReceiptLine.Columns(discount.label, "-${formatAmount(discount.amount)}"))
        // Named on the paper because that is the point of recording it: a
        // discount nobody can be named for is not an approved discount.
        discount.approvedByName?.let {
            add(ReceiptLine.Columns("approved by $it", "", indent = 2))
        }
    }

    add(ReceiptLine.Columns("TOTAL $currency", formatAmount(sale.total), bold = true))
    add(ReceiptLine.Columns("of which VAT", formatAmount(sale.vatAmount)))

    add(ReceiptLine.Feed())

    for (payment in sale.payments) {
        add(ReceiptLine.Columns(methodLabel(payment.method), formatAmount(payment.amount)))
        payment.tendered?.let { tendered ->
            add(ReceiptLine.Columns("given", formatAmount(tendered), indent = 2))
            val change = tendered - payment.amount
            if (change > 0) {
                add(ReceiptLine.Columns("CHANGE", formatAmount(change), bold = true))
            }
        }
    }

    if (sale.creditNotes.isNotEmpty()) {
        add(ReceiptLine.Rule)
        for (note in sale.creditNotes) {
            add(ReceiptLine.Columns("Credited ${note.creditNo}", "-${formatAmount(note.total)}"))
        }
    }

    add(ReceiptLine.Feed(2))
    add(ReceiptLine.Text("Thank you", Align.Centre))
    // The exchange terms are the one thing a customer comes back holding, so
    // they must not be the line that gets cut off. Narrow paper gets a wording
    // that fits rather than a truncated one.
    add(
        ReceiptLine.Text(
            if (width.columns >= 40) {
                "Exchange within 7 days with this receipt"
            } else {
                "Exchange within 7 days"
            },
            Align.Centre,
        ),
    )
    add(ReceiptLine.Feed())
    add(ReceiptLine.Barcode(sale.saleNo))
}

/** "29 Jul 2026 14:32" from an ISO timestamp, sliced rather than parsed. */
internal fun readableDate(iso: String): String {
    if (iso.length < 16) return iso
    val months = listOf(
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    )
    val month = iso.substring(5, 7).toIntOrNull()?.minus(1)?.takeIf { it in months.indices }
    return buildString {
        append(iso.substring(8, 10))
        append(" ")
        append(month?.let { months[it] } ?: iso.substring(5, 7))
        append(" ")
        append(iso.substring(0, 4))
        append("  ")
        append(iso.substring(11, 16))
    }
}

/** The shop's own words, not the database's. */
internal fun methodLabel(method: String): String = when (method) {
    "cash" -> "Cash"
    "card" -> "Card"
    "juice" -> "Juice"
    "myt_money" -> "my.t money"
    "bank" -> "Bank"
    else -> method
}
