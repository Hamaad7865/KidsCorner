package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import kotlin.math.ceil
import kotlin.math.abs
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.CallSplit
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.AppliedDiscountLocal
import mu.kidscorner.till.data.CartLine
import mu.kidscorner.till.data.CartTotals
import mu.kidscorner.till.data.Customer
import mu.kidscorner.till.data.VatDisplay
import mu.kidscorner.till.data.SalePayment
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatQty
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.ui.text.style.TextOverflow
import mu.kidscorner.till.data.nowDayAndClock

/**
 * `atPay` — reproduced from the handoff.
 *
 * `flex:1;display:flex` — a working column at `padding:14px 18px 16px; gap:12px`
 * beside a `width:400px` sale summary with `border-left:1px solid #E1E8E9`.
 *
 * The working column is a back button, the due card with **the outstanding
 * figure at 52px in IBM Plex Mono**, the methods as `repeat(4,1fr)`, and then a
 * `306px` pad column beside the quick amounts, the change panel and the 72px
 * primary.
 *
 * The design leads with what is still OWED rather than the sale total. On a
 * split payment those diverge, and the owed figure is the one that matters
 * after the first card goes through.
 *
 * The primary key does both jobs: below the outstanding it takes a part
 * payment, at or above it, it completes the sale. That is the handoff's own
 * `primaryTap`, and it is right — a cashier who has just typed the exact cash
 * should not have to find a second button.
 */
