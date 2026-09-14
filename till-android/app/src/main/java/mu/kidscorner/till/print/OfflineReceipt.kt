package mu.kidscorner.till.print

import kotlinx.serialization.Serializable
import mu.kidscorner.till.data.formatQty

/**
 * An offline sale's printable snapshot — everything the paper needs, frozen at
 * checkout from local state (no server round trip).
 *
 * WHY A SNAPSHOT, NOT THE QUEUE PAYLOAD.
 *
 * `QueuedSale.payload` is a `SaleRequest`: variant ids + quantities only. Names,
 * prices and VAT display are deliberately absent (the server re-prices). A
 * reprint from the payload alone would need the catalog, whose prices may have
 * moved since — the reprint would then disagree with the original paper. This
 * snapshot carries what the customer actually saw, so original and reprint
 * match even after a price change.
 *
 * All money here is DISPLAY: the server re-derives the charge on sync. Queued
 * sales are approval-free (a manager PIN is never written to disk), so when the
 * catalog is fresh these figures equal the final invoice. When it is stale they
 * can differ by a price move — which is why the paper is bannered PROVISIONAL
 * and the final `S...` follows on sync.
 */
@Serializable
data class OfflineReceiptLineSnapshot(
    val productName: String,
    val sizeLabel: String = "",
    val colourName: String = "",
    val sku: String = "",
    val qty: Int,
    val unitPrice: Double,
    val discount: Double = 0.0,
    val lineTotal: Double,
)

@Serializable
data class OfflineReceiptPaymentSnapshot(
    val method: String,
    val amount: Double,
    val tendered: Double? = null,
)

@Serializable
data class OfflineReceiptDiscountSnapshot(
    val label: String,
    val amount: Double,
    val approvedByName: String? = null,
)

@Serializable
data class OfflineReceiptDoc(
    /** `OFF-07-260914-012`. Never `S...` — see `OfflineRefs`. */
    val provisionalRef: String,
    /** The idempotency key: links this paper to the queued row and final sale. */
    val saleKey: String,
    val saleDateIso: String,
    val cashierName: String? = null,
    val customerName: String? = null,
    val note: String? = null,
    val lines: List<OfflineReceiptLineSnapshot> = emptyList(),
    val payments: List<OfflineReceiptPaymentSnapshot> = emptyList(),
    val discounts: List<OfflineReceiptDiscountSnapshot> = emptyList(),
    val subtotal: Double,
    val total: Double,
    val vatAmount: Double,
    val change: Double = 0.0,
    /** Frozen policy at checkout (same freeze as the queued request). */
    val vatEnabled: Boolean = true,
    val vatNumber: String? = null,
)

val offlineReceiptJson = kotlinx.serialization.json.Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
}

fun encodeOfflineReceipt(doc: OfflineReceiptDoc): String =
    offlineReceiptJson.encodeToString(OfflineReceiptDoc.serializer(), doc)

fun decodeOfflineReceipt(raw: String?): OfflineReceiptDoc? {
    if (raw.isNullOrBlank()) return null
    return runCatching {
        offlineReceiptJson.decodeFromString(OfflineReceiptDoc.serializer(), raw)
    }.getOrNull()
}

/**
 * Turns an offline snapshot into receipt lines.
 *
 * Same shape as `buildReceipt` (same columns, tenders, VAT block, footer
 * policy wording) so a shop reads one layout, not two. Two deliberate
 * differences:
 * - Bannered `*** OFFLINE SALE — QUEUED ***` + provisional wording throughout;
 *   this paper is not the final VAT invoice, the `S...` that follows on sync is.
 * - Numbered by provisional ref; QR/barcode encode it (CODE39-safe), so a
 *   recall scan finds the queued row while offline and the mapping finds the
 *   final sale after.
 */
