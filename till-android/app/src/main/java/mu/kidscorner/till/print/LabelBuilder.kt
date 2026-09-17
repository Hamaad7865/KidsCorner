package mu.kidscorner.till.print

import mu.kidscorner.till.data.formatRs

/**
 * One shelf label: product over variant over price over barcode.
 *
 * A label is read at arm's length on a rail, not across a counter — so the
 * price is the biggest thing on it (double size, centred), the name above in
 * bold, and the EAN-13 symbol below tall enough to scan without peeling the
 * sticker off. Copies print as one job: N labels back to back with a feed
 * and a cut between them, so each tears off separately.
 */
fun buildLabel(
    productName: String,
    variantLabel: String,
    price: Double,
    barcode: String,
    width: PaperWidth,
): List<ReceiptLine> = buildList {
    add(ReceiptLine.Feed(1))
    add(ReceiptLine.Text(productName.take(width.columns), align = Align.Centre, bold = true))
    if (variantLabel.isNotBlank()) {
        add(ReceiptLine.Text(variantLabel.take(width.columns), align = Align.Centre))
    }
    add(ReceiptLine.Text(formatRs(price), align = Align.Centre, bold = true, big = true))
    add(ReceiptLine.Ean13(barcode))
    add(ReceiptLine.Feed(2))
}

/** A test sticker, so a new label printer proves itself before real labels. */
fun buildLabelTest(width: PaperWidth): List<ReceiptLine> = buildList {
    add(ReceiptLine.Feed(1))
    add(ReceiptLine.Text("Kids Corner", align = Align.Centre, bold = true))
    add(ReceiptLine.Text("Label printer test", align = Align.Centre))
    add(ReceiptLine.Text("Rs 100", align = Align.Centre, bold = true, big = true))
    add(ReceiptLine.Ean13("6291041000416"))
    add(ReceiptLine.Feed(2))
}