@Composable
fun PaymentScreen(
    totals: CartTotals,
    lines: List<CartLine>,
    paymentMethods: List<String>,
    cashierName: String,
    /** Whether the shop is VAT registered — chooses the total's label. */
    vatEnabled: Boolean,
    /** The effective rate, for the breakdown's VAT row. Unused while disabled. */
    vatRate: Double = 0.0,
    /** The sale-level discount applied on the sell screen, for the breakdown. */
    discount: AppliedDiscountLocal? = null,
    busy: Boolean,
    error: String?,
    frozen: Boolean,
    /** Whether the frozen sale may be parked; see TillState.settleParkable. */
    parkable: Boolean,
    /** The attached customer's account, driving the ON ACCOUNT tile. Null for a walk-in. */
    customer: Customer?,
    onConfirm: (List<SalePayment>, Double) -> Unit,
    /** Bills the whole outstanding balance to the attached account. */
    onCreditTender: () -> Unit,
    /** Resubmits the frozen sale under its original idempotency key. */
    onRetry: () -> Unit,
    /** Parks the frozen sale and frees the till for the next customer. */
    onPark: () -> Unit,
    onCancel: () -> Unit,
    /** Throw the cash drawer open — fired when a cashier picks Cash. */
    onOpenDrawer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var payments by remember { mutableStateOf<List<SalePayment>>(emptyList()) }
    var method by remember { mutableStateOf(paymentMethods.firstOrNull() ?: "cash") }
    var entry by remember { mutableStateOf("") }

    val paid = round2(payments.sumOf { it.amount })
    val outstanding = round2(maxOf(0.0, totals.total - paid))
    val entered = entry.toDoubleOrNull() ?: 0.0
    val isCash = method == "cash"
    val takeNow = round2(minOf(entered, outstanding))

    // What was handed over beyond the cash actually owed, including the row
    // about to be taken. Non-cash never produces change, and over-tendering on
    // one row does not offset another.
    val settledChange = payments.filter { it.method == "cash" }
        .sumOf { (it.tendered ?: it.amount) - it.amount }
    val pendingChange = if (isCash) maxOf(0.0, entered - outstanding) else 0.0
    val change = round2(maxOf(0.0, settledChange + pendingChange))

    val ready = entered > 0 && !busy && !frozen
    val completes = entered >= outstanding

    fun primaryTap() {
        if (takeNow <= 0) return
        val next = payments + SalePayment(
            method = method,
            // Never record more against a method than is outstanding: the
            // excess is change, not revenue.
            amount = takeNow,
            tendered = if (isCash) round2(entered) else null,
        )
        payments = next
        entry = ""
        if (completes) onConfirm(next, change) else method = paymentMethods.firstOrNull() ?: "cash"
    }

    // Which display card the numpad is feeding. Carfectionist lets a deposit
    // be typed into AMOUNT; here the amount follows what is outstanding until
    // a split is on, so the pad rests on the tender.
    var padOnAmount by remember { mutableStateOf(false) }

    /*
     * The tender starts AT the amount due rather than at zero.
     *
     * Exact is what most sales are, and an empty box made every one of them a
     * typing job before Record would even light. Keyed to the method and to
     * what is still outstanding, so switching to Card or taking a part payment
     * re-seeds it rather than leaving the last method's figure in the box.
     */
    LaunchedEffect(method, outstanding) {
        entry = if (outstanding > 0) trimZeros(outstanding) else ""
    }

    // ── splitting ───────────────────────────────────────────────────────────
    // Held here rather than in the ViewModel for the same reason `payments` is:
    // it is scratch until Record, and a sale that never completes should leave
    // nothing behind.
    var splitMode by remember { mutableStateOf(false) }
    var allocation by remember { mutableStateOf<Map<String, Double>>(emptyMap()) }
    var splitFocus by remember { mutableStateOf(paymentMethods.firstOrNull() ?: "cash") }
    var splitEntry by remember { mutableStateOf("") }
    var splitCashTender by remember { mutableStateOf(0.0) }

    fun splitAllocated() = round2(allocation.values.sum())

    fun recordSplit() {
        val rows = paymentMethods.mapNotNull { m ->
            val amount = allocation[m] ?: 0.0
            if (amount <= 0) null
            else SalePayment(
                method = m,
                amount = amount,
                // Only cash carries a tender: a card charged more than it
                // settles is an error, not change.
                tendered = if (m == "cash" && splitCashTender > amount) {
                    round2(splitCashTender)
                } else {
                    null
                },
            )
        }
        if (rows.isEmpty()) return
        val cashRow = allocation["cash"] ?: 0.0
        onConfirm(rows, round2(maxOf(0.0, splitCashTender - cashRow)))
    }
    val onAmount = padOnAmount && !isCash

    Column(
        modifier.fillMaxSize().background(Handoff.Canvas).padding(14.dp),
    ) {
        // ═══════════════════════════════════════════════════════ the header ══
        Row(
            Modifier.fillMaxWidth().padding(bottom = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Surface(
                onClick = onCancel,
                enabled = !busy && !frozen,
                shape = RoundedCornerShape(11.dp),
                color = Handoff.Surface,
                contentColor = Handoff.InkStrong,
                border = BorderStroke(1.dp, Handoff.Line),
                modifier = Modifier.height(46.dp),
            ) {
                Row(
                    Modifier.padding(start = 11.dp, end = 14.dp).fillMaxHeight(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, null, Modifier.size(16.dp))
                    Text("Back", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            Text(
                "PAYMENT",
                fontSize = 19.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.2.sp,
                color = Handoff.Ink,
            )
            /*
             * Carfectionist puts the invoice number and the customer here. At
             * this moment Kids Corner has neither: nothing is issued until
             * Record, and most baskets are walk-ins. What it does have is what
             * is being paid for and who is taking it, which is the same job —
             * naming the transaction standing in front of you.
             */
            Text(
                "${formatQty(totals.itemCount)} " +
                    (if (totals.itemCount == 1) "item" else "items") +
                    "  ·  " + cashierName,
                fontFamily = PlexMono,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                letterSpacing = 0.4.sp,
                color = Handoff.Muted,
                modifier = Modifier.weight(1f),
            )
            /*
             * Only offered when the shop has more than one way to be paid —
             * a split across one method is just a payment.
             */
            if (paymentMethods.size > 1) {
                Surface(
                    onClick = {
                        splitMode = !splitMode
                        // Neither mode inherits the other's half-finished
                        // work: carrying a typed tender into an allocation
                        // would silently pre-fill a row nobody chose.
                        entry = ""
                        splitEntry = ""
                        allocation = emptyMap()
                        splitCashTender = 0.0
                        payments = emptyList()
                    },
                    enabled = !busy && !frozen,
                    shape = RoundedCornerShape(11.dp),
                    color = if (splitMode) Handoff.AccentTint else Handoff.Surface,
                    contentColor = if (splitMode) Handoff.AccentText else Handoff.InkStrong,
                    border = BorderStroke(
                        if (splitMode) 2.dp else 1.dp,
                        if (splitMode) Handoff.AccentSolid else Handoff.Line,
                    ),
                    modifier = Modifier.height(46.dp),
                ) {
                    Row(
                        Modifier.padding(horizontal = 15.dp).fillMaxHeight(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(Icons.Default.CallSplit, null, Modifier.size(17.dp))
                        Text(
                            if (splitMode) "Single method" else "Split bill",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }

        // ═══════════════════════════════════ bill · methods · money ══════════
        Row(
            Modifier.fillMaxWidth().weight(1f),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // ── the bill ────────────────────────────────────────────────────
            Column(
                Modifier.weight(1f).fillMaxHeight()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Handoff.Surface)
                    .border(1.dp, Handoff.LineSoft, RoundedCornerShape(16.dp))
                    .padding(18.dp),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "KIDS CORNER",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.6.sp,
                            color = Handoff.Ink,
                        )
                        Text(
                            nowDayAndClock(),
                            fontFamily = PlexMono,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = Handoff.Muted,
                            modifier = Modifier.padding(top = 5.dp),
                        )
                        Text(
                            "${formatQty(totals.itemCount)} " +
                                if (totals.itemCount == 1) "item" else "items",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = Handoff.Muted,
                            modifier = Modifier.padding(top = 3.dp),
                        )
                    }
                    KcMark(size = 40)
                }

                Spacer(Modifier.height(14.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineSoft))
                Spacer(Modifier.height(12.dp))

                LazyColumn(
                    Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(11.dp),
                ) {
                    items(lines, key = { it.variantId }) { line -> BillLine(line) }
                }

                Spacer(Modifier.height(10.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineSoft))
                Spacer(Modifier.height(12.dp))

                // ── the fee breakdown ───────────────────────────────────────
                //
                // Subtotal, then every deduction, then VAT — the arithmetic
                // between what the shelf prices add up to and what the customer
                // actually pays, laid out so a cashier can read it out rather
                // than defend it. Each row is conditional on its own account
                // being non-zero, matching the sell screen's own basket footer:
                // a sale with nothing taken off shows nothing to explain.
                if (totals.lineDiscounts > 0 || totals.saleDiscount > 0) {
                    BreakdownRow("Subtotal", formatAmount(totals.subtotal), Handoff.Muted)
                    Spacer(Modifier.height(4.dp))
                }
                if (totals.lineDiscounts > 0) {
                    BreakdownRow(
                        "Line discounts",
                        "-${formatAmount(totals.lineDiscounts)}",
                        Handoff.WarnText,
                    )
                    Spacer(Modifier.height(4.dp))
                }
                if (discount != null && totals.saleDiscount > 0) {
                    BreakdownRow(
                        "Basket ${discountLabel(discount)}",
                        "-${formatAmount(totals.saleDiscount)}",
                        Handoff.WarnText,
                    )
                    Spacer(Modifier.height(4.dp))
                }
                VatDisplay.paymentVatRow(vatEnabled, vatRate, totals.vat)?.let { (label, amount) ->
                    BreakdownRow(label, amount, Handoff.Muted)
                    Spacer(Modifier.height(4.dp))
                }
                if (totals.lineDiscounts > 0 || totals.saleDiscount > 0 || vatEnabled) {
                    Spacer(Modifier.height(4.dp))
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineSoft))
                    Spacer(Modifier.height(10.dp))
                }

                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        VatDisplay.paymentTotalLabel(vatEnabled),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Handoff.Muted,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        formatRs(totals.total),
                        fontFamily = PlexMono,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.78).sp,
                        color = Handoff.InkFigure,
                    )
                }
            }

            if (splitMode) {
                SplitAllocation(
                    methods = paymentMethods,
                    total = totals.total,
                    allocation = allocation,
                    focus = splitFocus,
                    cashTendered = splitCashTender,
                    busy = busy,
                    frozen = frozen,
                    error = error,
                    parkable = parkable,
                    onFocus = { splitFocus = it; splitEntry = "" },
                    onKey = { key ->
                        splitEntry =
                            if (key == "back") splitEntry.dropLast(1)
                            else splitEntry.appendPadKey(key)
                        val typed = splitEntry.toDoubleOrNull() ?: 0.0
                        allocation = allocation + (splitFocus to round2(typed))
                        if (splitFocus == "cash") splitCashTender = round2(typed)
                    },
                    onClearRow = { m ->
                        allocation = allocation - m
                        if (m == "cash") splitCashTender = 0.0
                        if (m == splitFocus) splitEntry = ""
                    },
                    onFillRest = { m ->
                        val others = round2(
                            allocation.filterKeys { it != m }.values.sum(),
                        )
                        val rest = round2(maxOf(0.0, totals.total - others))
                        allocation = allocation + (m to rest)
                        if (m == "cash") splitCashTender = rest
                        splitEntry = trimZeros(rest)
                    },
                    onRecord = { recordSplit() },
                    onRetry = onRetry,
                    onPark = onPark,
                )
            } else {
                // ── means of payment ────────────────────────────────────────────
                Column(
                    Modifier.weight(1f).fillMaxHeight()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Handoff.Surface)
                        .border(1.dp, Handoff.LineSoft, RoundedCornerShape(16.dp))
                        .padding(18.dp),
                ) {
                    Text(
                        "MEANS OF PAYMENT",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.2.sp,
                        color = Handoff.Muted3,
                    )
                    Spacer(Modifier.height(14.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        paymentMethods.chunked(2).forEach { pair ->
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(14.dp),
                            ) {
                                pair.forEach { candidate ->
                                    Box(Modifier.weight(1f)) {
                                        MethodTile(
                                            method = candidate,
                                            selected = method == candidate,
                                            enabled = !busy && !frozen,
                                            onPick = {
                                                method = candidate
                                                entry = ""
                                            },
                                        )
                                    }
                                }
                                if (pair.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }

                        // ── ON ACCOUNT ─────────────────────────────────────
                        //
                        // A tender, but not one of `paymentMethods`: the server
                        // deliberately keeps "credit" out of
                        // settings.payment_methods, because every other tile is
                        // unconditional and this one is only legal for a named
                        // person with an open account. So it is drawn here,
                        // gated on the attached customer, instead of falling
                        // out of the bootstrap list where it could be pressed
                        // with nobody to bill.
                        CreditTile(
                            customer = customer,
                            outstanding = outstanding,
                            enabled = !busy && !frozen,
                            onCharge = onCreditTender,
                        )
                    }

                    if (payments.isNotEmpty()) {
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "ALREADY TAKEN",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.2.sp,
                            color = Handoff.Muted3,
                        )
                        Spacer(Modifier.height(8.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            payments.forEachIndexed { index, payment ->
                                TakenPayment(
                                    payment = payment,
                                    enabled = !busy && !frozen,
                                    onRemove = {
                                        payments = payments.filterIndexed { i, _ -> i != index }
                                    },
                                )
                            }
                        }
                    }
                }

                // ── the money ───────────────────────────────────────────────────
                Column(
                    Modifier.weight(1f).fillMaxHeight()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Handoff.Surface)
                        .border(1.dp, Handoff.LineSoft, RoundedCornerShape(16.dp))
                        .padding(18.dp),
                ) {
                    MoneyRow("Total", formatRs(totals.total), Handoff.InkFigure)
                    Spacer(Modifier.height(6.dp))
                    MoneyRow(
                        "Balance",
                        formatRs(outstanding),
                        // Amber while the customer still owes, quiet once settled.
                        // Carfectionist turns this green; Kids Corner has no green
                        // — the palette is white and the logo's red, and amber is
                        // already this shop's word for money still in the air.
                        if (outstanding > 0) Handoff.WarnText else Handoff.Muted3,
                    )
                    Spacer(Modifier.height(12.dp))
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineSoft))
                    Spacer(Modifier.height(12.dp))

                    Column(
                        Modifier.weight(1f).verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        DisplayCard(
                            label = "AMOUNT",
                            value = formatRs(if (entry.isBlank()) outstanding else takeNow),
                            highlight = onAmount,
                            onClick = { padOnAmount = true },
                        )
                        if (isCash) {
                            DisplayCard(
                                label = "CASH TENDERED",
                                value = formatRs(if (entry.isBlank()) 0.0 else entered),
                                highlight = !onAmount,
                                onClick = { padOnAmount = false },
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                QuickChip("Exact") { entry = trimZeros(outstanding) }
                                tenderChips(outstanding).forEach { note ->
                                    QuickChip(formatQty(note.toInt())) {
                                        entry = trimZeros(note)
                                    }
                                }
                            }
                            Row(
                                Modifier.fillMaxWidth().padding(top = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "Change",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Handoff.Muted,
                                )
                                Spacer(Modifier.weight(1f))
                                Text(
                                    formatRs(change),
                                    fontFamily = PlexMono,
                                    fontSize = 20.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (change > 0) Handoff.ChangeFigure else Handoff.Muted3,
                                )
                            }
                        }

                        /*
                         * Only cash needs keys. A card, a Juice transfer or a
                         * bank transfer settles the bill as it stands — there
                         * is no tender to count and no change to give, so a
                         * keypad there offers only the chance to mistype.
                         * Paying across several methods is Split bill's job,
                         * and it has its own.
                         */
                        if (isCash) {
                            NumPad(enabled = !busy && !frozen) { key ->
                                entry =
                                    if (key == "back") entry.dropLast(1)
                                    else entry.appendPadKey(key)
                            }
                        }
                    }

                    Spacer(Modifier.height(10.dp))
                    if (error != null) {
                        Text(error, fontSize = 13.sp, color = Handoff.Danger)
                        Spacer(Modifier.height(6.dp))
                    }
                    if (frozen) {
                        FrozenActions(
                            busy = busy,
                            parkable = parkable,
                            onRetry = onRetry,
                            onPark = onPark,
                        )
                        Spacer(Modifier.height(8.dp))
                    }

                    val recordable = ready && takeNow > 0
                    Surface(
                        onClick = { primaryTap() },
                        enabled = recordable,
                        shape = RoundedCornerShape(14.dp),
                        color = if (recordable) Handoff.AccentSolid else Handoff.Blocked,
                        contentColor = if (recordable) Color.White else Handoff.BlockedText,
                        shadowElevation = if (recordable) 6.dp else 0.dp,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                    ) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            if (busy) {
                                CircularProgressIndicator(Modifier.size(24.dp), Color.White, 2.dp)
                            } else {
                                Text(
                                    when {
                                        !recordable && isCash -> "Enter the cash received"
                                        !recordable -> "Enter an amount"
                                        completes -> "Record " + formatRs(takeNow)
                                        else ->
                                            "Take " + formatRs(takeNow) + " — " +
                                                formatRs(round2(outstanding - takeNow)) + " left"
                                    },
                                    fontSize = 16.5.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SummaryLine(line: CartLine) {
    Column {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "${line.qty}×",
                fontFamily = PlexMono,
                fontSize = 12.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.Muted,
                modifier = Modifier.width(22.dp),
            )
            Column(Modifier.weight(1f)) {
                Text(
                    line.productName,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    lineHeight = 17.55.sp,
                    color = Handoff.Ink,
                )
                Row(
                    Modifier.padding(top = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    line.colourHex?.let { ColourSwatch(it, size = 10) }
                    Text(line.variantLabel, fontSize = 11.5.sp, color = Handoff.Muted3)
                }
            }
            Text(
                formatAmount(line.lineTotal),
                fontFamily = PlexMono,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.Ink,
            )
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineFaint))
    }
}

/** `background:#F1FAF8; border:1px solid #DCEDEA; radius:10px` — a taken row. */
@Composable
private fun TakenPayment(payment: SalePayment, enabled: Boolean, onRemove: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 6.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Handoff.AccentTint)
            .border(1.dp, Handoff.AccentLine, RoundedCornerShape(10.dp))
            .padding(start = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f).padding(vertical = 9.dp)) {
            Text(
                methodLabel(payment.method),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.InkFigure,
            )
            payment.tendered?.takeIf { it > payment.amount }?.let {
                Text("${formatAmount(it)} given", fontSize = 11.sp, color = Handoff.Muted3)
            }
        }
        Text(
            formatAmount(payment.amount),
            fontFamily = PlexMono,
            fontSize = 13.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = Handoff.AccentText,
        )
        Surface(
            onClick = onRemove,
            enabled = enabled,
            shape = RoundedCornerShape(8.dp),
            color = Color.Transparent,
            contentColor = Handoff.Muted4,
            modifier = Modifier.size(30.dp),
        ) {
            Box(Modifier.fillMaxSize(), Alignment.Center) {
                Icon(Icons.Default.Close, "Remove payment", Modifier.size(15.dp))
            }
        }
    }
}

