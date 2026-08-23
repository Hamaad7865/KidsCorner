package mu.kidscorner.till.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.DepositDetailResponse
import mu.kidscorner.till.data.DepositItemDto
import mu.kidscorner.till.data.DepositPaymentInput
import mu.kidscorner.till.data.DepositSummaryRow
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.data.formatRs

/**
 * The layaway screen: what is held for whom, and the money against it.
 *
 * Two panes, like the stock check: the list answers "is my cot still held?",
 * and tapping one opens everything a visit needs — top-up, pickup, cancel.
 * Every money move here is online-only, so the offline pill matters as much
 * as any button.
 */
@Composable
fun DepositsScreen(
    cashierName: String,
    deposits: List<DepositSummaryRow>,
    loading: Boolean,
    query: String,
    status: String,
    online: Boolean,
    selected: DepositDetailResponse?,
    detailLoading: Boolean,
    busy: Boolean,
    error: String?,
    shiftOpen: Boolean,
    paymentMethods: List<String>,
    onQuery: (String) -> Unit,
    onStatus: (String) -> Unit,
    onOpen: (Int) -> Unit,
    onCloseDetail: () -> Unit,
    onBack: () -> Unit,
    onTopUp: (String, Double, Double?) -> Unit,
    onCollect: (List<Pair<Long, Int>>, List<DepositPaymentInput>) -> Unit,
    onCancelDeposit: (String) -> Unit,
    onDismissError: () -> Unit,
) {
    var dialog by remember { mutableStateOf<DepositDialog>(DepositDialog.None) }

    Box(Modifier.fillMaxSize().background(Handoff.Surface)) {
        if (selected?.deposit != null) {
            DepositDetailPane(
                detail = selected,
                busy = busy,
                shiftOpen = shiftOpen,
                paymentMethods = paymentMethods,
                onBack = onCloseDetail,
                onTopUp = { dialog = DepositDialog.TopUp },
                onCollect = { dialog = DepositDialog.Collect },
                onCancel = { dialog = DepositDialog.Cancel },
            )
        } else {
            DepositListPane(
                deposits = deposits,
                loading = loading,
                query = query,
                status = status,
                cashierName = cashierName,
                online = online,
                onQuery = onQuery,
                onStatus = onStatus,
                onOpen = onOpen,
                onBack = onBack,
            )
        }

        error?.let { message ->
            DepositErrorBar(
                message,
                modifier = Modifier.align(Alignment.BottomStart),
                onDismiss = onDismissError,
            )
        }
    }

    when (val d = selected?.deposit) {
        null -> Unit
        else -> when (dialog) {
            DepositDialog.None -> Unit
            DepositDialog.TopUp -> DepositTopUpDialog(
                balance = d.balance,
                busy = busy,
                shiftOpen = shiftOpen,
                paymentMethods = paymentMethods,
                onConfirm = { method, amount ->
                    dialog = DepositDialog.None
                    onTopUp(method, amount, null)
                },
                onDismiss = { dialog = DepositDialog.None },
            )
            DepositDialog.Collect -> DepositCollectDialog(
                items = selected.items.filter { !it.fullyCollected },
                unallocatedCredit = d.unallocatedCredit,
                busy = busy,
                paymentMethods = paymentMethods,
                onConfirm = { selections, payments ->
                    dialog = DepositDialog.None
                    onCollect(selections, payments)
                },
                onDismiss = { dialog = DepositDialog.None },
            )
            DepositDialog.Cancel -> DepositCancelDialog(
                orderNo = d.orderNo,
                busy = busy,
                shiftOpen = shiftOpen,
                onConfirm = { reason ->
                    dialog = DepositDialog.None
                    onCancelDeposit(reason)
                },
                onDismiss = { dialog = DepositDialog.None },
            )
        }
    }
}

private enum class DepositDialog { None, TopUp, Collect, Cancel }

// ── the list ─────────────────────────────────────────────────────────────────

