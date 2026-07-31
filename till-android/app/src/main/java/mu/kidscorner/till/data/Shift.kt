package mu.kidscorner.till.data

import kotlinx.serialization.Serializable

/**
 * Opening, running and closing the drawer.
 *
 * `expectedCash` never originates here. It is recomputed on the server from the
 * sales ledger and the till-movement ledger, because it is the figure the day
 * reconciles against — a till that could post its own expected total could
 * close a short drawer as balanced.
 */

@Serializable
data class ShiftTotals(
    val saleCount: Int = 0,
    val salesTotal: Double = 0.0,
    val vatTotal: Double = 0.0,
    val discountTotal: Double = 0.0,
    val itemCount: Int = 0,
    val averageBasket: Double = 0.0,
    /** Money taken, keyed by payment method. */
    val byMethod: Map<String, Double> = emptyMap(),
    val byCashier: List<CashierTotal> = emptyList(),
    val openingFloat: Double = 0.0,
    val cashTaken: Double = 0.0,
    /** Signed sum of petty cash: negative means cash was taken out. */
    val tillMovements: Double = 0.0,
    /** What should physically be in the drawer. */
    val expectedCash: Double = 0.0,
)

@Serializable
data class CashierTotal(
    val cashierId: String? = null,
    val name: String = "Unknown",
    val saleCount: Int = 0,
    val total: Double = 0.0,
)

@Serializable
data class ShiftState(
    val ok: Boolean = true,
    val shift: OpenShift? = null,
    val totals: ShiftTotals? = null,
    val error: String? = null,
)

@Serializable
data class OpenShiftRequest(
    val openingFloat: Double,
    /** Which till this shift runs on. Null on a client that has not registered. */
    val deviceId: Int? = null,
)

@Serializable
data class OpenShiftResponse(
    val ok: Boolean,
    val shift: OpenShift? = null,
    val error: String? = null,
)

/**
 * Petty cash in or out.
 *
 * A positive amount plus a direction, never a signed figure. Asking someone at
 * a till to type a minus sign to take money out is how a pay-out gets recorded
 * as a pay-in — and the drawer then reconciles wrong by twice the amount.
 */
@Serializable
data class MovementRequest(
    val shiftId: Int,
    val amount: Double,
    /** "in" or "out". */
    val direction: String,
    val reason: String,
)

@Serializable
data class MovementResponse(val ok: Boolean, val error: String? = null)

@Serializable
data class CloseShiftRequest(
    val shiftId: Int,
    val countedCash: Double,
    val notes: String? = null,
)

@Serializable
data class CloseShiftResponse(
    val ok: Boolean,
    val countedCash: Double = 0.0,
    val expectedCash: Double = 0.0,
    val variance: Double = 0.0,
    /** The Z number on the slip, e.g. "Z00007". */
    val zNo: String = "",
    val zId: Int = 0,
    /** The frozen figures, travelling back with the close so the till can print. */
    val totals: ZTotals? = null,
    val error: String? = null,
)

/**
 * The Z report.
 *
 * Kids Corner prices are VAT-INCLUSIVE, so on a VAT band `incl` is what the
 * customer paid and `excl` is what is left inside it after the VAT. They do not
 * sum — the VAT is contained, not added.
 */
@Serializable
data class ZTotals(
    val shiftId: Int = 0,
    val openedAt: String = "",
    val asAt: String = "",
    val tickets: Int = 0,
    val salesTotal: Double = 0.0,
    val itemCount: Int = 0,
    val discountTotal: Double = 0.0,
    val avgBasket: Double = 0.0,
    val vatTotal: Double = 0.0,
    val methods: List<ZMethod> = emptyList(),
    val categories: List<ZCategory> = emptyList(),
    val vat: List<ZVatBand> = emptyList(),
    val cashiers: List<ZCashier> = emptyList(),
    val hourly: List<ZHour> = emptyList(),
    val topSellers: List<ZTopSeller> = emptyList(),
    val openingFloat: Double = 0.0,
    val cashTaken: Double = 0.0,
    val tillMovements: Double = 0.0,
    val movements: List<ZMovement> = emptyList(),
    val expectedCash: Double = 0.0,
    /** Refunds handed back in cash, already netted out of [expectedCash]. */
    val cashRefunded: Double = 0.0,
    val voided: Int = 0,
    val refunded: Int = 0,
    val credited: Double = 0.0,
)

