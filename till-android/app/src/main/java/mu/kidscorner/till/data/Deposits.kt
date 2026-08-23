package mu.kidscorner.till.data

import kotlinx.serialization.Serializable

/**
 * The layaway wire shapes.
 *
 * A deposit order is NOT a sale. It holds goods for a customer against money
 * down; the sale is written on pickup (an ordinary one, printable and
 * returnable through every path that already exists). Everything here is a
 * mirror of the deposit endpoints under `api/till` on the server, and the
 * server re-derives every figure from its own ledgers — amounts posted by
 * this app are claims, not facts.
 *
 * All flows are online-only, like refunds and account settlements: money is
 * accepted or refused against state only the server knows, so there is no
 * queue and no replay-from-disk.
 */

// ── requests ─────────────────────────────────────────────────────────────────

@Serializable
data class DepositItemInput(
    val variantId: Int,
    val qty: Int,
    /** Read but not trusted — the server clamps it to the line. */
    val discount: Double = 0.0,
)

@Serializable
data class DepositPaymentInput(
    val method: String,
    val amount: Double,
    /** Cash handed over beyond the amount; change comes back out of it. */
    val tendered: Double? = null,
)

@Serializable
data class CreateDepositRequest(
    val customerId: Int,
    val items: List<DepositItemInput>,
    /** Null for a pure reservation: goods held, nothing taken yet. */
    val payment: DepositPaymentInput? = null,
    /** YYYY-MM-DD, optional. Overdue orders are flagged, never auto-cancelled. */
    val collectBy: String? = null,
    val note: String? = null,
    /** Required when the first payment is cash — notes go into a drawer. */
    val shiftId: Int? = null,
    val deviceId: Int? = null,
    /**
     * Present only when a line carries money off. Sent at the moment of
     * commit rather than exchanged for a token earlier, exactly as sales do:
     * anything the device mints can be forged by whoever holds it.
     */
    val approval: Approval? = null,
    /** Names this attempt across retries; a replay answers with the same order. */
    val idempotencyKey: String,
)

@Serializable
data class DepositTopUpRequest(
    val method: String,
    val amount: Double,
    val tendered: Double? = null,
    val shiftId: Int? = null,
    val deviceId: Int? = null,
    val idempotencyKey: String,
)

/** One line being taken home on this visit. */
@Serializable
data class DepositPickLine(
    val itemId: Long,
    val qty: Int,
)

@Serializable
data class DepositCollectRequest(
    val lines: List<DepositPickLine>,
    /** Fresh money taken today. May be empty when deposits cover it all. */
    val payments: List<DepositPaymentInput> = emptyList(),
    val shiftId: Int,
    val deviceId: Int? = null,
    /** The VAT policy frozen when this attempt was confirmed, as checkouts do. */
    val vatPolicyId: Long? = null,
    /** Frozen confirmation instant, byte-for-byte across retries. */
    val checkedOutAt: String? = null,
    /** Becomes the sale's idempotency key — a retry replays the same sale. */
    val idempotencyKey: String,
)

@Serializable
data class DepositCancelRequest(
    val reason: String,
    /** Where refund cash leaves from. Required before cash can be refunded. */
    val shiftId: Int? = null,
    val deviceId: Int? = null,
    val idempotencyKey: String,
)

// ── responses ────────────────────────────────────────────────────────────────

@Serializable
data class DepositsListResponse(
    val ok: Boolean = true,
    val deposits: List<DepositSummaryRow> = emptyList(),
    val error: String? = null,
)

/**
 * One row of the till's layaway list.
 *
 * Defaults exist for cache compatibility, as everywhere on this till: an older
 * cached list must still render if the server grows new fields.
 */
@Serializable
data class DepositSummaryRow(
    val orderId: Int,
    val orderNo: String = "",
    val status: String = "open",
    val total: Double = 0.0,
    val balance: Double = 0.0,
    val unitsTotal: Int = 0,
    val unitsCollected: Int = 0,
    val collectBy: String? = null,
    val overdue: Boolean = false,
    val createdAt: String = "",
    val customerId: Int = 0,
    val customerName: String = "",
    val customerPhone: String? = null,
) {
    val remainingUnits: Int get() = (unitsTotal - unitsCollected).coerceAtLeast(0)
}

@Serializable
data class DepositCreateResponse(
    val ok: Boolean = false,
    val orderId: Int = 0,
    val orderNo: String = "",
    val total: Double = 0.0,
    val balance: Double = 0.0,
    val replayed: Boolean = false,
    val error: String? = null,
)

@Serializable
data class DepositTopUpResponse(
    val ok: Boolean = false,
    val paymentId: Long = 0,
    val paid: Double = 0.0,
    val balance: Double = 0.0,
    val replayed: Boolean = false,
    val error: String? = null,
)

@Serializable
data class DepositCollectResponse(
    val ok: Boolean = false,
    /** The ordinary sale this visit produced — printed through the normal path. */
    val saleId: Long = 0,
    val error: String? = null,
)

@Serializable
data class DepositCancelResponse(
    val ok: Boolean = false,
    val refunded: Double = 0.0,
    val cashRefunded: Double = 0.0,
    val releasedUnits: Int = 0,
    /** Cancelling twice answers calmly instead of refusing. */
    val alreadyCancelled: Boolean = false,
    val error: String? = null,
)

@Serializable
data class DepositDetailResponse(
    val ok: Boolean = true,
    val deposit: DepositDto? = null,
    val items: List<DepositItemDto> = emptyList(),
    val payments: List<DepositPaymentRow> = emptyList(),
    val pickups: List<DepositPickupDto> = emptyList(),
    val error: String? = null,
)

@Serializable
data class DepositDto(
    val orderId: Int,
    val orderNo: String = "",
    val status: String = "open",
    val total: Double = 0.0,
    val balance: Double = 0.0,
    val paidNet: Double = 0.0,
    /** Taken but not yet claimed by any pickup — what this visit can spend. */
    val unallocatedCredit: Double = 0.0,
    val collectBy: String? = null,
    val overdue: Boolean = false,
    val note: String? = null,
    val createdAt: String = "",
    val collectedAt: String? = null,
    val cancelledAt: String? = null,
    val cancelledReason: String? = null,
    val customerId: Int = 0,
    val customerName: String = "",
    val customerPhone: String? = null,
)

@Serializable
data class DepositItemDto(
    val itemId: Long,
    val variantId: Int = 0,
    val description: String = "",
    val qty: Int = 0,
    val collectedQty: Int = 0,
    val remaining: Int = 0,
    val unitPrice: Double = 0.0,
    val discount: Double = 0.0,
) {
    val fullyCollected: Boolean get() = remaining <= 0
}

@Serializable
data class DepositPaymentRow(
    val id: Long,
    /** 'payment' or 'refund' — signed in [amount], positive in, negative out. */
    val entryType: String = "payment",
    val amount: Double = 0.0,
    val method: String = "cash",
    val createdAt: String = "",
    val reason: String? = null,
)

@Serializable
data class DepositPickupDto(
    val saleId: Long,
    val saleNo: String = "",
    val saleDate: String = "",
    val total: Double = 0.0,
    val status: String = "completed",
)