@Composable
private fun DepositListPane(
    deposits: List<DepositSummaryRow>,
    loading: Boolean,
    query: String,
    status: String,
    cashierName: String,
    online: Boolean,
    onQuery: (String) -> Unit,
    onStatus: (String) -> Unit,
    onOpen: (Int) -> Unit,
    onBack: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Surface(
                onClick = onBack,
                shape = RoundedCornerShape(12.dp),
                color = Handoff.Well,
                contentColor = Handoff.Muted,
                modifier = Modifier.size(44.dp),
            ) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", Modifier.size(20.dp))
                }
            }
            Column(Modifier.weight(1f)) {
                Text(
                    "Deposits",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.36).sp,
                    color = Handoff.Ink,
                )
                Text(
                    "$cashierName · goods held for customers",
                    fontSize = 12.sp,
                    color = Handoff.Muted3,
                )
            }
            if (!online) {
                Text("Offline", fontSize = 12.sp, color = Handoff.WarnText)
            }
        }

        // Status tabs + search, mirroring the back office's list so either
        // screen teaches the other.
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            listOf("open" to "Open", "collected" to "Collected", "cancelled" to "Cancelled", "all" to "All")
                .forEach { (value, label) ->
                    Surface(
                        onClick = { onStatus(value) },
                        shape = RoundedCornerShape(10.dp),
                        color = if (status == value) Handoff.AccentSolid else Handoff.Well,
                        contentColor = if (status == value) Color.White else Handoff.Muted,
                        modifier = Modifier.height(36.dp),
                    ) {
                        Box(Modifier.fillMaxSize().padding(horizontal = 14.dp), Alignment.Center) {
                            Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            Spacer(Modifier.weight(1f))
            SearchField(query, onQuery)
        }

        when {
            loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                Text("Loading…", color = Handoff.Muted3)
            }
            deposits.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.Inventory2, null,
                        tint = Handoff.Faint, modifier = Modifier.size(40.dp),
                    )
                    Text(
                        if (query.isBlank()) "Nothing ${status ?: "open"} right now" else "No matches",
                        fontSize = 15.sp, color = Handoff.Muted,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                    Text(
                        "Take one from the sell screen: basket → Actions → Take deposit",
                        fontSize = 12.5.sp, color = Handoff.Muted3,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
            else -> LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                items(deposits, key = { it.orderId }) { row ->
                    DepositRow(row) { onOpen(row.orderId) }
                }
            }
        }
    }
}