fun buildOfflineReceipt(
    doc: OfflineReceiptDoc,
    shop: ShopIdentity,
    width: PaperWidth,
    reprintNumber: Int = 1,
    currency: String = "Rs",
    vatCurrentlyEnabled: Boolean = true,
): List<ReceiptLine> = buildList {
    val w = width.columns
    val showVat = doc.vatEnabled && vatCurrentlyEnabled

    // ── identity (same as online) ─────────────────────────────────────
    add(ReceiptLine.Text(shop.name.uppercase(), Align.Centre, bold = true))
    shop.address?.takeIf { it.isNotBlank() }?.split(",", limit = 2)?.forEach { part ->
        part.trim().takeIf { it.isNotEmpty() }?.let {
            add(ReceiptLine.Text(it, Align.Centre))
        }
    }
    shop.phone?.takeIf { it.isNotBlank() }?.let {
        add(ReceiptLine.Text("Tel $it", Align.Centre))
    }
    val headerVatNumber = shop.vatNumber?.takeIf { it.isNotBlank() }?.let { "VAT${it.removePrefix("VAT").trim()}" }
    if (showVat && headerVatNumber != null) {
        add(ReceiptLine.Text(headerVatNumber, Align.Centre))
    }
    add(ReceiptLine.Rule)

    // ── provisional banner: the one thing that must read differently ──
    add(ReceiptLine.Text("*** OFFLINE SALE — QUEUED ***", Align.Centre, bold = true))
    add(ReceiptLine.Text("Provisional receipt — not final", Align.Centre))
    add(ReceiptLine.Rule)

    // ── numbered block ────────────────────────────────────────────────
    add(ReceiptLine.Text("No. ${doc.provisionalRef}", Align.Centre, bold = true))
    add(
        ReceiptLine.Text(
            "${if (showVat) "VAT INVOICE (PROVISIONAL)" else "RECEIPT (PROVISIONAL)"} ${doc.provisionalRef}",
            Align.Centre,
            bold = true,
        ),
    )
    add(ReceiptLine.Text("Counter sale", Align.Centre))
    add(ReceiptLine.Text(readableDate(doc.saleDateIso), Align.Centre))
    wrapText("Customer : ${doc.customerName ?: "Walk-in"}", w).forEach {
        add(ReceiptLine.Text(it, Align.Centre))
    }
    if (reprintNumber > 1) {
        add(ReceiptLine.Text("*** REPRINT #$reprintNumber ***", Align.Centre, bold = true))
    }
    add(ReceiptLine.Rule)

    // ── items (same columns as online) ────────────────────────────────
    val qtyW = 4
    val numW = if (w >= 48) 10 else 8
    val nameW = (w - qtyW - numW * 2).coerceAtLeast(6)

    if (doc.lines.isNotEmpty()) {
        add(
            ReceiptLine.Text(
                "Qty".padEnd(qtyW) + "Designation".take(nameW).padEnd(nameW) +
                    "UP".padStart(numW) + "Total".padStart(numW),
            ),
        )
    }

    for (line in doc.lines) {
        val variant = listOf(line.colourName, line.sizeLabel)
            .filter { it.isNotBlank() && it != "—" }
            .joinToString(" ")
        val designation = listOf(line.productName, variant)
            .filter { it.isNotBlank() }
            .joinToString(" ")

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

    // ── totals ────────────────────────────────────────────────────────
    if (doc.lines.isNotEmpty()) {
        add(ReceiptLine.Columns("    Subtotal :", plainAmount(doc.subtotal)))
        val discount = doc.discounts.sumOf { it.amount } +
            doc.lines.sumOf { it.discount }
        if (discount > 0) {
            add(ReceiptLine.Columns("    Discount :", plainAmount(discount)))
        }
        for (d in doc.discounts) {
            d.approvedByName?.let {
                add(ReceiptLine.Text("    ${d.label} approved by $it"))
            }
        }
    }
    add(ReceiptLine.Text("Total: " + suffixed(doc.total, currency), Align.Centre, bold = true))
    if (doc.lines.isNotEmpty() && showVat) {
        add(
            ReceiptLine.Text(
                "excl. VAT : " + suffixed(doc.total - doc.vatAmount, currency),
                Align.Centre,
                bold = true,
            ),
        )
    }
    add(ReceiptLine.Rule)

    // ── tenders (change shown even offline — cashier still owes coins now) ──
    doc.payments
        .groupBy { methodLabel(it.method).uppercase() }
        .forEach { (label, group) ->
            val amount = group.sumOf { it.amount }
            val text = if (amount < 0) {
                "${group.size}   $label REFUND : " + suffixed(-amount, currency)
            } else {
                "${group.size}   $label : " + suffixed(amount, currency)
            }
            add(ReceiptLine.Text(text, bold = true))
        }
    if (doc.change > 0) {
        add(ReceiptLine.Columns("    Change :", plainAmount(doc.change)))
    }
    add(ReceiptLine.Rule)

    // ── tax breakdown ─────────────────────────────────────────────────
    if (doc.lines.isNotEmpty() && showVat) {
        val base = doc.total - doc.vatAmount
        add(ReceiptLine.Text("VAT : " + suffixed(doc.vatAmount, currency)))
        val both = "excl. VAT = " + suffixed(base, currency) +
            " / Incl. tax = " + suffixed(doc.total, currency)
        if (both.length <= w) {
            add(ReceiptLine.Text(both))
        } else {
            add(ReceiptLine.Text("excl. VAT = " + suffixed(base, currency)))
            add(ReceiptLine.Text("Incl. tax = " + suffixed(doc.total, currency)))
        }
        add(ReceiptLine.Rule)
    }

    // ── note (prints on receipt, travels with held sale) ──────────────
    doc.note?.takeIf { it.isNotBlank() }?.let { note ->
        wrapText("Note: $note", w).forEach { add(ReceiptLine.Text(it, Align.Centre)) }
        add(ReceiptLine.Rule)
    }

    // ── footer (same policy wording as online, plus mapping line) ─────
    wrapText("No return or refund on wedding dresses, suits or white shirts.", w)
        .forEach { add(ReceiptLine.Text(it, Align.Centre, bold = true)) }
    wrapText(
        if (w >= 40) "Exchange within 7 days with this receipt" else "Exchange within 7 days",
        w,
    ).forEach { add(ReceiptLine.Text(it, Align.Centre)) }
    if (reprintNumber > 1) {
        add(ReceiptLine.Text("Duplicata $reprintNumber", Align.Centre))
    }
    if (showVat) {
        doc.vatNumber?.takeIf { it.isNotBlank() }?.let {
            val frozen = "VAT${it.removePrefix("VAT").trim()}"
            if (frozen != headerVatNumber) {
                add(ReceiptLine.Text("VAT number : ${it.removePrefix("VAT").trim()}", Align.Centre))
            }
        }
    }
    doc.cashierName?.let { add(ReceiptLine.Text(it, Align.Centre)) }
    add(ReceiptLine.Text("Final invoice follows when sent", Align.Centre))
    add(ReceiptLine.Text("Keep this to exchange", Align.Centre, bold = true))
    add(ReceiptLine.Feed())
    add(ReceiptLine.Qr(doc.provisionalRef))
    add(ReceiptLine.Text("Scan at the till to recall", Align.Centre))
    add(ReceiptLine.Feed())
    add(ReceiptLine.Barcode(doc.provisionalRef))
}