@Composable
private fun SummaryRow(
    label: String,
    value: String,
    labelSize: androidx.compose.ui.unit.TextUnit = 12.5.sp,
    tone: Color = Handoff.Muted2,
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(label, fontSize = labelSize, color = tone, modifier = Modifier.weight(1f))
        Text(
            value,
            fontFamily = PlexMono,
            fontSize = if (labelSize == 12.5.sp) 13.sp else 12.sp,
            color = if (tone == Handoff.Muted2) Handoff.InkStrong else tone,
        )
    }
}

/** A method tile: icon in a rounded well, then label over a subtitle. */
@Composable
private fun MethodTile(
    method: String,
    selected: Boolean,
    enabled: Boolean,
    onPick: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .height(104.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (selected) Handoff.AccentTint else Handoff.Well)
            .border(
                2.dp,
                if (selected) Handoff.AccentSolid else Handoff.LineSoft,
                RoundedCornerShape(16.dp),
            )
            .clickable(enabled = enabled, onClick = onPick)
            .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        /*
         * Carfectionist gives every method its own hue — green cash, blue
         * card, amber Juice, navy bank. Kids Corner cannot: the palette is
         * white and the logo's red, and five hues would be five new colours
         * with no meaning behind them. The disc is the brand red on every
         * tile — the shop taking money — and which one is CHOSEN is said by
         * the tint, the border and the label, which is what the reference
         * uses colour for anyway.
         */
        Box(
            Modifier.size(46.dp).clip(CircleShape).background(Handoff.AccentSolid),
            contentAlignment = Alignment.Center,
        ) {
            Icon(methodIcon(method), null, tint = Color.White, modifier = Modifier.size(24.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(
            methodLabel(method),
            fontSize = 15.sp,
            fontWeight = FontWeight.Bold,
            color = if (selected) Handoff.AccentText else Handoff.Ink,
        )
    }
}

/**
 * The gated account tender.
 *
 * One tap bills the whole outstanding balance and completes the sale — there is
 * no such thing as "part of it on account" here, because a deposit plus the
 * rest on account is a split tender and the split flow only offers the methods
 * the shop configured; adding credit to that list would offer it on walk-ins
 * too. The whole-balance rule keeps the gate in exactly one place.
 *
 * The three states a cashier can meet, in the words they read out:
 * no customer attached (a prompt to attach one), an account on hold, and a
 * usable open account. There is no ceiling — an open account takes the charge
 * whatever its size.
 */
@Composable
private fun CreditTile(
    customer: Customer?,
    outstanding: Double,
    enabled: Boolean,
    onCharge: () -> Unit,
) {
    val canCharge = customer != null && customer.canUseCredit
    val blocked = when {
        customer == null -> "Attach a customer to sell on account"
        customer.creditBlockedReason != null -> customer.creditBlockedReason
        else -> null
    }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Handoff.Well)
            .border(1.dp, Handoff.LineSoft, RoundedCornerShape(16.dp))
            .clickable(enabled = enabled && canCharge, onClick = onCharge)
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(38.dp).clip(CircleShape).background(Handoff.AccentSolid),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.AccountBalanceWallet,
                    null,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "On account",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (canCharge) Handoff.Ink else Handoff.Muted3,
                )
                Text(
                    blocked
                        ?: "Bill ${formatRs(outstanding)} to ${customer?.fullName ?: "their account"}",
                    fontSize = 12.sp,
                    color = Handoff.Muted2,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            // No ceiling to show any more; what helps at the point of adding to
            // a tab is how much is already on it.
            if (customer?.owes == true) {
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        formatRs(customer.creditBalance),
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        fontFamily = PlexMono,
                        color = Handoff.InkStrong,
                    )
                    Text(
                        "ON TAB",
                        fontSize = 9.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.8.sp,
                        color = Handoff.Muted3,
                    )
                }
            }
        }
    }
}