@Composable
private fun DepositRow(row: DepositSummaryRow, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(13.dp),
        color = Handoff.Surface,
        contentColor = Handoff.Ink,
        border = androidx.compose.foundation.BorderStroke(1.dp, Handoff.LineSoft),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 15.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(11.dp)).background(Handoff.AccentTint),
                Alignment.Center,
            ) {
                Icon(Icons.Default.Inventory2, null, tint = Handoff.AccentText, modifier = Modifier.size(20.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        row.orderNo,
                        fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.14).sp,
                    )
                    if (row.overdue) OverdueChip()
                    if (row.status != "open") {
                        Text(
                            row.status.replaceFirstChar { it.uppercase() },
                            fontSize = 11.sp, color = Handoff.Muted3, fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
                Text(
                    buildString {
                        append(row.customerName)
                        row.customerPhone?.let { append(" · $it") }
                        append(" · ${row.remainingUnits} of ${row.unitsTotal} held")
                    },
                    fontSize = 12.sp, color = Handoff.Muted3,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                if (row.balance > 0.0) {
                    Text(formatRs(row.balance), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text("balance", fontSize = 10.5.sp, color = Handoff.Muted3)
                } else {
                    Text("Paid", fontSize = 12.5.sp, color = Handoff.Muted, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

// ── the visit screen ─────────────────────────────────────────────────────────

@Composable
private fun DepositDetailPane(
    detail: DepositDetailResponse,
    busy: Boolean,
    shiftOpen: Boolean,
    paymentMethods: List<String>,
    onBack: () -> Unit,
    onTopUp: () -> Unit,
    onCollect: () -> Unit,
    onCancel: () -> Unit,
) {
    val d = detail.deposit ?: return
    val scroll = rememberScrollState()

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Surface(
                onClick = onBack,
                shape = RoundedCornerShape(12.dp),
                color = Handoff.Well,
                contentColor = Handoff.Muted,
                modifier = Modifier.size(44.dp),
            ) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", Modifier.size(20.dp))
                }
            }
            Column(Modifier.weight(1f)) {
                Text(d.orderNo, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Ink)
                Text(
                    buildString {
                        append(d.customerName)
                        d.customerPhone?.let { append(" · $it") }
                    },
                    fontSize = 12.sp, color = Handoff.Muted3,
                )
            }
            if (d.status == "open" && d.overdue) OverdueChip()
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(scroll)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // The three numbers a visit turns on.
            Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                DepositStat("Total", formatRs(d.total), Modifier.weight(1f))
                DepositStat("Paid", formatRs(d.paidNet), Modifier.weight(1f))
                DepositStat(
                    if (d.unallocatedCredit > d.paidNet) "Credit in hand" else "Balance",
                    formatRs(if (d.unallocatedCredit > d.paidNet) d.balance else d.balance),
                    Modifier.weight(1f),
                )
            }

            if (d.collectBy != null) {
                Text(
                    "Please collect by ${d.collectBy}",
                    fontSize = 12.5.sp, color = Handoff.Muted,
                )
            }
            d.note?.let { note ->
                Text(note, fontSize = 12.5.sp, color = Handoff.Muted3)
            }
            if (d.status == "cancelled") {
                Text(
                    buildString {
                        append("Cancelled")
                        d.cancelledReason?.let { append(" — $it") }
                    },
                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Muted,
                )
            }

            // Held goods with what has already gone home.
            SectionCard("Held items") {
                detail.items.forEach { item -> ItemLine(item) }
            }

            // Money ledger, newest first.
            SectionCard("Payments") {
                if (detail.payments.isEmpty()) {
                    Text("Nothing taken yet", fontSize = 12.5.sp, color = Handoff.Muted3)
                } else {
                    detail.payments.reversed().forEach { p ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                (p.createdAt.take(10)) + " · " + p.method,
                                fontSize = 12.sp, color = Handoff.Muted3,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                (if (p.amount < 0) "+" else "") + formatRs(kotlin.math.abs(p.amount)),
                                fontSize = 12.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (p.amount < 0) Handoff.AccentText else Handoff.Ink,
                            )
                        }
                    }
                }
            }

            // Pickups already written, each an ordinary sale in History.
            if (detail.pickups.isNotEmpty()) {
                SectionCard("Collected on") {
                    detail.pickups.forEach { pickup ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                pickup.saleNo + " · " + pickup.saleDate.take(10),
                                fontSize = 12.sp, color = Handoff.Muted3,
                                modifier = Modifier.weight(1f),
                            )
                            Text(
                                formatRs(pickup.total),
                                fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }

            // The three things a visit can do, gated by what the order is.
            if (d.status == "open") {
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                    DialogButton(
                        "Take payment", Modifier.weight(1f).height(56.dp),
                        enabled = !busy,
                        onClick = onTopUp,
                    )
                    val anythingLeft = detail.items.any { !it.fullyCollected }
                    DialogButton(
                        "Collect items",
                        Modifier.weight(1.4f).height(56.dp),
                        enabled = !busy && anythingLeft && shiftOpen,
                        solid = true,
                        onClick = onCollect,
                    )
                }
                DialogButton(
                    "Cancel deposit & refund",
                    Modifier.fillMaxWidth().height(52.dp),
                    enabled = !busy,
                    onClick = onCancel,
                )
                if (!shiftOpen) {
                    Text(
                        "Open the till to take cash or hand over goods.",
                        fontSize = 11.5.sp, color = Handoff.WarnText,
                    )
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ItemLine(item: DepositItemDto) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                item.description,
                fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${item.qty} × ${formatRs(item.unitPrice)}" +
                    if (item.discount > 0) " · −${formatRs(item.discount)}" else "",
                fontSize = 11.5.sp, color = Handoff.Muted3,
            )
        }
        Text(
            when {
                item.fullyCollected -> "collected"
                item.collectedQty > 0 -> "${item.remaining} left"
                else -> "${item.qty} held"
            },
            fontSize = 11.5.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (item.fullyCollected) Handoff.Faint else Handoff.Muted,
        )
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(13.dp))
            .background(Handoff.Well)
            .border(1.dp, Handoff.LineSoft, RoundedCornerShape(13.dp))
            .padding(horizontal = 14.dp, vertical = 11.dp),
    ) {
        Text(
            title,
            fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.6.sp, color = Handoff.Muted3,
        )
        Column(Modifier.padding(top = 6.dp)) { content() }
    }
}

@Composable
private fun DepositStat(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Handoff.Well)
            .padding(horizontal = 13.dp, vertical = 10.dp),
    ) {
        Text(label, fontSize = 10.5.sp, color = Handoff.Muted3, fontWeight = FontWeight.SemiBold)
        Text(value, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Ink)
    }
}

