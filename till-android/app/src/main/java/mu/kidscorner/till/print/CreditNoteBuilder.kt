package mu.kidscorner.till.print

import mu.kidscorner.till.data.formatAmount

/**
 * What a printed credit note needs to know, gathered from the refund response
 * and the sale it was raised against.
 *
 * The VAT fields are the credit note's OWN frozen snapshot — reversed from the
 * original sale, never today's setting. So a return against a VAT sale prints a
 * VAT credit note even after the shop has since disabled VAT, and a return
 * against a non-VAT sale prints a plain credit note even after it registers.
 */
data class CreditNoteDoc(
    val creditNo: String,
    /** The sale this reverses, when the till knows it. */
    val saleNo: String?,
    val dateIso: String,
    val refundMethod: String,
    val total: Double,
    val vatEnabled: Boolean,
    val vatRate: Double,
    val vatNumber: String?,
    val vatAmount: Double,
    val cashierName: String? = null,
)

/**
 * Turns a credit note into printable lines.
 *
 * Same separation as [buildReceipt]: text only, no ESC/POS, so the layout can be
 * checked against expected strings without a printer. A second copy prints a
 * REPRINT banner for the same reason a receipt does — a credit note is a claim
 * on the drawer, and a duplicate must be visible as one.
 */
fun buildCreditNote(
    doc: CreditNoteDoc,
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

    // The document type follows the credit note's frozen VAT status. Explicit,
    // not inferred from the amount — a VAT credit note that happens to reverse
    // zero VAT is still a VAT credit note.
    val title = if (doc.vatEnabled) "VAT CREDIT NOTE" else "CREDIT NOTE"
    add(ReceiptLine.Text(title, Align.Centre, bold = true))
    add(ReceiptLine.Text("No. ${doc.creditNo}", Align.Centre, bold = true))
    if (reprint) {
        add(ReceiptLine.Text("*** REPRINT ***", Align.Centre, bold = true))
    }
    doc.saleNo?.let { add(ReceiptLine.Text("Against sale $it", Align.Centre)) }
    add(ReceiptLine.Text(readableDate(doc.dateIso), Align.Centre))
    add(ReceiptLine.Rule)

    // The refund itself.
    add(
        ReceiptLine.Text(
            "Refunded ${methodLabel(doc.refundMethod)} : " + suffixed(doc.total, currency),
            Align.Centre,
            bold = true,
        ),
    )

    // The VAT reversed, on a VAT credit note only — a plain credit note carries
    // no VAT, tax or exclusive wording at all.
    if (doc.vatEnabled) {
        val base = doc.total - doc.vatAmount
        add(ReceiptLine.Rule)
        add(ReceiptLine.Text("VAT reversed : " + suffixed(doc.vatAmount, currency)))
        val both = "excl. VAT = " + suffixed(base, currency) +
            " / Incl. tax = " + suffixed(doc.total, currency)
        if (both.length <= w) {
            add(ReceiptLine.Text(both))
        } else {
            add(ReceiptLine.Text("excl. VAT = " + suffixed(base, currency)))
            add(ReceiptLine.Text("Incl. tax = " + suffixed(doc.total, currency)))
        }
    }
    add(ReceiptLine.Rule)

    doc.cashierName?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    // The registration number frozen on the credit note, not the shop's current
    // one — and only on a VAT credit note.
    if (doc.vatEnabled) {
        doc.vatNumber?.takeIf { it.isNotBlank() }?.let {
            add(ReceiptLine.Text("VAT number : ${it.removePrefix("VAT").trim()}", Align.Centre))
        }
    }
    add(ReceiptLine.Feed())
    add(ReceiptLine.Barcode(doc.creditNo))
}