private fun methodIcon(method: String): ImageVector = when (method) {
    "cash" -> Icons.Default.Payments
    "card" -> Icons.Default.CreditCard
    // A bank transfer is not a phone wallet. Juice and my.t money are, and
    // sharing the glyph with them made the three read as one thing.
    "bank" -> Icons.Default.AccountBalance
    else -> Icons.Default.PhoneAndroid
}

private fun methodSub(method: String): String = when (method) {
    "cash" -> "Notes & coins"
    "card" -> "Visa · Mastercard"
    "juice" -> "MCB mobile"
    "myt_money" -> "Scan to pay"
    "bank" -> "Straight to the account"
    else -> ""
}

/** `methodHint` — what the cashier tells the customer to do. */
private fun methodHint(method: String): String = when (method) {
    "card" -> "Insert or tap the card on the terminal"
    "juice" -> "Customer sends to Kids Corner on Juice"
    "myt_money" -> "Customer scans the my.t money QR"
    "bank" -> "Check the transfer has landed before handing over"
    else -> "Take the cash and count the change"
}

/** The shop's own words, not the database's. */
fun methodLabel(method: String): String = when (method) {
    "cash" -> "Cash"
    "card" -> "Card"
    "juice" -> "Juice"
    "myt_money" -> "my.t money"
    "bank" -> "Bank"
    // Rendered on receipts and the Z by this one label, since credit is never
    // drawn as a normal method tile — it has its own gated affordance.
    "credit" -> "On account"
    else -> method
}