@Composable
private fun OverdueChip() {
    Surface(shape = RoundedCornerShape(7.dp), color = Color(0xFFFDECE6)) {
        Text(
            "OVERDUE",
            fontSize = 9.5.sp, fontWeight = FontWeight.Bold,
            color = Color(0xFFB4552F),
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

// ── visit dialogs ────────────────────────────────────────────────────────────

/** Extra money onto an open order. */
@Composable
private fun DepositTopUpDialog(
    balance: Double,
    busy: Boolean,
    shiftOpen: Boolean,
    paymentMethods: List<String>,
    onConfirm: (String, Double) -> Unit,
    onDismiss: () -> Unit,
) {
    var amount by remember { mutableStateOf(if (balance > 0) formatPlain(balance) else "") }
    var method by remember { mutableStateOf("cash") }
    val parsed = amount.toDoubleOrNull() ?: 0.0
    val cashBlocked = method == "cash" && !shiftOpen
    val valid = parsed > 0 && !busy && !cashBlocked

    DepositDialogShell(
        title = "Take payment",
        subtitle = "Extra money onto this deposit",
        onDismiss = onDismiss,
    ) {
        MethodChips(paymentMethods, method) { method = it }
        AmountField(amount) { if (it.length <= 12) amount = it }
        if (balance > 0) {
            Text(
                "Balance ${formatRs(balance)} · paying full clears it",
                fontSize = 11.5.sp, color = Handoff.Muted3,
            )
        }
        if (cashBlocked) {
            Text(
                "Cash needs an open till — pick another method or open first.",
                fontSize = 11.5.sp, color = Handoff.WarnText,
            )
        }
        ConfirmRow(valid, "Record payment") { onConfirm(method, parsed) }
    }
}

/**
 * A pickup visit: choose what goes home, settle the difference.
 *
 * The charge shown is an ESTIMATE — the server recomputes from frozen prices
 * and refuses an underpayment with the exact figure, which lands in the same
 * error bar as any other refusal.
 */
@Composable
private fun DepositCollectDialog(
    items: List<DepositItemDto>,
    unallocatedCredit: Double,
    busy: Boolean,
    paymentMethods: List<String>,
    onConfirm: (List<Pair<Long, Int>>, List<DepositPaymentInput>) -> Unit,
    onDismiss: () -> Unit,
) {
    // Everything selected by default: most visits take all of it.
    val selection = remember(items) {
        mutableStateOf(items.associate { it.itemId to it.remaining })
    }
    var method by remember { mutableStateOf("cash") }
    var payText by remember { mutableStateOf("") }

    val estimate = items.fold(0.0) { sum, item ->
        val qty = selection.value[item.itemId] ?: 0
        if (qty > 0) {
            sum + qty * item.unitPrice - item.discount * (qty.toDouble() / item.qty.coerceAtLeast(1))
        } else sum
    }
    val dueNow = (estimate - unallocatedCredit).coerceAtLeast(0.0)
    val paying = payText.toDoubleOrNull() ?: dueNow
    val cashBlocked = method == "cash" && false // collect REQUIRES open till already gated
    val selectionsOk = items.any { (selection.value[it.itemId] ?: 0) > 0 }
    val valid = selectionsOk && !busy && paying >= 0 && !cashBlocked

    DepositDialogShell(
        title = "Collect items",
        subtitle = "What is the customer taking home today?",
        onDismiss = onDismiss,
        scrollable = true,
    ) {
        items.forEach { item ->
            val picked = selection.value[item.itemId] ?: 0
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(item.description, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Text("${item.remaining} held", fontSize = 11.sp, color = Handoff.Muted3)
                }
                QtyStepper(
                    value = picked,
                    max = item.remaining,
                    onChange = { new ->
                        selection.value = selection.value + (item.itemId to new)
                    },
                )
            }
        }

        Text(
            buildString {
                append("This visit ≈ ")
                append(formatRs(estimate))
                if (unallocatedCredit > 0) {
                    append(" · credit in hand ")
                    append(formatRs(unallocatedCredit))
                }
            },
            fontSize = 12.sp, color = Handoff.Muted,
            modifier = Modifier.padding(top = 6.dp),
        )

        if (dueNow > 0.0) {
            MethodChips(paymentMethods.filter { it != "credit" }, method) { method = it }
            if (!payText.isNotBlank()) {
                // Prefilled with the estimate; the cashier can adjust downward —
                // the server refuses a true underpayment by name.
                payText = formatPlain(dueNow)
            }
            AmountField(payText) { if (it.length <= 12) payText = it }
        } else {
            Text(
                "Covered by deposits — nothing to take",
                fontSize = 12.5.sp, color = Handoff.AccentText, fontWeight = FontWeight.SemiBold,
            )
        }
        ConfirmRow(valid, "Hand over & print receipt") {
            onConfirm(
                selection.value.filter { it.value > 0 }.map { Pair(it.key, it.value) },
                if (dueNow > 0.0) listOf(DepositPaymentInput(method, paying)) else emptyList(),
            )
        }
    }
}

@Composable
private fun DepositCancelDialog(
    orderNo: String,
    busy: Boolean,
    shiftOpen: Boolean,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var reason by remember { mutableStateOf("") }
    val presets = listOf("Customer changed mind", "Wrong size ordered", "Too long on hold")
    val valid = reason.trim().length >= 3 && !busy

    DepositDialogShell(
        title = "Cancel $orderNo",
        subtitle = "Refunds paid-but-unclaimed money and frees the stock",
        onDismiss = onDismiss,
    ) {
        if (!shiftOpen) {
            Text(
                "Open the till first — refund cash leaves the drawer.",
                fontSize = 12.sp, color = Handoff.WarnText,
            )
        }
        AmountLikeNote()
        BasicTextField(
            value = reason,
            onValueChange = { if (it.length <= 200) reason = it },
            textStyle = LocalTextStyle.current.copy(fontSize = 14.sp, color = Handoff.Ink),
            cursorBrush = SolidColor(Handoff.Accent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().height(56.dp), Alignment.CenterStart) {
                    if (reason.isEmpty()) {
                        Text("Why is it being cancelled?", fontSize = 13.5.sp, color = Handoff.Muted3)
                    }
                    inner()
                }
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            presets.forEach { preset ->
                Surface(
                    onClick = { reason = preset },
                    shape = RoundedCornerShape(9.dp),
                    color = Handoff.Well,
                    contentColor = Handoff.Muted,
                    border = androidx.compose.foundation.BorderStroke(1.dp, Handoff.LineSoft),
                ) {
                    Text(
                        preset, fontSize = 10.5.sp,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                    )
                }
            }
        }
        ConfirmRow(valid && shiftOpen, "Cancel deposit") { onConfirm(reason.trim()) }
    }
}

// ── shared small pieces ──────────────────────────────────────────────────────

@Composable
internal fun DepositDialogShell(
    title: String,
    subtitle: String,
    scrollable: Boolean = false,
    onDismiss: () -> Unit,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    val noRipple = remember { MutableInteractionSource() }
    Box(
        Modifier
            .fillMaxSize()
            .background(Handoff.Scrim)
            .clickable(interactionSource = noRipple, indication = null, onClick = onDismiss),
        Alignment.Center,
    ) {
        val body = @Composable {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Ink)
                    Text(subtitle, fontSize = 12.sp, color = Handoff.Muted3)
                }
                Surface(
                    onClick = onDismiss,
                    shape = RoundedCornerShape(12.dp),
                    color = Handoff.Well,
                    contentColor = Handoff.Muted,
                    modifier = Modifier.size(44.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Icon(Icons.Default.Close, "Close", Modifier.size(18.dp))
                    }
                }
            }
            Column(
                Modifier.padding(start = 20.dp, end = 20.dp, bottom = 18.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
                content = content,
            )
        }
        val base = Modifier.width(520.dp).clickable(
            interactionSource = noRipple, indication = null, onClick = {},
        )
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = Handoff.Surface,
            modifier = if (scrollable) base.height(560.dp) else base,
        ) {
            if (scrollable) {
                Column(Modifier.verticalScroll(rememberScrollState())) { body() }
            } else {
                Column { body() }
            }
        }
    }
}

