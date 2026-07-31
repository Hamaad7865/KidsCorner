package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.Warning
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.CartLine
import mu.kidscorner.till.data.CartTotals
import mu.kidscorner.till.data.SalePayment
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatQty
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

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
    busy: Boolean,
    error: String?,
    frozen: Boolean,
    onConfirm: (List<SalePayment>, Double) -> Unit,
    onCancel: () -> Unit,
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

    Row(modifier.fillMaxSize().background(Handoff.Canvas)) {

        // ═══════════════════════════════════════════════ the working column ══
        Column(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .padding(start = 16.dp, end = 16.dp, top = 13.dp, bottom = 15.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // ── header: a 44px "Back to sale" then the title stack ──────────
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Surface(
                    onClick = onCancel,
                    enabled = !busy && !frozen,
                    shape = RoundedCornerShape(11.dp),
                    color = Handoff.Surface,
                    contentColor = Handoff.InkStrong,
                    border = BorderStroke(1.dp, Handoff.Line),
                    modifier = Modifier.height(48.dp),
                ) {
                    Row(
                        Modifier.padding(start = 11.dp, end = 14.dp).fillMaxHeight(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, null, Modifier.size(16.dp))
                        Text("Back to sale", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                Column {
                    Text(
                        "Take payment",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.16).sp,
                        color = Handoff.Ink,
                    )
                    Text(
                        cashierName,
                        fontFamily = PlexMono,
                        fontSize = 11.sp,
                        letterSpacing = 0.55.sp,
                        color = Handoff.Muted4,
                    )
                }
            }

            // ── due card: `padding:14px 20px; radius:14px`, figure 52px mono ─
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = Handoff.Surface,
                border = BorderStroke(1.dp, Handoff.LineSoft),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            if (paid > 0) "REMAINING TO PAY" else "TOTAL DUE",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.1.sp,
                            color = Handoff.Muted3,
                        )
                        Text(
                            formatRs(outstanding),
                            fontFamily = PlexMono,
                            fontSize = 46.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-1.84).sp,
                            lineHeight = 48.3.sp,
                            color = Handoff.InkFigure,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                    if (payments.isNotEmpty()) {
                        Box(
                            Modifier.width(1.dp).height(46.dp).background(Color(0xFFEDF1F2)),
                        )
                        Column(horizontalAlignment = Alignment.End) {
                            Text(
                                "Total ${formatRs(totals.total)}",
                                fontSize = 11.5.sp,
                                color = Handoff.Muted3,
                            )
                            Text(
                                "Paid ${formatRs(paid)}",
                                fontSize = 13.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Handoff.AccentText,
                                modifier = Modifier.padding(top = 3.dp),
                            )
                        }
                    }
                }
            }

            // ── methods: `repeat(4,1fr); gap:10px` ──────────────────────────
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                horizontalArrangement = Arrangement.spacedBy(9.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
                modifier = Modifier.height(if (paymentMethods.size > 4) 153.dp else 72.dp),
            ) {
                items(paymentMethods) { candidate ->
                    MethodTile(
                        method = candidate,
                        selected = method == candidate,
                        enabled = !busy && !frozen,
                        onClick = { method = candidate },
                    )
                }
            }

            // ── the pad beside the quick amounts and the change panel ───────
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(11.dp)) {

                Column(
                    Modifier.width(296.dp).fillMaxHeight(),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    // `height:56px; padding:0 16px; border:1px solid #DAE3E4`
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Handoff.Surface)
                            .border(1.dp, Handoff.Line, RoundedCornerShape(12.dp))
                            .padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (isCash) "CASH TENDERED" else "AMOUNT",
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 0.69.sp,
                            color = Handoff.Muted4,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            if (entry.isBlank()) "0" else formatAmount(entered),
                            fontFamily = PlexMono,
                            fontSize = 23.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.46).sp,
                            color = if (entry.isBlank()) Handoff.Faint else Handoff.InkFigure,
                        )
                    }

                    HandoffPad(
                        enabled = !busy && !frozen,
                        onKey = { entry = entry.appendPadKey(it) },
                        onBackspace = { entry = entry.dropLast(1) },
                        modifier = Modifier.weight(1f),
                    )
                }

                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(7.dp)) {

                    // `repeat(2,1fr); gap:7px` — four 56px quick amounts.
                    val quick = if (isCash) {
                        listOf(
                            "Exact ${formatRs(outstanding)}" to outstanding,
                            "Rs 100" to 100.0,
                            "Rs 500" to 500.0,
                            "Rs 1,000" to 1_000.0,
                        )
                    } else {
                        listOf(
                            "Full ${formatRs(outstanding)}" to outstanding,
                            "Half ${formatRs(round2(outstanding / 2))}" to round2(outstanding / 2),
                            "Rs 500" to 500.0,
                            "Rs 1,000" to 1_000.0,
                        )
                    }
                    quick.chunked(2).forEach { pair ->
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                        ) {
                            pair.forEach { (label, value) ->
                                Surface(
                                    onClick = { entry = trimZeros(value) },
                                    enabled = !busy && !frozen && value > 0,
                                    shape = RoundedCornerShape(12.dp),
                                    color = Handoff.Surface,
                                    contentColor = Handoff.InkStrong,
                                    border = BorderStroke(1.dp, Handoff.LineField),
                                    modifier = Modifier.weight(1f).height(56.dp),
                                ) {
                                    Box(
                                        Modifier.fillMaxSize().padding(horizontal = 10.dp),
                                        Alignment.Center,
                                    ) {
                                        Text(
                                            label,
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // ── change due (cash) or the method's own instruction ────
                    Column(
                        Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (isCash) Handoff.ChangeTint else Handoff.Surface)
                            .border(
                                1.dp,
                                if (isCash) Handoff.ChangeLine else Handoff.LineSoft,
                                RoundedCornerShape(14.dp),
                            )
                            .padding(horizontal = 20.dp, vertical = 14.dp),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        if (isCash) {
                            Text(
                                "CHANGE DUE",
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 1.15.sp,
                                color = Handoff.ChangeLabel,
                            )
                            Text(
                                formatRs(pendingChange),
                                fontFamily = PlexMono,
                                fontSize = 40.sp,
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = (-1.6).sp,
                                lineHeight = 40.sp,
                                color = Handoff.ChangeFigure,
                                modifier = Modifier.padding(vertical = 6.dp),
                            )
                            Text(
                                when {
                                    entered == 0.0 -> "Type or tap the amount handed over."
                                    entered < outstanding ->
                                        "Short by ${formatRs(outstanding - entered)} — " +
                                            "this will split the payment."
                                    pendingChange == 0.0 -> "Exact amount — nothing to hand back."
                                    else -> "Hand back ${formatRs(pendingChange)}."
                                },
                                fontSize = 12.sp,
                                color = Handoff.ChangeNote,
                            )
                        } else {
                            Text(
                                methodHint(method),
                                fontSize = 13.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Handoff.InkStrong,
                            )
                            Text(
                                "Amount is pre-filled with what is left to pay. Adjust it on " +
                                    "the keypad to split across methods.",
                                fontSize = 12.5.sp,
                                lineHeight = 18.75.sp,
                                color = Handoff.Muted3,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                    }

                    if (error != null) {
                        Surface(
                            shape = RoundedCornerShape(11.dp),
                            color = Handoff.DangerTint,
                            contentColor = Handoff.Danger,
                            border = BorderStroke(1.dp, Handoff.DangerLine),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                Modifier.padding(12.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Icon(Icons.Default.Warning, null, Modifier.size(18.dp))
                                Text(error, fontSize = 12.5.sp)
                            }
                        }
                    }

                    if (frozen) {
                        Text(
                            "This sale was sent but the till did not hear back, so it may " +
                                "already be done. Take it again — it will finish the same " +
                                "sale, not make a second one.",
                            fontSize = 12.sp,
                            color = Handoff.Muted2,
                        )
                    }

                    // ── the 72px primary, or the handoff's blocked well ──────
                    if (ready) {
                        Surface(
                            onClick = ::primaryTap,
                            shape = RoundedCornerShape(14.dp),
                            color = Handoff.AccentSolid,
                            contentColor = Color.White,
                            shadowElevation = 6.dp,
                            modifier = Modifier.fillMaxWidth().height(72.dp),
                        ) {
                            Row(
                                Modifier.fillMaxSize().padding(horizontal = 22.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    if (completes) "Complete sale" else "Add payment",
                                    fontSize = 17.sp,
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 0.34.sp,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    formatRs(takeNow),
                                    fontFamily = PlexMono,
                                    fontSize = 21.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    } else {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(72.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(Handoff.Blocked),
                            Alignment.Center,
                        ) {
                            if (busy) {
                                CircularProgressIndicator(
                                    Modifier.size(26.dp),
                                    Handoff.AccentSolid,
                                    2.dp,
                                )
                            } else {
                                Text(
                                    if (isCash) "Enter the cash received" else "Enter an amount",
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

        // ═══════════════════════════════════════════════ the sale summary ═══
        Box(Modifier.fillMaxHeight().width(1.dp).background(Handoff.LineChrome))

        Column(Modifier.width(392.dp).fillMaxHeight().background(Handoff.Surface)) {
            Row(
                Modifier.fillMaxWidth().height(46.dp).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Sale summary",
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.Muted,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "${formatQty(totals.itemCount)} " +
                        if (totals.itemCount == 1) "item" else "items",
                    fontSize = 12.sp,
                    color = Handoff.Muted3,
                )
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFEDF1F2)))

            LazyColumn(
                Modifier.weight(1f).padding(horizontal = 16.dp, vertical = 6.dp),
            ) {
                items(lines, key = { it.variantId }) { line -> SummaryLine(line) }

                if (payments.isNotEmpty()) {
                    item {
                        Text(
                            "PAYMENTS TAKEN",
                            fontSize = 10.5.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.05.sp,
                            color = Handoff.Muted3,
                            modifier = Modifier.padding(top = 12.dp, bottom = 6.dp),
                        )
                    }
                    items(payments.withIndex().toList(), key = { "p${it.index}" }) { (index, payment) ->
                        TakenPayment(
                            payment = payment,
                            enabled = !busy && !frozen,
                            onRemove = { payments = payments.filterIndexed { i, _ -> i != index } },
                        )
                    }
                    item {
                        Text(
                            "Pick another method above to split the rest.",
                            fontSize = 11.5.sp,
                            color = Handoff.Muted4,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
            }

            // `border-top:1px solid #E7EDEE; background:#FBFDFD; padding:12px 16px 16px`
            Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineIdle))
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFFBFDFD))
                    .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
            ) {
                SummaryRow("Subtotal", formatAmount(totals.subtotal))
                val discount = round2(totals.lineDiscounts + totals.saleDiscount)
                if (discount > 0) {
                    SummaryRow("Discount", "-${formatAmount(discount)}", tone = Handoff.Danger)
                }
                // VAT-inclusive: this is the portion already inside the total,
                // never something added to it.
                SummaryRow(
                    "VAT (included)",
                    formatAmount(totals.vat),
                    labelSize = 12.sp,
                    tone = Handoff.Muted4,
                )

                Box(
                    Modifier.fillMaxWidth().height(1.dp)
                        .padding(top = 8.dp)
                        .background(Handoff.LineIdle),
                )
                Row(
                    Modifier.fillMaxWidth().padding(top = 9.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    Text(
                        "TOTAL",
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.25.sp,
                        color = Handoff.Muted,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        formatAmount(totals.total),
                        fontFamily = PlexMono,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.78).sp,
                        lineHeight = 26.sp,
                        color = Handoff.InkFigure,
                    )
                }
            }
        }
    }
}

/** `padding:10px 0` — qty×, name over swatch + variant, then the net. */
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
                color = Color(0xFF5C7276),
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

/** `padding:2px 0` — a quiet label against a mono figure. */
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
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(13.dp),
        color = if (selected) Handoff.AccentTint else Handoff.Surface,
        contentColor = if (selected) Handoff.AccentText else Handoff.Ink,
        border = BorderStroke(1.dp, if (selected) Handoff.AccentSolid else Handoff.LineSoft),
        modifier = Modifier.height(72.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp).fillMaxHeight(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            Box(
                Modifier
                    .size(42.dp)
                    .background(
                        if (selected) Handoff.AccentSolid else Handoff.Well,
                        RoundedCornerShape(11.dp),
                    ),
                Alignment.Center,
            ) {
                Icon(
                    methodIcon(method),
                    contentDescription = null,
                    tint = if (selected) Color.White else Handoff.Muted,
                    modifier = Modifier.size(21.dp),
                )
            }
            Column {
                Text(
                    methodLabel(method),
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.15).sp,
                )
                Text(methodSub(method), fontSize = 11.sp, color = Handoff.Muted3)
            }
        }
    }
}

private fun methodIcon(method: String): ImageVector = when (method) {
    "cash" -> Icons.Default.Payments
    "card" -> Icons.Default.CreditCard
    else -> Icons.Default.PhoneAndroid
}

private fun methodSub(method: String): String = when (method) {
    "cash" -> "Notes & coins"
    "card" -> "Visa · Mastercard"
    "juice" -> "MCB mobile"
    "myt_money" -> "Scan to pay"
    else -> ""
}

/** `methodHint` — what the cashier tells the customer to do. */
private fun methodHint(method: String): String = when (method) {
    "card" -> "Insert or tap the card on the terminal"
    "juice" -> "Customer sends to Kids Corner on Juice"
    "myt_money" -> "Customer scans the my.t money QR"
    else -> "Take the cash and count the change"
}

/** The shop's own words, not the database's. */
fun methodLabel(method: String): String = when (method) {
    "cash" -> "Cash"
    "card" -> "Card"
    "juice" -> "Juice"
    "myt_money" -> "my.t money"
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