/**
 * A quick amount, put into the entry field the way a person would type it.
 *
 * "1000" rather than "1000.0", so the next keystroke appends a digit instead of
 * landing after a decimal point the cashier did not ask for.
 */
private fun trimZeros(value: Double): String {
    val rounded = round2(value)
    return if (rounded == kotlin.math.floor(rounded)) rounded.toLong().toString()
    else formatAmount(rounded).replace(",", "")
}

/**
 * One row of the fee breakdown — Subtotal, a deduction, or VAT.
 *
 * Scaled well below [MoneyRow]: these are the working figures that explain
 * the total, not the total itself, so the hierarchy has to read at a glance.
 */
@Composable
private fun BreakdownRow(label: String, value: String, tone: Color) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            label,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = Handoff.Muted2,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        Spacer(Modifier.weight(1f))
        Text(
            value,
            fontFamily = PlexMono,
            fontSize = 13.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = tone,
        )
    }
}

/**
 * "Basket 10%" / "Basket Rs 50" — mirrors SellScreen's own `discountFigure`,
 * which stays private to that file: this is the one other place a cashier
 * reads a discount's kind and value back as a chip label.
 */
private fun discountLabel(d: AppliedDiscountLocal): String {
    val n = if (d.value % 1.0 == 0.0) d.value.toLong().toString() else formatAmount(d.value)
    return if (d.kind == "percent") "$n%" else "Rs $n"
}

