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
    val w = width.columns

    // ── identity ────────────────────────────────────────────────────────────
    // Carfectionist splits the address on its first comma into two centred
    // lines, so "Royal Road, Curepipe" reads as the shop's own two-line
    // letterhead rather than one long run that wraps wherever the paper ends.
    add(ReceiptLine.Text(shop.name.uppercase(), Align.Centre, bold = true))
    shop.address?.takeIf { it.isNotBlank() }?.split(",", limit = 2)?.forEach { part ->
        part.trim().takeIf { it.isNotEmpty() }?.let {
            add(ReceiptLine.Text(it, Align.Centre))
        }
    }
    shop.phone?.takeIf { it.isNotBlank() }?.let {
        add(ReceiptLine.Text("Tel $it", Align.Centre))
    }
    add(ReceiptLine.Rule)

    // A sale that has been voided or refunded says so before anything else.
    // A reprint of a refunded sale that looks ordinary is exactly the document
    // somebody would use to claim the goods a second time.
    if (sale.status != "completed") {
        add(ReceiptLine.Text("*** ${sale.status.uppercase()} ***", Align.Centre, bold = true))
        add(ReceiptLine.Rule)
    }

    // ── the numbered sale block ─────────────────────────────────────────────
    // The document type is the sale's own frozen status, never today's setting:
    // a VAT invoice while the sale was rung up registered, a plain receipt
    // otherwise. Explicit — an enabled zero-total sale is still a VAT invoice.
    add(ReceiptLine.Text("No. ${sale.saleNo}", Align.Centre, bold = true))
    add(
        ReceiptLine.Text(
            "${if (sale.vatEnabled) "VAT INVOICE" else "RECEIPT"} ${sale.saleNo}",
            Align.Centre,
            bold = true,
        ),
    )
    add(ReceiptLine.Text("Counter sale", Align.Centre))
    add(ReceiptLine.Text(readableDate(sale.saleDate), Align.Centre))
    // Never blank: a counter sale says so rather than leaving the customer
    // unidentified. Wrapped rather than truncated — a long Mauritian name
    // would otherwise lose its surname on 58mm paper, and it is the
    // customer's own receipt.
    wrapText("Customer : ${sale.customerName ?: "Walk-in"}", w).forEach {
        add(ReceiptLine.Text(it, Align.Centre))
    }
    if (reprintNumber > 1) {
        add(ReceiptLine.Text("*** REPRINT #$reprintNumber ***", Align.Centre, bold = true))
    }
    add(ReceiptLine.Rule)

    // ── items: Qty | Designation | UP | Total ───────────────────────────────
    // The money columns keep their width and the designation takes what is
    // left, so 58mm and 80mm both stay aligned instead of one of them wrapping.
    val qtyW = 4
    val numW = if (w >= 48) 10 else 8
    val nameW = (w - qtyW - numW * 2).coerceAtLeast(6)

    if (sale.lines.isNotEmpty() && !gift) {
        add(
            ReceiptLine.Text(
                "Qty".padEnd(qtyW) + "Designation".take(nameW).padEnd(nameW) +
                    "UP".padStart(numW) + "Total".padStart(numW),
            ),
        )
    }

    for (line in sale.lines) {
        val variant = listOf(line.colourName, line.sizeLabel)
            .filter { it.isNotBlank() && it != "—" }
            .joinToString(" ")
        // A garment needs its size and colour to be identifiable — "Cotton
        // socks" is three products. They go in the designation column with the
        // name, which is what that column is for.
        val designation = listOf(line.productName, variant)
            .filter { it.isNotBlank() }
            .joinToString(" ")

        if (gift) {
            // The quantity stays and the money goes.
            add(ReceiptLine.Text(formatQty(line.qty).padEnd(qtyW) + designation.take(w - qtyW)))
            continue
        }

        // The item carries the weight; its discount sub-lines stay light, so
        // the eye lands on what was bought and what it cost.
        add(
            ReceiptLine.Text(
                formatQty(line.qty).padEnd(qtyW) + designation.take(nameW).padEnd(nameW) +
                    plainAmount(line.unitPrice).padStart(numW) +
                    plainAmount(line.lineTotal).padStart(numW),
                bold = true,
            ),
        )
        if (line.discount > 0) {
            val gross = line.unitPrice * line.qty
            add(ReceiptLine.Text("Initial price : " + plainAmount(gross)))
            val pct = if (gross > 0) line.discount / gross * 100.0 else 0.0
            add(
                ReceiptLine.Text(
                    if (pct > 0) {
                        "Discount " + String.format("%.1f", pct) + "% / " + plainAmount(line.discount)
                    } else {
                        "Discount : " + plainAmount(line.discount)
                    },
                ),
            )
        }
    }
    add(ReceiptLine.Rule)

    // Everything below is money, so a gift receipt stops here and says why —
    // a receipt that simply ends looks like it failed to print.
    if (gift) {
        add(ReceiptLine.Text("Gift receipt - no prices shown", Align.Centre))
        add(ReceiptLine.Feed())
        // Same policy as a full receipt — the recipient is the one who exchanges.
        wrapText("No return or refund on wedding dresses, suits or white shirts.", w)
            .forEach { add(ReceiptLine.Text(it, Align.Centre, bold = true)) }
        wrapText(
            if (w >= 40) "Exchange within 7 days with this receipt" else "Exchange within 7 days",
            w,
        ).forEach { add(ReceiptLine.Text(it, Align.Centre)) }
        add(ReceiptLine.Feed(2))
        return@buildList
    }

    // ── totals ──────────────────────────────────────────────────────────────
    // Subtotal is the lines at full price and Discount is the gap to the
    // total, so Subtotal − Discount foots however the discount was stored —
    // per line, whole basket, or both.
    if (sale.lines.isNotEmpty()) {
        add(ReceiptLine.Columns("    Subtotal :", plainAmount(sale.subtotal)))
        val discount = sale.discounts.sumOf { it.amount } +
            sale.lines.sumOf { it.discount }
        if (discount > 0) {
            add(ReceiptLine.Columns("    Discount :", plainAmount(discount)))
        }
        for (d in sale.discounts) {
            // Named on the paper because that is the point of recording it: a
            // discount nobody can be named for is not an approved discount.
            d.approvedByName?.let {
                add(ReceiptLine.Text("    ${d.label} approved by $it"))
            }
        }
    }
    add(ReceiptLine.Text("Total: " + suffixed(sale.total, currency), Align.Centre, bold = true))
    // The exclusive figure is a VAT-invoice concept, so it is printed only when
    // the sale actually carried VAT — a plain receipt shows the total and stops.
    if (sale.lines.isNotEmpty() && sale.vatEnabled) {
        add(
            ReceiptLine.Text(
                "excl. VAT : " + suffixed(sale.total - sale.vatAmount, currency),
                Align.Centre,
                bold = true,
            ),
        )
    }
    add(ReceiptLine.Rule)

    // ── tenders ─────────────────────────────────────────────────────────────
    // The leading digit is the COUNT of tenders of that kind, as on the
    // reference slip — two cash legs of a split read "2   CASH", not "1"
    // twice. A voided sale never shows money as collected.
    if (sale.status == "completed") {
        sale.payments
            .groupBy { methodLabel(it.method).uppercase() }
            .forEach { (label, group) ->
                add(
                    ReceiptLine.Text(
                        "${group.size}   $label : " +
                            suffixed(group.sumOf { it.amount }, currency),
                        bold = true,
                    ),
                )
            }
        val change = sale.payments.sumOf { (it.tendered ?: it.amount) - it.amount }
        if (change > 0) {
            add(ReceiptLine.Columns("    Change :", plainAmount(change)))
        }
        add(ReceiptLine.Rule)
    }

    // ── tax breakdown ───────────────────────────────────────────────────────
    // Only on a VAT invoice: a plain receipt from an unregistered shop carries
    // no VAT, tax or exclusive wording at all. Printed in the reference's shape
    // so a second rate would slot in beside it rather than need a new section.
    if (sale.lines.isNotEmpty() && sale.vatEnabled) {
        val base = sale.total - sale.vatAmount
        add(ReceiptLine.Text("VAT : " + suffixed(sale.vatAmount, currency)))
        val both = "excl. VAT = " + suffixed(base, currency) +
            " / Incl. tax = " + suffixed(sale.total, currency)
        if (both.length <= w) {
            add(ReceiptLine.Text(both))
        } else {
            // 58mm cannot hold it on one line, so it breaks rather than
            // running off the edge of the paper.
            add(ReceiptLine.Text("excl. VAT = " + suffixed(base, currency)))
            add(ReceiptLine.Text("Incl. tax = " + suffixed(sale.total, currency)))
        }
        add(ReceiptLine.Rule)
    }

    if (sale.creditNotes.isNotEmpty()) {
        for (note in sale.creditNotes) {
            add(ReceiptLine.Columns("Credited ${note.creditNo}", "-${plainAmount(note.total)}"))
        }
        add(ReceiptLine.Rule)
    }

    // ── footer ──────────────────────────────────────────────────────────────
    // The shop's return policy. A few lines are final sale; everything else may
    // be exchanged within 7 days. Kept word-for-word in step with the web
    // receipt (app/receipt/[id]/page.tsx) so the two never state different terms.
    wrapText("No return or refund on wedding dresses, suits or white shirts.", w)
        .forEach { add(ReceiptLine.Text(it, Align.Centre, bold = true)) }
    wrapText(
        if (w >= 40) "Exchange within 7 days with this receipt" else "Exchange within 7 days",
        w,
    ).forEach { add(ReceiptLine.Text(it, Align.Centre)) }
    if (reprintNumber > 1) {
        add(ReceiptLine.Text("Duplicata $reprintNumber", Align.Centre))
    }
    // The registration number frozen on the sale, not the shop's current one:
    // a VAT invoice reprinted after the shop disabled VAT still shows the number
    // it was issued under, and a plain receipt shows none.
    if (sale.vatEnabled) {
        sale.vatNumber?.takeIf { it.isNotBlank() }?.let {
            add(ReceiptLine.Text("VAT number : ${it.removePrefix("VAT").trim()}", Align.Centre))
        }
    }
    sale.cashierName?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    add(ReceiptLine.Feed())
    add(ReceiptLine.Barcode(sale.saleNo))
}

/**
 * `1550.45` — two decimals, NO thousands separator.
 *
 * The reference's slip prints "2233.00", not "2,233.00": a comma in a column
 * that is already right-aligned buys nothing and costs a character of width on
 * paper that has 32 of them.
 */
internal fun plainAmount(value: Double): String = String.format("%.2f", value)

/** `1550.45Rs` — the reference puts the unit AFTER the figure. */
internal fun suffixed(value: Double, currency: String): String = plainAmount(value) + currency

/** Greedy word wrap, so a long name loses a line rather than its surname. */
internal fun wrapText(text: String, columns: Int): List<String> {
    val out = mutableListOf<String>()
    var line = StringBuilder()
    text.split(" ").forEach { word ->
        when {
            line.isEmpty() -> line.append(word)
            line.length + 1 + word.length <= columns -> line.append(' ').append(word)
            else -> { out += line.toString(); line = StringBuilder(word) }
        }
    }
    if (line.isNotEmpty()) out += line.toString()
    return out
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
