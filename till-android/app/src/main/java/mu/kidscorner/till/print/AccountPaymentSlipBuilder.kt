package mu.kidscorner.till.print

/**
 * What a printed account-payment slip needs to know.
 *
 * A payment against a tab is not a sale — no goods move and no VAT is due (the
 * VAT on the sales behind the balance was booked when they were rung up). So the
 * slip carries no VAT block at all: it is the customer's record that money was
 * received against their account, and what is left to pay.
 */
data class AccountPaymentSlipDoc(
    val customerName: String,
    val dateIso: String,
    val method: String,
    val amount: Double,
    /** The balance before this payment, so the slip shows the movement. */
    val previousBalance: Double,
    /** What is still owed after it — the figure the customer keeps. */
    val newBalance: Double,
    val cashierName: String? = null,
)

/**
 * Turns an account payment into printable lines.
 *
 * Same separation as [buildReceipt] and [buildCreditNote]: text only, no ESC/POS,
 * so the layout can be checked against expected strings without a printer. The
 * internal helpers ([suffixed], [plainAmount], [methodLabel], [readableDate],
 * [wrapText]) are shared with the sale receipt so wording and money formatting
 * stay identical across every document the till prints.
 */
fun buildAccountPaymentSlip(
    doc: AccountPaymentSlipDoc,
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

    add(ReceiptLine.Text("ACCOUNT PAYMENT", Align.Centre, bold = true))
    // Never truncated — a long Mauritian name would otherwise lose its surname on
    // 58mm paper, and it is the customer's own record of what they paid.
    wrapText("Customer : ${doc.customerName}", width.columns).forEach {
        add(ReceiptLine.Text(it, Align.Centre))
    }
    add(ReceiptLine.Text(readableDate(doc.dateIso), Align.Centre))
    add(ReceiptLine.Rule)

    // The payment itself.
    add(
        ReceiptLine.Text(
            "Paid ${methodLabel(doc.method)} : " + suffixed(doc.amount, currency),
            Align.Centre,
            bold = true,
        ),
    )
    add(ReceiptLine.Rule)

    // Where the account stood, and where it stands now. The new balance carries
    // the weight — it is the number the customer came to change.
    add(ReceiptLine.Columns("Previous balance :", plainAmount(doc.previousBalance)))
    add(
        ReceiptLine.Text(
            "Balance now : " + suffixed(doc.newBalance, currency),
            Align.Centre,
            bold = true,
        ),
    )
    add(ReceiptLine.Rule)

    doc.cashierName?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    add(ReceiptLine.Feed())
}
