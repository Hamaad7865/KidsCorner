package mu.kidscorner.till.print

/**
 * What a printed deposit slip needs to know.
 *
 * A deposit is not a sale — no goods have left and no VAT has fallen due — so,
 * like the account-payment slip, this carries no VAT block. It is the
 * customer's proof that goods are being held for them and money taken against
 * them, and the shop's promise of what is still owed and when to come back.
 */
data class DepositSlipDoc(
    val orderNo: String,
    val customerName: String,
    val customerPhone: String?,
    val dateIso: String,
    /** Frozen at deposit time by the server, exactly as it will be charged. */
    val items: List<DepositSlipLine>,
    val total: Double,
    val balance: Double,
    /** Optional promise date, YYYY-MM-DD. Absent prints no line at all. */
    val collectByIso: String? = null,
    val note: String? = null,
    val cashierName: String? = null,
)

data class DepositSlipLine(
    val description: String,
    val qty: Int,
    val unitPrice: Double,
    val discount: Double,
)

/** The slip after a top-up: same order, new running figures. */
data class DepositTopUpSlipDoc(
    val orderNo: String,
    val customerName: String,
    val dateIso: String,
    val method: String,
    val amountPaidNow: Double,
    val totalPaid: Double,
    val balance: Double,
    val collectByIso: String? = null,
    val cashierName: String? = null,
)

/** The slip after a cancellation: money going back, shelf getting stock back. */
data class DepositRefundSlipDoc(
    val orderNo: String,
    val customerName: String,
    val dateIso: String,
    val refunded: Double,
    val cashRefunded: Double,
    val releasedUnits: Int,
    val reason: String?,
    val cashierName: String? = null,
)

/**
 * Builds the deposit document a customer keeps.
 *
 * Same separation as [buildReceipt] and [buildCreditNote]: text only, no
 * ESC/POS, so the layout can be checked without a printer. Shared helpers keep
 * wording and money formatting identical across every document the till prints.
 */
fun buildDepositSlip(
    doc: DepositSlipDoc,
    shop: ShopIdentity,
    width: PaperWidth,
    currency: String = "Rs",
): List<ReceiptLine> = buildList {
    add(ReceiptLine.Text(shop.name.uppercase(), Align.Centre, bold = true))
    shop.address?.takeIf { it.isNotBlank() }?.split(",", limit = 2)?.forEach { part ->
        part.trim().takeIf { it.isNotEmpty() }?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    }
    shop.phone?.takeIf { it.isNotBlank() }?.let { add(ReceiptLine.Text("Tel $it", Align.Centre)) }
    add(ReceiptLine.Rule)

    add(ReceiptLine.Text("DEPOSIT", Align.Centre, bold = true))
    add(ReceiptLine.Text(doc.orderNo, Align.Centre))
    wrapText("Customer : ${doc.customerName}", width.columns).forEach {
        add(ReceiptLine.Text(it, Align.Centre))
    }
    doc.customerPhone?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    add(ReceiptLine.Text(readableDate(doc.dateIso), Align.Centre))
    add(ReceiptLine.Rule)

    // The held goods, at the prices frozen on opening day. These are the
    // numbers the customer will be charged at pickup however the shelf
    // changes between visits, so they are the ones that print.
    for (line in doc.items) {
        wrapText("  ${line.description}", width.columns).forEach {
            add(ReceiptLine.Text(it, Align.Left))
        }
        add(
            ReceiptLine.Columns(
                "    ${line.qty} x ${plainAmount(line.unitPrice)}",
                suffixed(line.qty * line.unitPrice - line.discount, currency),
            ),
        )
        if (line.discount > 0.0) {
            add(
                ReceiptLine.Columns(
                    "    discount",
                    "-${plainAmount(line.discount)}",
                ),
            )
        }
    }
    add(ReceiptLine.Rule)
    add(ReceiptLine.Columns("Total", suffixed(doc.total, currency)))
    add(
        ReceiptLine.Text(
            "Balance due : " + suffixed(doc.balance, currency),
            Align.Centre,
            bold = true,
        ),
    )
    doc.collectByIso?.let {
        add(ReceiptLine.Text("Please collect by ${readableDate(it)}", Align.Centre))
    }
    add(ReceiptLine.Rule)
    add(ReceiptLine.Text("Keep this slip — bring it when collecting", Align.Centre))
    doc.note?.takeIf { it.isNotBlank() }?.let { note ->
        wrapText(note, width.columns).forEach { add(ReceiptLine.Text(it, Align.Centre)) }
    }
    doc.cashierName?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    add(ReceiptLine.Feed())
}

