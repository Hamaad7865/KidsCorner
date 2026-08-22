package mu.kidscorner.till.data

import kotlinx.serialization.Serializable

/**
 * Past sales, for looking one up and reprinting its receipt.
 *
 * Read straight from the server every time, never cached. A receipt is a claim
 * about what a customer paid; serving one from a tablet's stale copy — after a
 * return, a void, or a credit note — would hand somebody a document that
 * contradicts the shop's own records.
 */

@Serializable
data class SaleSummary(
    val id: Int,
    val saleNo: String,
    val saleDate: String,
    val total: Double,
    val status: String = "completed",
    val itemCount: Int = 0,
    val cashierName: String? = null,
    val customerName: String? = null,
)

@Serializable
data class SalesListResponse(
    val ok: Boolean = true,
    val sales: List<SaleSummary> = emptyList(),
    val error: String? = null,
)

@Serializable
data class SaleDetailLine(
    val id: Int,
    val productName: String,
    val sizeLabel: String = "",
    val colourName: String = "",
    val colourHex: String? = null,
    val sku: String = "",
    val barcode: String? = null,
    val qty: Int,
    val unitPrice: Double,
    val discount: Double = 0.0,
    val lineTotal: Double,
    /** How many of this line have already come back on a credit note. */
    val returnedQty: Int = 0,
) {
    /** What is still returnable. Never negative, whatever the server says. */
    val returnable: Int get() = (qty - returnedQty).coerceAtLeast(0)
}

@Serializable
data class SaleDetailPayment(
    val id: Int,
    val method: String,
    val amount: Double,
    val tendered: Double? = null,
)

@Serializable
data class SaleDetailDiscount(
    val label: String,
    val kind: String,
    val value: Double,
    val amount: Double,
    /** Null unless a manager actually had to authorise it. */
    val approvedByName: String? = null,
)

@Serializable
data class ReceiptPrint(
    val id: Int,
    val printedAt: String,
    val by: String? = null,
)

@Serializable
data class CreditNote(
    val id: Int,
    val creditNo: String,
    val createdAt: String,
    val total: Double,
    val reason: String = "",
    val refundMethod: String = "",
)

@Serializable
data class SaleDetail(
    val id: Int,
    val saleNo: String,
    val saleDate: String,
    val status: String = "completed",
    val subtotal: Double,
    val discount: Double = 0.0,
    val vatAmount: Double = 0.0,
    val total: Double,
    /**
     * The sale's frozen VAT policy. A reprint reads these, never today's shop
     * setting, so a receipt is a VAT invoice or a plain receipt exactly as it
     * was on the day.
     *
     * `vatEnabled` defaults true and `vatRate` to the historical 15% so a detail
     * decoded from a pre-feature build still renders as the VAT invoice it was.
     * `vatEnabled` is explicit, not inferred from `vatAmount > 0`, so an enabled
     * zero-total sale stays a VAT invoice.
     */
    val vatPolicyId: Long? = null,
    val vatEnabled: Boolean = true,
    val vatRate: Double = 0.15,
    val vatNumber: String? = null,
    val cashierName: String? = null,
    val customerName: String? = null,
    val customerId: Int? = null,
    val lines: List<SaleDetailLine> = emptyList(),
    val payments: List<SaleDetailPayment> = emptyList(),
    val discounts: List<SaleDetailDiscount> = emptyList(),
    val creditNotes: List<CreditNote> = emptyList(),
    /** Every time this receipt went to a printer, newest first. */
    val prints: List<ReceiptPrint> = emptyList(),
)

@Serializable
data class SaleDetailResponse(
    val ok: Boolean = true,
    val sale: SaleDetail? = null,
    val error: String? = null,
)

/**
 * A return, posted against a past sale.
 *
 * The till names what is coming back and why; it never names an amount. What
 * the customer gets is worked out server-side from what they actually paid for
 * those units, discount included. A till that could state its own refund total
 * would be a till that could empty the drawer.
 */
@Serializable
data class RefundRequest(
    val saleId: Int,
    val shiftId: Int? = null,
    val reason: String,
    val refundMethod: String,
    /** Off means faulty: refunded, but the goods do not rejoin the shelf. */
    val restock: Boolean = true,
    val items: List<RefundItem>,
    /**
     * This till's registry id, so the server refuses a refund aimed at another
     * drawer's shift — or at one already counted and closed.
     */
    val deviceId: Int? = null,
    /**
     * A manager's PIN, sent only when the shop has asked for one.
     *
     * Never held on to. It travels with the one request that needs it and is
     * dropped, exactly as the sale path treats its own approval — a PIN written
     * to a shared till's disk is a PIN anybody holding the tablet can read.
     */
    val approval: Approval? = null,
)

@Serializable
data class RefundItem(val saleItemId: Int, val qty: Int)

@Serializable
data class RefundResponse(
    val ok: Boolean = false,
    /**
     * The server wants a manager before it will pay anything back.
     *
     * Decided server-side and never by the device: only the settings row knows
     * whether this shop asks for approval, and a till that guessed would either
     * nag for nothing or skip a check the shop wanted.
     */
    val needsApproval: Boolean = false,
    val creditNo: String = "",
    val total: Double = 0.0,
    val refundMethod: String = "",
    /**
     * The credit note's frozen VAT, reversed from the original sale — a VAT sale
     * yields a VAT credit note even after the shop disables VAT, and a non-VAT
     * sale a non-VAT one even after it registers. The printed credit note reads
     * these, never today's setting. Legacy-compatible defaults: enabled true.
     */
    val vatPolicyId: Long? = null,
    val vatEnabled: Boolean = true,
    val vatRate: Double = 0.15,
    val vatNumber: String? = null,
    val vatAmount: Double = 0.0,
    val error: String? = null,
)

@Serializable
data class PrintResponse(
    val ok: Boolean,
    /** How many times this receipt has now been printed, original included. */
    val printCount: Int? = null,
    val error: String? = null,
)