@Serializable
data class ZMethod(
    val method: String,
    val count: Int = 0,
    /** What was handed over, including any change given back. */
    val gross: Double = 0.0,
    val change: Double = 0.0,
    /** What stayed in the drawer. */
    val net: Double = 0.0,
)

@Serializable
data class ZCategory(
    val name: String,
    val lines: Int = 0,
    val qty: Int = 0,
    /** Apportioned, so the categories add up to exactly what the shop took. */
    val incl: Double = 0.0,
)

@Serializable
data class ZVatBand(
    val rate: Double = 0.0,
    val label: String = "",
    val excl: Double = 0.0,
    val vat: Double = 0.0,
    val incl: Double = 0.0,
)

@Serializable
data class ZCashier(
    val cashierId: String? = null,
    val name: String = "Unknown",
    val saleCount: Int = 0,
    val total: Double = 0.0,
)

@Serializable
data class ZHour(val hour: Int = 0, val count: Int = 0, val total: Double = 0.0)

@Serializable
data class ZTopSeller(val name: String = "", val qty: Int = 0, val total: Double = 0.0)

@Serializable
data class ZMovement(val amount: Double = 0.0, val reason: String = "", val at: String = "")

@Serializable
data class ZResponse(
    val ok: Boolean = true,
    /** "x" for a live read of a trading drawer, "z" for a frozen slip. */
    val kind: String = "x",
    val zNo: String = "",
    val closedAt: String = "",
    val countedCash: Double = 0.0,
    val expectedCash: Double = 0.0,
    val variance: Double = 0.0,
    val totals: ZTotals? = null,
    val error: String? = null,
)

// -------------------------------------------------------------- customers

@Serializable
data class Customer(val id: Int, val fullName: String, val phone: String? = null)

@Serializable
data class CustomersResponse(
    val ok: Boolean = true,
    val customers: List<Customer> = emptyList(),
    val error: String? = null,
)

@Serializable
data class CreateCustomerRequest(val name: String, val phone: String? = null)

@Serializable
data class CreateCustomerResponse(
    val ok: Boolean,
    val customer: Customer? = null,
    val error: String? = null,
)

// -------------------------------------------------------------- discounts

@Serializable
data class DiscountRule(
    val id: Int,
    val name: String,
    val code: String? = null,
    /** "percent" or "amount". */
    val kind: String,
    val value: Double,
    val scope: String = "sale",
    /** When set, the rule only applies to lines in this category. */
    val categoryId: Int? = null,
    val minSpend: Double = 0.0,
    val maxAmount: Double? = null,
    /** Whether an owner or manager must type their PIN to apply this. */
    val requiresManager: Boolean = false,
) {
    /**
     * What this rule is measured against.
     *
     * Mirrors `discountBaseFor` on the server. `categoryId` means "only applies
     * to lines in this category", so a rule naming one is based on those lines
     * and not on the basket — quoting the basket figure and charging the
     * category figure is telling a customer one price and taking another.
     *
     * A line-scoped rule naming no category has no target the till can identify,
     * so it has no base. The server refuses it; this returns null so the till can
     * grey it out instead of offering a figure it cannot honour.
     */
    fun baseIn(basket: Double, categoryTotals: Map<Int, Double>): Double? {
        if (categoryId == null) return if (scope == "line") null else maxOf(0.0, basket)
        return maxOf(0.0, categoryTotals[categoryId] ?: 0.0)
    }

    /**
     * What this rule would take off a base, for the preview only.
     *
     * Mirrors `discountAmountFor` on the server, but the server's answer is the
     * one that counts — this can be stale or simply wrong without any effect on
     * what the customer is charged.
     */
    fun previewOn(base: Double): Double {
        val raw = if (kind == "percent") base * value / 100 else value
        val capped = maxAmount?.let { minOf(raw, it) } ?: raw
        return round2(minOf(maxOf(0.0, capped), base))
    }

    fun eligibleOn(basket: Double): Boolean = basket + 0.001 >= minSpend
}

@Serializable
data class DiscountsResponse(
    val ok: Boolean = true,
    val discounts: List<DiscountRule> = emptyList(),
    val error: String? = null,
)