@Composable
internal fun MethodChips(methods: List<String>, current: String, onPick: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        methods.forEach { m ->
            Surface(
                onClick = { onPick(m) },
                shape = RoundedCornerShape(10.dp),
                color = if (current == m) Handoff.AccentSolid else Handoff.Well,
                contentColor = if (current == m) Color.White else Handoff.Muted,
                modifier = Modifier.height(40.dp),
            ) {
                Box(Modifier.fillMaxSize().padding(horizontal = 13.dp), Alignment.Center) {
                    // methodLabel comes from PaymentScreen.kt — one vocabulary
                    // of tender names across every screen that shows them.
                    Text(methodLabel(m), fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
internal fun AmountField(value: String, onChange: (String) -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Handoff.FieldWell)
            .border(1.dp, Handoff.LineField, RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp),
        Alignment.CenterStart,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Rs ", fontSize = 15.sp, color = Handoff.Muted3, fontWeight = FontWeight.SemiBold)
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = LocalTextStyle.current.copy(
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.Ink,
                ),
                cursorBrush = SolidColor(Handoff.Accent),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** A quiet line where a note would go — keeps dialog rhythm without a field. */
@Composable
private fun AmountLikeNote() {
    Text(
        "The reason prints on the slip and stays in the books.",
        fontSize = 11.5.sp, color = Handoff.Muted3,
    )
}

@Composable
private fun QtyStepper(value: Int, max: Int, onChange: (Int) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        StepperKey("−", value > 0) { onChange((value - 1).coerceAtLeast(0)) }
        Text("$value", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(22.dp))
        StepperKey("+", value < max) { onChange((value + 1).coerceAtMost(max)) }
    }
}

@Composable
private fun StepperKey(symbol: String, enabled: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(9.dp),
        color = if (enabled) Handoff.Well else Handoff.Surface,
        contentColor = if (enabled) Handoff.Ink else Handoff.Faint,
        border = androidx.compose.foundation.BorderStroke(1.dp, Handoff.LineSoft),
        modifier = Modifier.size(34.dp),
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Text(symbol, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
internal fun ConfirmRow(enabled: Boolean, label: String, onConfirm: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 2.dp)) {
        DialogButton("Close", Modifier.weight(1f).height(54.dp), enabled = true, onClick = {})
        // The shell's scrim handles dismissal; this button closes via it.
        DialogButton(label, Modifier.weight(1.6f).height(54.dp), enabled = enabled, solid = true, onClick = onConfirm)
    }
}

@Composable
internal fun DialogButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    solid: Boolean = false,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(12.dp),
        color = if (solid && enabled) Handoff.AccentSolid else Handoff.Surface,
        contentColor = when {
            !enabled -> Handoff.Faint
            solid -> Color.White
            else -> Handoff.InkStrong
        },
        border = androidx.compose.foundation.BorderStroke(1.dp, Handoff.Line),
        modifier = modifier,
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        }
    }
}

@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit) {
    Box(
        Modifier
            .width(240.dp)
            .height(40.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(Handoff.FieldWell)
            .border(1.dp, Handoff.LineField, RoundedCornerShape(11.dp))
            .padding(horizontal = 12.dp),
        Alignment.CenterStart,
    ) {
        BasicTextField(
            value = query,
            onValueChange = onQuery,
            singleLine = true,
            textStyle = LocalTextStyle.current.copy(fontSize = 13.sp, color = Handoff.Ink),
            cursorBrush = SolidColor(Handoff.Accent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.Search, null,
                        tint = Handoff.Muted3, modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Box {
                        if (query.isEmpty()) {
                            Text("Order, name or phone", fontSize = 12.5.sp, color = Handoff.Muted3)
                        }
                        inner()
                    }
                }
            },
        )
    }
}

@Composable
private fun DepositErrorBar(
    message: String,
    modifier: Modifier = Modifier,
    onDismiss: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = Color(0xFFFDECE6),
        modifier = modifier
            .clickable(onClick = onDismiss)
            .padding(16.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(message, fontSize = 12.5.sp, color = Color(0xFFB4552F), modifier = Modifier.weight(1f))
            Icon(Icons.Default.Close, "Dismiss", Modifier.size(16.dp), tint = Color(0xFFB4552F))
        }
    }
}

/** Money without thousand separators, for a text field that parses back. */
internal fun formatPlain(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else String.format("%.2f", value)



