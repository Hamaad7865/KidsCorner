package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.RefundResponse
import mu.kidscorner.till.data.SaleDetail
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/** `REFUND_REASONS` — the design's five, in its order. */
private val REFUND_REASONS = listOf(
    "Wrong size",
    "Changed mind",
    "Faulty item",
    "Gift return",
    "Duplicate purchase",
)

/**
 * `atRefund` — new in POS v2.
 *
 * The sale's lines on the left with a stepper each, the reason and the restock
 * switch under them, and a `392px` panel on the right leading with **the refund
 * total at 44px in IBM Plex Mono** in the danger colour.
 *
 * Nothing here decides money. `create_credit_note` re-reads every line and
 * refunds what the customer actually paid for that unit — discount included,
 * not the list price — and refuses to give back more than was sold. The figure
 * on this screen is a quote, exactly like the sell screen's.
 *
 * `alreadyReturned` comes from the server so a line that has been partly
 * returned already cannot be returned again: the RPC would refuse it, and
 * finding that out after the customer has been promised a refund is worse than
 * not offering it.
 */
@Composable
fun RefundScreen(
    sale: SaleDetail,
    alreadyReturned: Map<Int, Int>,
    /**
     * What the shop takes today, from Settings.
     *
     * This grid used to carry its own list, which is how it went on offering
     * my.t money after the shop retired it — the same two-ends-never-
     * introduced fault the payment tiles had. A method you can be paid by is a
     * method you can be refunded to, so there is one list and this reads it.
     */
    paymentMethods: List<String>,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRefund: (Map<Int, Int>, String, String, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var qty by remember(sale.id) { mutableStateOf(mapOf<Int, Int>()) }
    var reason by remember(sale.id) { mutableStateOf<String?>(null) }
    var method by remember(sale.id) {
        mutableStateOf(sale.payments.firstOrNull()?.method ?: "cash")
    }
    var restock by remember(sale.id) { mutableStateOf(true) }

    fun returnable(line: mu.kidscorner.till.data.SaleDetailLine): Int =
        (line.qty - (alreadyReturned[line.id] ?: 0)).coerceAtLeast(0)

    // What the customer actually paid, as a fraction of what the lines listed.
    // `lineTotal` is net of that LINE's discount but knows nothing about one
    // taken off the whole basket, so without this the screen would quote a
    // refund larger than the server will pay — see migration 021.
    val paidFactor = if (sale.subtotal > 0) sale.total / sale.subtotal else 1.0

    /** Refunded at what was paid per unit, mirroring the RPC's own arithmetic. */
    fun unitPaid(line: mu.kidscorner.till.data.SaleDetailLine): Double =
        if (line.qty > 0) round2((line.lineTotal / line.qty) * paidFactor) else 0.0

    val total = round2(
        sale.lines.sumOf { line -> unitPaid(line) * (qty[line.id] ?: 0) },
    )
    val count = qty.values.sum()
    val originally = sale.payments.map { methodLabel(it.method) }.distinct().joinToString(" + ")
    val ready = total > 0 && reason != null && !busy

    Row(modifier.fillMaxSize().background(Handoff.Canvas)) {

        // ═══════════════════════════════════════════════ what is coming back ══
        Column(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 20.dp),
        ) {
            Row(
                Modifier.padding(bottom = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SquareKey(onClick = onBack, size = 48) {
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                        "Back to selling",
                        Modifier.size(18.dp),
                    )
                }
                Column {
                    Text(
                        "Return items",
                        fontSize = 18.sp,
                        lineHeight = 22.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.36).sp,
                        color = Handoff.Ink,
                    )
                    Text(
                        buildString {
                            append(sale.saleNo)
                            append(" · ")
                            append(sale.saleDate.take(16).replace('T', ' '))
                            sale.cashierName?.let { append(" · sold by ${it.substringBefore(' ')}") }
                        },
                        fontSize = 12.5.sp,
                        lineHeight = 15.6.sp,
                        color = Handoff.Muted3,
                    )
                }
            }

            // ── the lines: `padding:4px 16px 12px` ──────────────────────────
            Surface(
                shape = RoundedCornerShape(13.dp),
                color = Handoff.Surface,
                border = BorderStroke(1.dp, Handoff.LineSoft),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp)) {
                    sale.lines.forEach { line ->
                        val max = returnable(line)
                        val picked = qty[line.id] ?: 0
                        Column {
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        line.productName,
                                        fontSize = 14.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        letterSpacing = (-0.145).sp,
                                        color = Handoff.Ink,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Row(
                                        Modifier.padding(top = 4.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                                    ) {
                                        ColourSwatch(line.colourHex, size = 12)
                                        Text(
                                            listOf(line.colourName, line.sizeLabel)
                                                .filter { it.isNotBlank() && it != "—" }
                                                .joinToString(" · ")
                                                .ifBlank { line.sku },
                                            fontSize = 12.5.sp,
                                            color = Handoff.Muted2,
                                        )
                                        Text(
                                            if (max == line.qty) {
                                                "sold ${line.qty} @ ${formatRs(unitPaid(line))}"
                                            } else {
                                                "$max of ${line.qty} left to return"
                                            },
                                            fontSize = 12.sp,
                                            color = Handoff.Muted3,
                                        )
                                    }
                                }

                                // `48px` keys either side of a 46px mono figure
                                Row(
                                    Modifier
                                        .clip(RoundedCornerShape(11.dp))
                                        .background(Handoff.Surface)
                                        .border(1.dp, Handoff.LineField, RoundedCornerShape(11.dp)),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    StepperKey(Icons.Default.Remove, "Fewer", picked > 0) {
                                        qty = qty + (line.id to picked - 1)
                                    }
                                    Text(
                                        picked.toString(),
                                        Modifier.width(46.dp),
                                        fontFamily = mu.kidscorner.till.ui.theme.PlexMono,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        textAlign = TextAlign.Center,
                                        color = if (picked > 0) Handoff.Danger else Handoff.Fainter,
                                    )
                                    StepperKey(Icons.Default.Add, "More", picked < max) {
                                        qty = qty + (line.id to picked + 1)
                                    }
                                }

                                Text(
                                    if (picked > 0) "−${formatAmount(unitPaid(line) * picked)}" else "—",
                                    Modifier.width(96.dp),
                                    fontFamily = mu.kidscorner.till.ui.theme.PlexMono,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    textAlign = TextAlign.End,
                                    color = if (picked > 0) Handoff.InkFigure else Handoff.Fainter,
                                )
                            }
                            Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineFaint))
                        }
                    }

                    Row(
                        Modifier.padding(top = 12.dp, bottom = 2.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlineKey("Return everything") {
                            qty = sale.lines.associate { it.id to returnable(it) }
                                .filterValues { it > 0 }
                        }
                        OutlineKey("Clear selection", muted = true) { qty = emptyMap() }
                    }
                }
            }

            // ── reason and restock: `margin-top:12; padding:15px 16px` ──────
            Surface(
                shape = RoundedCornerShape(13.dp),
                color = Handoff.Surface,
                border = BorderStroke(1.dp, Handoff.LineSoft),
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            ) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 15.dp)) {
                    Text(
                        "REASON",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.1.sp,
                        color = Handoff.Muted3,
                        modifier = Modifier.padding(bottom = 9.dp),
                    )
                    REFUND_REASONS.chunked(3).forEach { row ->
                        Row(
                            Modifier.fillMaxWidth().padding(bottom = 7.dp),
                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                        ) {
                            row.forEach { option ->
                                ReasonChip(option, reason == option, Modifier.weight(1f)) {
                                    reason = option
                                    // A faulty item does not go back on the
                                    // shelf. Flipped for the cashier rather
                                    // than left for them to remember.
                                    if (option == "Faulty item") restock = false
                                }
                            }
                            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }

                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(top = 6.dp)
                            .clip(RoundedCornerShape(11.dp))
                            .background(Handoff.FieldWell)
                            .border(1.dp, Handoff.LineIdle, RoundedCornerShape(11.dp))
                            .padding(horizontal = 13.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(11.dp),
                    ) {
                        HandoffToggle(restock) { restock = !restock }
                        Column {
                            Text(
                                "Put items back into stock",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Handoff.Ink,
                            )
                            Text(
                                if (restock) {
                                    "Stock goes back on the shelf count immediately."
                                } else {
                                    "Faulty stock stays out — back office writes it off."
                                },
                                fontSize = 11.5.sp,
                                color = Handoff.Muted3,
                            )
                        }
                    }
                }
            }
        }

        // ═══════════════════════════════════════════════════ the refund ══════
        Box(Modifier.fillMaxHeight().width(1.dp).background(Handoff.LineChrome))

        Column(
            Modifier
                .width(392.dp)
                .fillMaxHeight()
                .background(Handoff.Surface)
                .padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 18.dp),
        ) {
            // Coloured once there is something to give back. It opened as a
            // 44sp red "−Rs 0.00" — the headline of the screen, in the loudest
            // colour the palette owns, stating a refund of nothing. The size
            // is kept so the figure does not jump when it arrives; only the
            // weight of the colour waits for a reason.
            Text(
                "REFUND TOTAL",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.1.sp,
                color = if (total > 0) Handoff.ChangeLabel else Handoff.Muted3,
            )
            Text(
                "−${formatRs(total)}",
                fontFamily = mu.kidscorner.till.ui.theme.PlexMono,
                fontSize = 44.sp,
                lineHeight = 48.4.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-1.76).sp,
                color = if (total > 0) Handoff.ChangeFigure else Handoff.Faint,
                modifier = Modifier.padding(top = 2.dp),
            )
            Text(
                if (count == 0) {
                    "Nothing selected yet"
                } else {
                    "$count ${if (count == 1) "item" else "items"} · originally paid by $originally"
                },
                fontSize = 12.5.sp,
                color = Handoff.Muted3,
                modifier = Modifier.padding(top = 4.dp),
            )

            Text(
                "REFUND TO",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.1.sp,
                color = Handoff.Muted3,
                modifier = Modifier.padding(top = 18.dp, bottom = 8.dp),
            )

            // my.t money was missing. The shop takes it, the back office
            // offers it as a refund method, and /api/till/refund has always
            // accepted it — only this grid left it out. A cashier refunding a
            // my.t money sale had to pick Cash, which takes real notes out of
            // the drawer for a payment that never put any in, and leaves the
            // Z short by the refund.
            val methods = paymentMethods.map { it to methodIcon(it) } +
                ("exchange" to Icons.Default.SwapHoriz)
            methods.chunked(2).forEach { pair ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    pair.forEach { (id, icon) ->
                        MethodKey(
                            label = if (id == "exchange") "Exchange" else methodLabel(id),
                            icon = icon,
                            selected = method == id,
                            modifier = Modifier.weight(1f),
                        ) { method = id }
                    }
                    // Five in a two-wide grid leaves one alone on the last
                    // row; without this it stretches to full width and reads
                    // as a different, more important key.
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }

            Text(
                if (sale.payments.any { it.method == method }) {
                    "Refunding to the original method ($originally)."
                } else {
                    "Different from the original method ($originally) — " +
                        "the back office will see the mismatch."
                },
                fontSize = 11.5.sp,
                lineHeight = 17.25.sp,
                color = Handoff.Muted3,
                modifier = Modifier.padding(top = 10.dp),
            )

            error?.let {
                Text(
                    it,
                    fontSize = 12.5.sp,
                    color = Handoff.Danger,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }

            Spacer(Modifier.weight(1f))

            if (ready) {
                Surface(
                    onClick = { onRefund(qty.filterValues { it > 0 }, reason!!, method, restock) },
                    shape = RoundedCornerShape(14.dp),
                    color = Handoff.Danger,
                    contentColor = Color.White,
                    shadowElevation = 6.dp,
                    modifier = Modifier.fillMaxWidth().height(68.dp),
                ) {
                    Row(
                        Modifier.fillMaxSize().padding(horizontal = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Refund",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "−${formatRs(total)}",
                            fontFamily = mu.kidscorner.till.ui.theme.PlexMono,
                            fontSize = 21.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(68.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Handoff.Blocked),
                    Alignment.Center,
                ) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(26.dp), Handoff.Danger, 2.dp)
                    } else {
                        Text(
                            if (total <= 0) "Pick what is coming back" else "Pick a reason",
                            fontSize = 15.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.BlockedText,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StepperKey(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        color = Handoff.FieldWell,
        contentColor = if (enabled) Handoff.InkStrong else Handoff.Fainter,
        modifier = Modifier.size(48.dp),
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Icon(icon, label, Modifier.size(16.dp))
        }
    }
}

/** `height:48px; padding:0 15px; radius:11` — a plain bordered key. */
@Composable
private fun OutlineKey(label: String, muted: Boolean = false, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(11.dp),
        color = Handoff.Surface,
        contentColor = if (muted) Handoff.Muted else Handoff.InkStrong,
        border = BorderStroke(1.dp, Handoff.Line),
        modifier = Modifier.height(48.dp),
    ) {
        Box(Modifier.fillMaxHeight().padding(horizontal = 15.dp), Alignment.Center) {
            Text(label, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** `height:46px; padding:0 16px; radius:11` — danger-tinted when picked. */
@Composable
private fun ReasonChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(11.dp),
        color = if (selected) Handoff.DangerTint else Handoff.Surface,
        contentColor = if (selected) Handoff.Danger else Handoff.Muted,
        border = BorderStroke(1.dp, if (selected) Handoff.Danger else Handoff.LineField),
        modifier = modifier.height(46.dp),
    ) {
        Box(Modifier.fillMaxSize().padding(horizontal = 8.dp), Alignment.Center) {
            Text(
                label,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** `height:58px; padding:0 12px; radius:12` with a 36px icon well. */
@Composable
private fun MethodKey(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = if (selected) Handoff.DangerTint else Handoff.Surface,
        contentColor = Handoff.Ink,
        border = BorderStroke(1.dp, if (selected) Handoff.Danger else Handoff.LineSoft),
        modifier = modifier.height(58.dp),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Box(
                Modifier.size(36.dp).clip(RoundedCornerShape(9.dp)).background(Handoff.Well),
                Alignment.Center,
            ) {
                Icon(icon, null, tint = Handoff.Muted, modifier = Modifier.size(18.dp))
            }
            Text(
                label,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** The same 52x30 switch the settings screen uses, in the danger colour. */
@Composable
fun HandoffToggle(on: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = if (on) Handoff.AccentSolid else Handoff.Ghost,
        modifier = Modifier.size(width = 52.dp, height = 30.dp),
    ) {
        Box(Modifier.fillMaxSize().padding(horizontal = 3.dp), Alignment.CenterStart) {
            Box(
                Modifier
                    .padding(start = if (on) 22.dp else 0.dp)
                    .size(24.dp)
                    .clip(androidx.compose.foundation.shape.CircleShape)
                    .background(Color.White),
            )
        }
    }
}

/**
 * What the cashier sees the moment a return goes through.
 *
 * A return ends with money leaving the drawer, so the confirmation names the
 * credit note — that number is what the customer's paperwork carries, and what
 * anybody looking into it later searches on. The figure is the server's, not a
 * total this screen worked out for itself.
 */
@Composable
fun RefundDoneDialog(refund: RefundResponse, onDismiss: () -> Unit) {
    HandoffDialog(
        title = "Return complete",
        subtitle = "The credit note is on the shop's records.",
        width = 460,
        onDismiss = onDismiss,
    ) {
        Column(Modifier.padding(20.dp)) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Handoff.DangerTint)
                    .border(1.dp, Handoff.DangerLine, RoundedCornerShape(14.dp))
                    .padding(horizontal = 20.dp, vertical = 16.dp),
            ) {
                Text(
                    "REFUNDED ${methodWord(refund.refundMethod).uppercase()}",
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.15.sp,
                    color = Handoff.Danger,
                )
                Text(
                    formatRs(refund.total),
                    fontFamily = PlexMono,
                    fontSize = 40.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-1.6).sp,
                    color = Handoff.Danger,
                    modifier = Modifier.padding(top = 3.dp),
                )
                Text(
                    refund.creditNo,
                    fontFamily = PlexMono,
                    fontSize = 13.sp,
                    color = Handoff.Muted2,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            HandoffButton(
                label = "Back to selling",
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            )
        }
    }
}

/** The mark for each method — a transfer is not a phone wallet. */
private fun methodIcon(method: String): ImageVector = when (method) {
    "cash" -> Icons.Default.Payments
    "card" -> Icons.Default.CreditCard
    "bank" -> Icons.Default.AccountBalance
    "exchange" -> Icons.Default.SwapHoriz
    else -> Icons.Default.PhoneAndroid
}

private fun methodWord(method: String): String = when (method) {
    "cash" -> "in cash"
    "card" -> "to card"
    "juice" -> "by Juice"
    "myt_money" -> "by my.t money"
    "bank" -> "by bank transfer"
    "exchange" -> "as an exchange"
    else -> method
}
