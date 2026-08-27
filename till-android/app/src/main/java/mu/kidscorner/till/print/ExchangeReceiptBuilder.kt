package mu.kidscorner.till.print

/** One line of an exchange — a designation already assembled, and its value. */
data class ExchangeReceiptLine(val label: String, val amount: Double)

/**
 * What a printed exchange receipt needs to know.
 *
 * An exchange is a return and a sale at once, so its receipt carries both sides:
 * the goods returned (valued at what the customer had paid), the goods taken
 * (at today's price), the credit those returns were worth, and the single gap
 * that settled the difference. `gap` is signed the way the till and the server
 * agree it is — positive the customer paid it, negative the shop handed it back.
 *
 * The VAT fields are the NEW sale's own frozen snapshot: the replacements are a
 * fresh sale rung under whatever policy is current, so a VAT exchange prints a
 * VAT line even if the returned sale predated registration, and a plain one
 * carries no VAT wording at all.
 */
data class ExchangeReceiptDoc(
    val newSaleNo: String,
    /** The sale the returns came from, when the till knows it. */
    val originalSaleNo: String?,
    val dateIso: String,
    val returned: List<ExchangeReceiptLine>,
    val replacements: List<ExchangeReceiptLine>,
    val creditTotal: Double,
    val newGoodsTotal: Double,
    /** Positive: the customer paid it. Negative: the shop refunded it. */
    val gap: Double,
    val settlementMethod: String,
    val vatEnabled: Boolean,
    val vatRate: Double = 0.0,
    val vatNumber: String? = null,
    val vatAmount: Double = 0.0,
    val cashierName: String? = null,
)

/**
 * Turns an exchange into printable lines.
 *
 * Same separation as [buildReceipt] and [buildCreditNote]: text only, no
 * ESC/POS, so the layout is checked against expected strings without a printer.
 * A second copy prints a REPRINT banner for the same reason a receipt does — an
 * exchange moves money, and a duplicate must be visible as one.
 */
fun buildExchangeReceipt(
    doc: ExchangeReceiptDoc,
    shop: ShopIdentity,
    width: PaperWidth,
    reprint: Boolean = false,
    currency: String = "Rs",
): List<ReceiptLine> = buildList {
    val w = width.columns

    add(ReceiptLine.Text(shop.name.uppercase(), Align.Centre, bold = true))
    shop.address?.takeIf { it.isNotBlank() }?.split(",", limit = 2)?.forEach { part ->
        part.trim().takeIf { it.isNotEmpty() }?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    }
    shop.phone?.takeIf { it.isNotBlank() }?.let { add(ReceiptLine.Text("Tel $it", Align.Centre)) }
    add(ReceiptLine.Rule)

    // The document type follows the new sale's frozen VAT status, explicit and
    // not inferred from the amount — a VAT exchange whose gap happens to be zero
    // is still a VAT document.
    add(ReceiptLine.Text(if (doc.vatEnabled) "VAT EXCHANGE" else "EXCHANGE", Align.Centre, bold = true))
    add(ReceiptLine.Text("No. ${doc.newSaleNo}", Align.Centre, bold = true))
    if (reprint) {
        add(ReceiptLine.Text("*** REPRINT ***", Align.Centre, bold = true))
    }
    doc.originalSaleNo?.let { add(ReceiptLine.Text("Against sale $it", Align.Centre)) }
    add(ReceiptLine.Text(readableDate(doc.dateIso), Align.Centre))
    add(ReceiptLine.Rule)

    // ── what came back, valued at what the customer had paid ─────────────────
    add(ReceiptLine.Text("RETURNED", bold = true))
    for (line in doc.returned) {
        add(ReceiptLine.Columns(line.label, plainAmount(line.amount)))
    }

    // ── what went out, at today's price ──────────────────────────────────────
    add(ReceiptLine.Text("NEW", bold = true))
    for (line in doc.replacements) {
        add(ReceiptLine.Columns(line.label, plainAmount(line.amount)))
    }
    add(ReceiptLine.Rule)

    // ── the two subtotals the gap is drawn between ───────────────────────────
    add(ReceiptLine.Columns("Credit", plainAmount(doc.creditTotal)))
    add(ReceiptLine.Columns("New goods", plainAmount(doc.newGoodsTotal)))
    add(ReceiptLine.Rule)

    // ── the single gap, named for the direction it ran ───────────────────────
    val method = methodLabel(doc.settlementMethod).uppercase()
    when {
        doc.gap > 0 -> add(ReceiptLine.Columns("PAID ($method)", plainAmount(doc.gap), bold = true))
        doc.gap < 0 -> add(ReceiptLine.Columns("REFUND ($method)", plainAmount(-doc.gap), bold = true))
        else -> add(ReceiptLine.Text("EVEN SWAP", Align.Centre, bold = true))
    }

    // ── VAT on the new goods, on a VAT exchange only ─────────────────────────
    if (doc.vatEnabled) {
        val base = doc.newGoodsTotal - doc.vatAmount
        add(ReceiptLine.Rule)
        add(ReceiptLine.Text("VAT on new goods : " + suffixed(doc.vatAmount, currency)))
        val both = "excl. VAT = " + suffixed(base, currency) +
            " / Incl. tax = " + suffixed(doc.newGoodsTotal, currency)
        if (both.length <= w) {
            add(ReceiptLine.Text(both))
        } else {
            add(ReceiptLine.Text("excl. VAT = " + suffixed(base, currency)))
            add(ReceiptLine.Text("Incl. tax = " + suffixed(doc.newGoodsTotal, currency)))
        }
    }
    add(ReceiptLine.Rule)

    // ── footer ───────────────────────────────────────────────────────────────
    // The same return policy the sale receipt carries, kept word-for-word in
    // step so the two never state different terms.
    wrapText("No return or refund on wedding dresses, suits or white shirts.", w)
        .forEach { add(ReceiptLine.Text(it, Align.Centre, bold = true)) }
    wrapText(
        if (w >= 40) "Exchange within 7 days with this receipt" else "Exchange within 7 days",
        w,
    ).forEach { add(ReceiptLine.Text(it, Align.Centre)) }
    // The registration number frozen on the new sale, not the shop's current
    // one, and only on a VAT exchange.
    if (doc.vatEnabled) {
        doc.vatNumber?.takeIf { it.isNotBlank() }?.let {
            add(ReceiptLine.Text("VAT number : ${it.removePrefix("VAT").trim()}", Align.Centre))
        }
    }
    doc.cashierName?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    add(ReceiptLine.Feed())
    // The recall code points at the NEW sale — scanning it pulls this exchange's
    // sale back up for a reprint, exactly as an ordinary receipt does.
    add(ReceiptLine.Qr(doc.newSaleNo))
    add(ReceiptLine.Text("Scan at the till to recall", Align.Centre))
    add(ReceiptLine.Feed())
    add(ReceiptLine.Barcode(doc.newSaleNo))
}