/** Printed after extra money goes onto an open order. */
fun buildDepositTopUpSlip(
    doc: DepositTopUpSlipDoc,
    shop: ShopIdentity,
    width: PaperWidth,
    currency: String = "Rs",
): List<ReceiptLine> = buildList {
    add(ReceiptLine.Text(shop.name.uppercase(), Align.Centre, bold = true))
    shop.address?.takeIf { it.isNotBlank() }?.split(",", limit = 2)?.forEach { part ->
        part.trim().takeIf { it.isNotEmpty() }?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    }
    shop.phone?.takeIf { it.isNotBlank() }?.let { add(ReceiptLine.Text("Tel $it", Align.Centre)) }
    add(ReceiptLine.Rule)

    add(ReceiptLine.Text("DEPOSIT PAYMENT", Align.Centre, bold = true))
    add(ReceiptLine.Text(doc.orderNo, Align.Centre))
    wrapText("Customer : ${doc.customerName}", width.columns).forEach {
        add(ReceiptLine.Text(it, Align.Centre))
    }
    add(ReceiptLine.Text(readableDate(doc.dateIso), Align.Centre))
    add(ReceiptLine.Rule)

    add(
        ReceiptLine.Text(
            "Paid ${methodLabel(doc.method)} : " + suffixed(doc.amountPaidNow, currency),
            Align.Centre,
            bold = true,
        ),
    )
    add(ReceiptLine.Rule)
    add(ReceiptLine.Columns("Total paid :", plainAmount(doc.totalPaid)))
    add(
        ReceiptLine.Text(
            "Balance now : " + suffixed(doc.balance, currency),
            Align.Centre,
            bold = true,
        ),
    )
    doc.collectByIso?.let {
        add(ReceiptLine.Text("Please collect by ${readableDate(it)}", Align.Centre))
    }
    add(ReceiptLine.Rule)
    doc.cashierName?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    add(ReceiptLine.Feed())
}

/** Printed after a cancellation: what came back to whom. */
fun buildDepositRefundSlip(
    doc: DepositRefundSlipDoc,
    shop: ShopIdentity,
    width: PaperWidth,
    currency: String = "Rs",
): List<ReceiptLine> = buildList {
    add(ReceiptLine.Text(shop.name.uppercase(), Align.Centre, bold = true))
    shop.address?.takeIf { it.isNotBlank() }?.split(",", limit = 2)?.forEach { part ->
        part.trim().takeIf { it.isNotEmpty() }?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    }
    shop.phone?.takeIf { it.isNotBlank() }?.let { add(ReceiptLine.Text("Tel $it", Align.Centre)) }
    add(ReceiptLine.Rule)

    add(ReceiptLine.Text("DEPOSIT CANCELLED", Align.Centre, bold = true))
    add(ReceiptLine.Text(doc.orderNo, Align.Centre))
    wrapText("Customer : ${doc.customerName}", width.columns).forEach {
        add(ReceiptLine.Text(it, Align.Centre))
    }
    add(ReceiptLine.Text(readableDate(doc.dateIso), Align.Centre))
    add(ReceiptLine.Rule)

    if (doc.releasedUnits > 0) {
        add(
            ReceiptLine.Text(
                "${doc.releasedUnits} item${if (doc.releasedUnits == 1) "" else "s"} returned to the shelf",
                Align.Centre,
            ),
        )
    }
    add(
        ReceiptLine.Text(
            "Refunded : " + suffixed(doc.refunded, currency),
            Align.Centre,
            bold = true,
        ),
    )
    if (doc.cashRefunded > 0 && doc.cashRefunded < doc.refunded) {
        add(
            ReceiptLine.Columns(
                "  of which cash",
                suffixed(doc.cashRefunded, currency),
            ),
        )
    }
    doc.reason?.let { reason -> wrapText(reason, width.columns).forEach { add(ReceiptLine.Text(it, Align.Centre)) } }
    add(ReceiptLine.Rule)
    doc.cashierName?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    add(ReceiptLine.Feed())
}