/**
 * `Total` / `Balance` — the two figures at the top of the money column.
 */
@Composable
private fun MoneyRow(label: String, value: String, tone: Color) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
            label,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = Handoff.Muted,
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            fontFamily = PlexMono,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.66).sp,
            color = tone,
        )
    }
}

/**
 * One line of the bill on the payment screen's left card.
 *
 * Carfectionist prints `qty · name · amount`. A garment needs its size and
 * colour too — "Cotton socks" is three products — so the variant rides under
 * the name, and the colour band that identifies a line on the sell screen
 * comes with it. That is the translation: same three columns, one more fact
 * in the middle one, because the middle one means something different here.
 */
@Composable
private fun BillLine(line: CartLine) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(
            "${line.qty}",
            fontFamily = PlexMono,
            fontSize = 14.5.sp,
            fontWeight = FontWeight.Bold,
            color = Handoff.Muted,
            modifier = Modifier.width(28.dp),
        )
        Column(Modifier.weight(1f).padding(end = 10.dp)) {
            Text(
                line.productName,
                fontSize = 16.5.sp,
                fontWeight = FontWeight.SemiBold,
                lineHeight = 20.sp,
                color = Handoff.Ink,
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(top = 3.dp),
            ) {
                ColourSwatch(line.colourHex, size = 10)
                Text(
                    "${line.colourName} · ${line.sizeLabel}",
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = Handoff.Muted,
                )
            }
        }
        Text(
            formatAmount(line.lineTotal),
            fontFamily = PlexMono,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            color = Handoff.InkFigure,
        )
    }
}

/**
 * A labelled figure the numpad can be pointed at — Carfectionist's DisplayCard.
 * The highlighted one is the field the keys are feeding, which is the only way
 * to tell AMOUNT from CASH TENDERED without reading them.
 */
@Composable
private fun DisplayCard(
    label: String,
    value: String,
    highlight: Boolean,
    onClick: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Handoff.FieldWell)
            .border(
                1.5.dp,
                if (highlight) Handoff.AccentLine else Handoff.LineSoft,
                RoundedCornerShape(12.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    ) {
        Text(
            label,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.4.sp,
            color = Handoff.Muted,
        )
        Text(
            value,
            fontFamily = PlexMono,
            fontSize = 19.sp,
            fontWeight = FontWeight.Bold,
            color = Handoff.InkFigure,
        )
    }
}

