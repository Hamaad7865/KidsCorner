package mu.kidscorner.till.print

import mu.kidscorner.till.data.ZTotals
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatQty

/**
 * The end-of-day slip.
 *
 * Built from the FROZEN totals a close returned, never from live figures — the
 * whole point of freezing them is that the paper in the shop's file and a
 * reprint next month say the same thing.
 *
 * Laid out in the order a person checks it: what the drawer should hold and
 * what it did, then the takings broken down, then the detail. Somebody counting
 * cash at closing time wants the variance in the first few lines, not after
 * three sections of category analysis.
 */
fun buildZReport(
    z: ZTotals,
    shop: ShopIdentity,
    width: PaperWidth,
    zNo: String,
    countedCash: Double,
    variance: Double,
    reprint: Boolean = false,
    currency: String = "Rs",
): List<ReceiptLine> = buildList {
    add(ReceiptLine.Text(shop.name, Align.Centre, bold = true, big = true))
    shop.address?.takeIf { it.isNotBlank() }?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    shop.vatNumber?.takeIf { it.isNotBlank() }?.let {
        add(ReceiptLine.Text("VAT $it", Align.Centre))
    }

    add(ReceiptLine.Feed())
    add(ReceiptLine.Text("Z REPORT  $zNo", Align.Centre, bold = true))
    add(ReceiptLine.Text(readableDate(z.asAt), Align.Centre))
    add(ReceiptLine.Text("Opened ${readableDate(z.openedAt)}", Align.Centre))

    if (reprint) {
        add(ReceiptLine.Feed())
        add(ReceiptLine.Text("*** REPRINT ***", Align.Centre, bold = true))
    }

    // ---------------------------------------------------------- the drawer
    //
    // First, because it is why the slip is being printed. Everything below is
    // analysis; this is the bit somebody signs.
    add(ReceiptLine.Rule)
    add(ReceiptLine.Text("CASH DRAWER", bold = true))
    add(ReceiptLine.Columns("Opening float", formatAmount(z.openingFloat)))
    add(ReceiptLine.Columns("Cash sales", formatAmount(z.cashTaken)))
    if (z.tillMovements != 0.0) {
        add(ReceiptLine.Columns("Paid in / out", formatAmount(z.tillMovements)))
    }
    // Shown whenever cash went back, because a drawer that is down by a refund
    // must say so on the slip somebody signs — otherwise it reads as a loss.
    if (z.cashRefunded != 0.0) {
        add(ReceiptLine.Columns("Cash refunds", "-${formatAmount(z.cashRefunded)}"))
    }
    add(ReceiptLine.Columns("EXPECTED", formatAmount(z.expectedCash), bold = true))
    add(ReceiptLine.Columns("COUNTED", formatAmount(countedCash), bold = true))
    add(
        ReceiptLine.Columns(
            when {
                variance == 0.0 -> "BALANCED"
                variance > 0 -> "OVER"
                else -> "SHORT"
            },
            formatAmount(if (variance < 0) -variance else variance),
            bold = true,
        ),
    )

    // Each movement listed, not just the net. A drawer short by exactly the
    // amount of one unexplained pay-out is a different conversation from a
    // drawer that is simply short.
    if (z.movements.isNotEmpty()) {
        add(ReceiptLine.Feed())
        add(ReceiptLine.Text("Cash in / out", bold = true))
        for (movement in z.movements) {
            add(ReceiptLine.Columns(movement.reason, formatAmount(movement.amount), indent = 2))
        }
    }

    // ---------------------------------------------------------- the takings
    add(ReceiptLine.Rule)
    add(ReceiptLine.Text("SALES", bold = true))
    add(ReceiptLine.Columns("Tickets", formatQty(z.tickets)))
    add(ReceiptLine.Columns("Items", formatQty(z.itemCount)))
    add(ReceiptLine.Columns("Average basket", formatAmount(z.avgBasket)))
    if (z.discountTotal > 0) {
        add(ReceiptLine.Columns("Discounts given", formatAmount(z.discountTotal)))
    }
    add(ReceiptLine.Columns("TOTAL $currency", formatAmount(z.salesTotal), bold = true))

    // ------------------------------------------------------------ payments
    if (z.methods.isNotEmpty()) {
        add(ReceiptLine.Rule)
        add(ReceiptLine.Text("PAYMENTS", bold = true))
        for (method in z.methods) {
            add(
                ReceiptLine.Columns(
                    "${method.count} ${methodLabel(method.method)}",
                    formatAmount(method.net),
                ),
            )
            // Only for cash, and only when change was actually given. On a card
            // line gross and net are the same figure and repeating it is noise.
            if (method.change > 0) {
                add(ReceiptLine.Columns("received", formatAmount(method.gross), indent = 2))
                add(ReceiptLine.Columns("change given", formatAmount(method.change), indent = 2))
            }
        }
    }

    // ----------------------------------------------------------------- VAT
    //
    // Kids Corner prices INCLUDE VAT, so `incl` is what the customer paid and
    // `excl` is what is left inside it. The two do not add up — that is the
    // point, and the labels say so.
    if (z.vat.isNotEmpty()) {
        add(ReceiptLine.Rule)
        add(ReceiptLine.Text("VAT (included in prices)", bold = true))
        for (band in z.vat) {
            add(ReceiptLine.Text(band.label))
            add(ReceiptLine.Columns("net of VAT", formatAmount(band.excl), indent = 2))
            add(ReceiptLine.Columns("VAT", formatAmount(band.vat), indent = 2))
            add(ReceiptLine.Columns("gross", formatAmount(band.incl), indent = 2))
        }
    }

    // ---------------------------------------------------------- categories
    if (z.categories.isNotEmpty()) {
        add(ReceiptLine.Rule)
        add(ReceiptLine.Text("BY CATEGORY", bold = true))
        for (category in z.categories) {
            add(
                ReceiptLine.Columns(
                    "${category.qty} ${category.name}",
                    formatAmount(category.incl),
                ),
            )
        }
    }

    // ------------------------------------------------------------ cashiers
    if (z.cashiers.size > 1 || z.cashiers.isNotEmpty()) {
        add(ReceiptLine.Rule)
        add(ReceiptLine.Text("BY CASHIER", bold = true))
        for (cashier in z.cashiers) {
            add(
                ReceiptLine.Columns(
                    "${cashier.saleCount} ${cashier.name}",
                    formatAmount(cashier.total),
                ),
            )
        }
    }

    // ------------------------------------------------------- what went wrong
    //
    // Printed only when non-zero, but never suppressed. A void or a refund is
    // exactly what an owner reading a Z is looking for.
    if (z.voided > 0 || z.refunded > 0 || z.credited > 0) {
        add(ReceiptLine.Rule)
        add(ReceiptLine.Text("ADJUSTMENTS", bold = true))
        if (z.voided > 0) add(ReceiptLine.Columns("Voided tickets", formatQty(z.voided)))
        if (z.refunded > 0) add(ReceiptLine.Columns("Refunded tickets", formatQty(z.refunded)))
        if (z.credited > 0) add(ReceiptLine.Columns("Credited", formatAmount(z.credited)))
    }

    add(ReceiptLine.Feed(2))
    add(ReceiptLine.Text("Signature", Align.Centre))
    add(ReceiptLine.Feed(2))
}