/** A small preset — `Full`, `Exact`, `1,000`. */
@Composable
private fun QuickChip(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .height(36.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Handoff.Well)
            .border(1.dp, Handoff.LineSoft, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontFamily = PlexMono,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            color = Handoff.Muted,
        )
    }
}

/** Carfectionist's 4×3 pad. `⌫` is sent as "back" so the caller need not know. */
@Composable
private fun NumPad(enabled: Boolean, onKey: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(
            listOf("1", "2", "3"),
            listOf("4", "5", "6"),
            listOf("7", "8", "9"),
            listOf(".", "0", "⌫"),
        ).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { key ->
                    Surface(
                        onClick = { onKey(if (key == "⌫") "back" else key) },
                        enabled = enabled,
                        shape = RoundedCornerShape(12.dp),
                        color = Handoff.Well,
                        contentColor = Handoff.Ink,
                        modifier = Modifier.weight(1f).height(48.dp),
                    ) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            if (key == "⌫") {
                                Icon(
                                    Icons.AutoMirrored.Filled.Backspace,
                                    "Delete last digit",
                                    Modifier.size(19.dp),
                                )
                            } else {
                                Text(key, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The way out of a settle whose outcome is unknown — kept from the screen this
 * replaced, because the reference has no equivalent and losing it would strand
 * a cashier whose line dropped at the worst moment.
 */
@Composable
private fun FrozenActions(
    busy: Boolean,
    parkable: Boolean,
    onRetry: () -> Unit,
    onPark: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Surface(
            onClick = onRetry,
            enabled = !busy,
            shape = RoundedCornerShape(13.dp),
            color = Handoff.Surface,
            contentColor = Handoff.Ink,
            border = BorderStroke(1.dp, Handoff.Line),
            modifier = Modifier.fillMaxWidth().height(48.dp),
        ) {
            Box(Modifier.fillMaxSize(), Alignment.Center) {
                Text("Try sending it again", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        if (parkable) {
            Surface(
                onClick = onPark,
                enabled = !busy,
                shape = RoundedCornerShape(13.dp),
                color = Handoff.Surface,
                contentColor = Handoff.Ink,
                border = BorderStroke(1.dp, Handoff.Line),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text(
                        "Save it and serve the next customer",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

/**
 * Splitting one basket across several methods.
 *
 * The machinery was already here — `complete_sale_keyed` has always taken an
 * ARRAY of payments and the server sums them — so this is the tablet catching
 * up with the web till and with the reference, not a new capability.
 *
 * Carfectionist's shape: one row per method carrying its allocated amount, the
 * focused row taking the keys. Record lights when the allocation adds up to
 * the total, and not before — a sale that is short is not a sale.
 *
 * CASH IS THE ONLY ROW THAT CAN BE OVER-TENDERED. Handing over a 2,000 note
 * against a 1,450 allocation is change; a card charged 550 more than it should
 * be is a mistake. So the split rows are what each method SETTLES, and only
 * cash carries a tender above it.
 */
@Composable
private fun RowScope.SplitAllocation(
    methods: List<String>,
    total: Double,
    allocation: Map<String, Double>,
    focus: String,
    cashTendered: Double,
    busy: Boolean,
    frozen: Boolean,
    error: String?,
    parkable: Boolean,
    onFocus: (String) -> Unit,
    onKey: (String) -> Unit,
    onClearRow: (String) -> Unit,
    onFillRest: (String) -> Unit,
    onRecord: () -> Unit,
    onRetry: () -> Unit,
    onPark: () -> Unit,
) {
    val allocated = round2(allocation.values.sum())
    val left = round2(total - allocated)
    val cashAllocated = allocation["cash"] ?: 0.0
    val change = round2(maxOf(0.0, cashTendered - cashAllocated))

    // ── middle: one row per method ──────────────────────────────────────────
    Column(
        Modifier.weight(1f).fillMaxHeight()
            .clip(RoundedCornerShape(16.dp))
            .background(Handoff.Surface)
            .border(1.dp, Handoff.LineSoft, RoundedCornerShape(16.dp))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Text(
            "HOW IS THE CUSTOMER PAYING?",
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.2.sp,
            color = Handoff.Muted,
        )
        methods.forEach { m ->
            val focused = focus == m
            val amount = allocation[m] ?: 0.0
            Row(
                Modifier.fillMaxWidth().height(64.dp)
                    .clip(RoundedCornerShape(13.dp))
                    .background(if (focused) Handoff.AccentTint else Handoff.Well)
                    .border(
                        if (focused) 2.dp else 1.dp,
                        if (focused) Handoff.AccentSolid else Handoff.LineSoft,
                        RoundedCornerShape(13.dp),
                    )
                    .clickable(enabled = !busy && !frozen) { onFocus(m) }
                    .padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                Box(
                    Modifier.size(34.dp).clip(CircleShape).background(Handoff.AccentSolid),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(methodIcon(m), null, tint = Color.White, modifier = Modifier.size(18.dp))
                }
                Text(
                    methodLabel(m),
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (focused) Handoff.AccentText else Handoff.Ink,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    formatAmount(amount),
                    fontFamily = PlexMono,
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (amount > 0) Handoff.InkFigure else Handoff.Muted3,
                )
                if (amount > 0) {
                    Surface(
                        onClick = { onClearRow(m) },
                        enabled = !busy && !frozen,
                        shape = RoundedCornerShape(9.dp),
                        color = Color.Transparent,
                        contentColor = Handoff.Muted4,
                        modifier = Modifier.size(36.dp),
                    ) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Icon(Icons.Default.Close, "Clear ${methodLabel(m)}", Modifier.size(15.dp))
                        }
                    }
                }
            }
        }

        Spacer(Modifier.weight(1f))
        Text(
            when {
                left > 0.005 -> "${formatRs(left)} still to allocate. Tap a method, then key its share."
                left < -0.005 -> "That is ${formatRs(-left)} more than the bill. Clear a row and try again."
                else -> "Every rupee is allocated. Record when the money is in hand."
            },
            fontSize = 13.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.Medium,
            color = if (left < -0.005) Handoff.Danger else Handoff.Muted,
        )
    }

    // ── right: totals, the focused row's keys, Record ────────────────────────
    Column(
        Modifier.weight(1f).fillMaxHeight()
            .clip(RoundedCornerShape(16.dp))
            .background(Handoff.Surface)
            .border(1.dp, Handoff.LineSoft, RoundedCornerShape(16.dp))
            .padding(18.dp),
    ) {
        MoneyRow("Total", formatRs(total), Handoff.InkFigure)
        Spacer(Modifier.height(6.dp))
        MoneyRow(
            "Left to allocate",
            formatRs(left),
            when {
                left < -0.005 -> Handoff.Danger
                left > 0.005 -> Handoff.WarnText
                else -> Handoff.Muted3
            },
        )
        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineSoft))
        Spacer(Modifier.height(12.dp))

        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            DisplayCard(
                label = methodLabel(focus).uppercase(),
                value = formatRs(allocation[focus] ?: 0.0),
                highlight = true,
                onClick = {},
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                QuickChip("Rest") { onFillRest(focus) }
                QuickChip("Clear") { onClearRow(focus) }
            }

            // Only cash can be handed over in excess of what it settles.
            if (focus == "cash" && cashAllocated > 0) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Change",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Handoff.Muted,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        formatRs(change),
                        fontFamily = PlexMono,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (change > 0) Handoff.ChangeFigure else Handoff.Muted3,
                    )
                }
            }

            NumPad(enabled = !busy && !frozen, onKey = onKey)
        }

        Spacer(Modifier.height(10.dp))
        if (error != null) {
            Text(error, fontSize = 13.sp, color = Handoff.Danger)
            Spacer(Modifier.height(6.dp))
        }
        if (frozen) {
            FrozenActions(busy = busy, parkable = parkable, onRetry = onRetry, onPark = onPark)
            Spacer(Modifier.height(8.dp))
        }

        // Settled to the rupee, or not at all. A short split is a short sale.
        val exact = abs(left) < 0.005 && allocated > 0
        val recordable = exact && !busy && !frozen
        Surface(
            onClick = onRecord,
            enabled = recordable,
            shape = RoundedCornerShape(14.dp),
            color = if (recordable) Handoff.AccentSolid else Handoff.Blocked,
            contentColor = if (recordable) Color.White else Handoff.BlockedText,
            shadowElevation = if (recordable) 6.dp else 0.dp,
            modifier = Modifier.fillMaxWidth().height(56.dp),
        ) {
            Box(Modifier.fillMaxSize(), Alignment.Center) {
                if (busy) {
                    CircularProgressIndicator(Modifier.size(24.dp), Color.White, 2.dp)
                } else {
                    Text(
                        if (exact) "Record " + formatRs(total) else "Allocate the whole bill first",
                        fontSize = 16.5.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

/**
 * What a customer would plausibly hand over for this bill.
 *
 * The chips were a fixed 1,000 / 5,000, useless against a Rs 2,408.10 basket —
 * nobody hands over 5,000 for it, and the one figure that IS likely, 2,410,
 * was not offered at all. These are generated from the amount due by rounding
 * up to the steps notes and coins make natural: the next 10, 100, 500, 1,000.
 *
 * For 2,408.10 that is 2,410 · 2,500 · 3,000 — the coins-and-change tender,
 * the two-note tender, and the round three thousand. Exact sits beside them,
 * so all four ways of paying are one tap.
 *
 * Anything equal to the due amount is dropped (Exact covers it) and the list
 * is capped at three so the row never wraps.
 */
internal fun tenderChips(due: Double): List<Double> {
    if (due <= 0) return emptyList()
    return listOf(10.0, 100.0, 500.0, 1000.0)
        .map { step -> ceil(due / step) * step }
        .filter { it > due + 0.005 }
        .distinct()
        .take(3)
}
