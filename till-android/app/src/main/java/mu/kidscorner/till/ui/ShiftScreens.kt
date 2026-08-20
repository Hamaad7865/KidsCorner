package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.CloseShiftResponse
import mu.kidscorner.till.data.ShiftTotals
import mu.kidscorner.till.data.clockOf
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatQty
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.nowDayAndClock
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.data.todayLong
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * `atOpenShift` — a 520px card, centred on the canvas.
 *
 * `width:520px;border:1px solid #E3E9EA;border-radius:18px;padding:24px 26px 26px`
 * over a 32px avatar, a 72px float well, three quick amounts at 48px, the
 * keypad on 60px rows and a 68px start button.
 *
 * Counting the opening float is on its own screen rather than buried in a
 * setting because it is the baseline every later figure is measured against —
 * get it wrong and the whole day reconciles wrong.
 */
@Composable
fun OpenShiftScreen(
    shopName: String,
    cashierName: String,
    busy: Boolean,
    error: String?,
    /**
     * The shop cannot be reached.
     *
     * Unlike the sell screen, this one genuinely cannot proceed without it: a
     * drawer is a row on the server, and every sale names its id. So this says
     * so before the cashier counts a float and presses a button that cannot
     * work — but it does NOT disable Start shift, because `online` only turns
     * true when a call succeeds, and refusing to let anybody try would strand
     * a till whose line came back a moment ago.
     */
    offline: Boolean,
    onOpen: (Double) -> Unit,
    onLock: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var entry by remember { mutableStateOf("") }
    val amount = entry.toDoubleOrNull() ?: 0.0
    val stamp = remember { nowDayAndClock() }

    Box(
        modifier.fillMaxSize().background(Handoff.Canvas).padding(14.dp),
        Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = Handoff.Surface,
            border = BorderStroke(1.dp, Handoff.LineSoft),
            shadowElevation = 12.dp,
            modifier = Modifier.width(520.dp),
        ) {
            Column(Modifier.padding(start = 26.dp, end = 26.dp, top = 22.dp, bottom = 24.dp)) {

                // ── header: `gap:11px; margin-bottom:18px` ──────────────────
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(11.dp),
                    modifier = Modifier.padding(bottom = 15.dp),
                ) {
                    Avatar(cashierName, size = 32)
                    Column {
                        Text(
                            "Open shift",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.17).sp,
                            color = Handoff.Ink,
                        )
                        Text(
                            "$cashierName · $stamp",
                            fontSize = 12.5.sp,
                            color = Handoff.Muted3,
                        )
                    }
                }

                PadLabel("Opening cash float", bottom = 7.dp)

                // ── the float well: `height:72px; padding:0 18px; radius:13px`
                AmountWell(
                    value = if (entry.isBlank()) "0" else formatAmount(amount),
                    height = 68,
                    horizontal = 18,
                    radius = 13,
                    currencySize = 15.sp,
                    figureSize = 34.sp,
                    modifier = Modifier.padding(bottom = 9.dp),
                )

                // ── `repeat(3,1fr)` quick amounts at 48px ───────────────────
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 9.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    listOf(1000, 2000, 5000).forEach { value ->
                        Surface(
                            onClick = { entry = value.toString() },
                            enabled = !busy,
                            shape = RoundedCornerShape(11.dp),
                            color = Handoff.Surface,
                            contentColor = Handoff.InkStrong,
                            border = BorderStroke(1.dp, Handoff.Line),
                            modifier = Modifier.weight(1f).height(48.dp),
                        ) {
                            Box(Modifier.fillMaxSize(), Alignment.Center) {
                                Text(
                                    "Rs ${formatQty(value)}",
                                    fontFamily = PlexMono,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }

                HandoffPad(
                    onKey = { entry = entry.appendPadKey(it) },
                    onBackspace = { entry = entry.dropLast(1) },
                    rowHeight = 56.dp,
                    fontSize = 20.sp,
                    enabled = !busy,
                    modifier = Modifier.padding(bottom = 13.dp),
                )

                // ── `height:68px; radius:14px` ─────────────────────────────
                val canStart = !busy && entry.isNotBlank()
                Surface(
                    // A zero float is legitimate — some shops start empty — so
                    // the guard is on the field being untouched, not on the
                    // value being above zero.
                    onClick = { onOpen(round2(amount)) },
                    enabled = canStart,
                    shape = RoundedCornerShape(14.dp),
                    color = if (canStart) Handoff.AccentSolid else Handoff.Blocked,
                    contentColor = if (canStart) Color.White else Handoff.BlockedText,
                    shadowElevation = if (canStart) 6.dp else 0.dp,
                    modifier = Modifier.fillMaxWidth().height(66.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        if (busy) {
                            CircularProgressIndicator(Modifier.size(24.dp), Color.White, 2.dp)
                        } else {
                            Text(
                                if (canStart) "Start shift" else "Count the float first",
                                fontSize = if (canStart) 18.sp else 15.5.sp,
                                fontWeight = if (canStart) FontWeight.Bold else FontWeight.SemiBold,
                            )
                        }
                    }
                }

                // `text-align:center;font-size:11.5px;color:#8A9DA1;margin-top:11px`
                Text(
                    when {
                        error != null -> error
                        // Said before the float is counted, not after the
                        // button fails. Amber rather than scarlet: the line
                        // being down is not the cashier doing something wrong.
                        offline -> "No connection. A drawer is opened on the shop's " +
                            "server — every sale names it."
                        else -> "$shopName · this figure is what the drawer is measured against"
                    },
                    fontSize = 11.5.sp,
                    // Set explicitly: the default leading at this size wraps
                    // the offline sentence onto two widely-spaced lines with
                    // one word stranded on the second.
                    lineHeight = 16.sp,
                    color = when {
                        error != null -> Handoff.Danger
                        offline -> Handoff.WarnText
                        else -> Handoff.Muted4
                    },
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                )

                // Not in the handoff, which has no way back off this screen —
                // but a cashier who opened the wrong till needs one, and it is
                // drawn as a link rather than a button so it does not compete
                // with Start shift. Beside it, while the line is down, the only
                // other thing that can help.
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    Text(
                        "Back to the PIN screen",
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Handoff.Muted3,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable(enabled = !busy, onClick = onLock)
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                    if (offline) {
                        Text(
                            "Look for the shop again",
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.WarnText,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable(enabled = !busy, onClick = onRetry)
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * `1250.5` -> `"1250.5"`, `1250.0` -> `"1250"` — plain digits with no grouping,
 * as if the cashier had typed it on the pad themselves, so backspacing or
 * retyping over it behaves exactly like any other pad entry.
 */
private fun Double.toPadEntry(): String {
    val cents = Math.round(round2(this) * 100)
    val rupees = cents / 100
    val remainder = cents % 100
    return if (remainder == 0L) rupees.toString() else "$rupees.${remainder.toString().padStart(2, '0')}"
}

/**
 * `atCloseShift` — the reading on the left, the count on the right.
 *
 * `flex:1` scroller at `padding:18px 20px 24px` beside a `width:460px` pane
 * with `border-left:1px solid #E1E8E9` and `padding:16px 18px 18px`.
 *
 * `expectedCash` is fetched from the server, never accumulated here: it has to
 * include sales rung up on any other till and every petty-cash movement, none
 * of which this device has seen.
 */
@Composable
fun CloseShiftScreen(
    totals: ShiftTotals?,
    summary: CloseShiftResponse?,
    cashierName: String,
    busy: Boolean,
    error: String?,
    onClose: (Double, String?) -> Unit,
    onCancel: () -> Unit,
    onFinish: () -> Unit,
    modifier: Modifier = Modifier,
    openedAt: String? = null,
) {
    var counted by remember { mutableStateOf("") }
    // Seeded once, the moment the expected figure first arrives, so a cashier
    // who agrees with the drawer never has to retype it — but only once, so a
    // later refresh of `totals` can never clobber a count already in progress.
    var seeded by remember { mutableStateOf(false) }

    if (summary != null) {
        CloseSummary(summary, onFinish, modifier)
        return
    }

    val expected = totals?.expectedCash ?: 0.0

    LaunchedEffect(totals) {
        if (!seeded && totals != null) {
            counted = expected.toPadEntry()
            seeded = true
        }
    }

    val countedValue = round2(counted.toDoubleOrNull() ?: 0.0)
    val variance = round2(countedValue - expected)
    val opened = clockOf(openedAt)
    val salesTotal = totals?.salesTotal ?: 0.0

    Row(modifier.fillMaxSize().background(Handoff.Canvas)) {

        // ═══════════════════════════════════════════════ the reading ═══════
        Column(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .verticalScroll(rememberScrollState())
                .padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 22.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(bottom = 14.dp),
            ) {
                // `width:48px;height:48px;border:1px solid #DAE3E4;radius:11px`
                Surface(
                    onClick = onCancel,
                    enabled = !busy,
                    shape = RoundedCornerShape(11.dp),
                    color = Handoff.Surface,
                    contentColor = Handoff.InkStrong,
                    border = BorderStroke(1.dp, Handoff.Line),
                    modifier = Modifier.size(48.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                            "Keep selling",
                            Modifier.size(17.dp),
                        )
                    }
                }
                Column {
                    Text(
                        "End of day",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.38).sp,
                        color = Handoff.Ink,
                    )
                    Text(
                        buildString {
                            append(todayLong())
                            append(" · ")
                            append(cashierName)
                            opened?.let { append(" · opened $it") }
                        },
                        fontSize = 12.5.sp,
                        color = Handoff.Muted3,
                    )
                }
            }

            if (totals == null) {
                Box(Modifier.fillMaxWidth().height(160.dp), Alignment.Center) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(28.dp), Handoff.AccentSolid, 2.dp)
                    } else {
                        Text("No figures yet.", fontSize = 13.5.sp, color = Handoff.Muted3)
                    }
                }
            } else {
                // ── `repeat(3,1fr); gap:12px` stat cards ───────────────────
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    StatCard("Total sales", Modifier.weight(1f)) {
                        Currency()
                        Figure(formatAmount(salesTotal))
                    }
                    StatCard("Transactions", Modifier.weight(1f)) {
                        Figure(formatQty(totals.saleCount))
                        Spacer(Modifier.width(2.dp))
                        Text(
                            "${formatQty(totals.itemCount)} items",
                            fontSize = 12.5.sp,
                            color = Handoff.Muted3,
                        )
                    }
                    StatCard("Average basket", Modifier.weight(1f)) {
                        Currency()
                        Figure(formatAmount(totals.averageBasket))
                    }
                }

                // ── by payment method: `padding:16px 18px 8px` ─────────────
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = Handoff.Surface,
                    border = BorderStroke(1.dp, Handoff.LineSoft),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 8.dp)) {
                        Text(
                            "By payment method",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.14).sp,
                            color = Handoff.Ink,
                            modifier = Modifier.padding(bottom = 14.dp),
                        )
                        val rows = totals.byMethod.entries.sortedByDescending { it.value }
                        val methodTotal = rows.sumOf { it.value }
                        rows.forEach { (method, amount) ->
                            MethodRow(
                                label = methodLabel(method),
                                amount = amount,
                                share = if (methodTotal > 0) amount / methodTotal else 0.0,
                                color = methodColor(method),
                            )
                        }
                        if (rows.isEmpty()) {
                            Text(
                                "Nothing taken on this shift.",
                                fontSize = 13.sp,
                                color = Handoff.Muted3,
                                modifier = Modifier.padding(bottom = 12.dp),
                            )
                        }
                    }
                }

                if (totals.discountTotal != 0.0 || totals.vatTotal != 0.0) {
                    Spacer(Modifier.height(12.dp))
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = Handoff.Surface,
                        border = BorderStroke(1.dp, Handoff.LineSoft),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(Modifier.padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 14.dp)) {
                            Text(
                                "Also on this shift",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = (-0.14).sp,
                                color = Handoff.Ink,
                                modifier = Modifier.padding(bottom = 10.dp),
                            )
                            if (totals.discountTotal != 0.0) {
                                DrawerRow("Discounts given", formatRs(totals.discountTotal))
                            }
                            // VAT-inclusive: the portion already inside the totals
                            // above, never something added to them. Shown only when
                            // the shift actually took VAT — a shift traded entirely
                            // while unregistered draws no VAT row, even if it gave
                            // discounts. Driven by the frozen sum, not the current
                            // registration setting.
                            if (totals.vatTotal != 0.0) {
                                DrawerRow("VAT within sales", formatRs(totals.vatTotal))
                            }
                        }
                    }
                }
            }
        }

        // ═══════════════════════════════════════════ the cash drawer ═══════
        Box(Modifier.fillMaxHeight().width(1.dp).background(Handoff.LineChrome))

        Column(
            Modifier
                .width(452.dp)
                .fillMaxHeight()
                .background(Handoff.Surface)
                .padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 18.dp),
        ) {
            Text(
                "Cash drawer",
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.15).sp,
                color = Handoff.Ink,
                modifier = Modifier.padding(bottom = 12.dp),
            )

            DrawerRow("Opening float", formatRs(totals?.openingFloat ?: 0.0))
            DrawerRow("Cash sales", formatRs(totals?.cashTaken ?: 0.0))
            if ((totals?.tillMovements ?: 0.0) != 0.0) {
                DrawerRow("Paid in / out", formatRs(totals!!.tillMovements))
            }

            // `padding:9px 0; margin-top:2px; border-top:1px solid #EDF1F2`
            Spacer(Modifier.height(2.dp))
            Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineSoft))
            Row(
                Modifier.fillMaxWidth().padding(vertical = 9.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                Text(
                    "Expected in drawer",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.InkStrong,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    formatRs(expected),
                    fontFamily = PlexMono,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.InkFigure,
                )
            }

            PadLabel("Counted cash", top = 10.dp, bottom = 7.dp)

            // `height:62px; padding:0 16px; radius:12px`
            AmountWell(
                value = if (counted.isBlank()) "0" else formatAmount(countedValue),
                height = 62,
                horizontal = 16,
                radius = 12,
                currencySize = 14.sp,
                figureSize = 30.sp,
            )

            HandoffPad(
                onKey = { counted = counted.appendPadKey(it, maxLength = 12) },
                onBackspace = { counted = counted.dropLast(1) },
                rowHeight = 52.dp,
                fontSize = 18.sp,
                radius = 11.dp,
                gap = 7.dp,
                enabled = !busy,
                modifier = Modifier.padding(top = 9.dp),
            )

            // ── the variance box: `margin-top:12px; padding:14px 16px` ──────
            val uncounted = counted.isBlank()
            val balanced = variance == 0.0
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(
                        when {
                            uncounted -> Handoff.FieldWell
                            balanced -> Handoff.AccentTint
                            else -> Handoff.ChangeTint
                        },
                    )
                    .border(
                        1.dp,
                        when {
                            uncounted -> Handoff.LineIdle
                            balanced -> Handoff.AccentLine
                            else -> Handoff.ChangeLine
                        },
                        RoundedCornerShape(12.dp),
                    )
                    .padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val tone = when {
                    uncounted -> Handoff.Muted4
                    balanced -> Handoff.AccentText
                    else -> Handoff.ChangeFigure
                }
                Text(
                    when {
                        uncounted -> "Count the drawer to see variance"
                        balanced -> "Balanced"
                        variance > 0 -> "Over by"
                        else -> "Short by"
                    },
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = tone,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    when {
                        uncounted -> "—"
                        balanced -> formatRs(0.0)
                        else -> formatRs(kotlin.math.abs(variance))
                    },
                    fontFamily = PlexMono,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = tone,
                )
            }

            if (error != null) {
                Text(
                    error,
                    fontSize = 12.5.sp,
                    color = Handoff.Danger,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }

            Spacer(Modifier.weight(1f))

            // `height:64px; background:#0C2429; radius:14px`
            val canClose = !busy && counted.isNotBlank()
            Surface(
                onClick = { onClose(countedValue, null) },
                enabled = canClose,
                shape = RoundedCornerShape(14.dp),
                color = if (canClose) Handoff.ScanButton else Handoff.Blocked,
                contentColor = if (canClose) Color.White else Handoff.BlockedText,
                modifier = Modifier.fillMaxWidth().height(64.dp),
            ) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(24.dp), Color.White, 2.dp)
                    } else {
                        Text(
                            if (canClose) "Close shift" else "Count the drawer first",
                            fontSize = if (canClose) 17.sp else 15.5.sp,
                            fontWeight = if (canClose) FontWeight.Bold else FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
    }
}

/**
 * What the handoff never drew: the Z the close produces.
 *
 * The design toasts "Shift closed · Z report printed" and returns to the PIN
 * screen, which works when the numbers are invented. They are not here — the
 * server freezes a Z and hands back the variance it recorded, and that figure
 * is the one the owner reconciles from. It gets a screen, drawn from the same
 * vocabulary as the variance box next door.
 */
@Composable
private fun CloseSummary(
    summary: CloseShiftResponse,
    onFinish: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val balanced = summary.variance == 0.0

    Box(
        modifier.fillMaxSize().background(Handoff.Canvas).padding(20.dp),
        Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = Handoff.Surface,
            border = BorderStroke(1.dp, Handoff.LineSoft),
            shadowElevation = 12.dp,
            modifier = Modifier.width(520.dp),
        ) {
            Column(
                Modifier.padding(start = 26.dp, end = 26.dp, top = 24.dp, bottom = 26.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "Shift closed",
                    fontSize = 19.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.38).sp,
                    color = Handoff.Ink,
                )
                Text(
                    if (summary.zNo.isBlank()) "Z report filed" else "${summary.zNo} · filed",
                    fontSize = 12.5.sp,
                    color = Handoff.Muted3,
                    modifier = Modifier.padding(top = 3.dp, bottom = 18.dp),
                )

                DrawerRow("Expected", formatRs(summary.expectedCash))
                DrawerRow("Counted", formatRs(summary.countedCash))

                Spacer(Modifier.height(12.dp))

                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (balanced) Handoff.AccentTint else Handoff.ChangeTint)
                        .border(
                            1.dp,
                            if (balanced) Handoff.AccentLine else Handoff.ChangeLine,
                            RoundedCornerShape(12.dp),
                        )
                        .padding(horizontal = 16.dp, vertical = 18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val tone = if (balanced) Handoff.AccentText else Handoff.ChangeFigure
                    Text(
                        when {
                            balanced -> "Balanced"
                            summary.variance > 0 -> "Over by"
                            else -> "Short by"
                        },
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = tone,
                    )
                    Row(
                        Modifier.padding(top = 4.dp),
                        verticalAlignment = Alignment.Bottom,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("Rs", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = tone)
                        Text(
                            formatAmount(kotlin.math.abs(summary.variance)),
                            fontFamily = PlexMono,
                            fontSize = 34.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-1.02).sp,
                            color = tone,
                        )
                    }
                }

                if (!balanced) {
                    Text(
                        "The variance is recorded against this shift. It is not an " +
                            "accusation — it is the number the owner reconciles from.",
                        fontSize = 11.5.sp,
                        color = Handoff.Muted3,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 11.dp),
                    )
                }

                Spacer(Modifier.height(18.dp))

                Surface(
                    onClick = onFinish,
                    shape = RoundedCornerShape(14.dp),
                    color = Handoff.AccentSolid,
                    contentColor = Color.White,
                    shadowElevation = 6.dp,
                    modifier = Modifier.fillMaxWidth().height(68.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Text("Done", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────── the pieces ───

/** `font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase` */
@Composable
private fun PadLabel(text: String, top: androidx.compose.ui.unit.Dp = 0.dp, bottom: androidx.compose.ui.unit.Dp) {
    Text(
        text.uppercase(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.1.sp,
        color = Handoff.Muted3,
        modifier = Modifier.padding(top = top, bottom = bottom),
    )
}

/**
 * The well a figure is typed into: `Rs` on the left, the number on the right.
 *
 * Right-aligned because a running total that grows leftwards from a fixed edge
 * is readable while it is being typed; one that grows rightwards moves the
 * digits you already entered.
 */
@Composable
private fun AmountWell(
    value: String,
    height: Int,
    horizontal: Int,
    radius: Int,
    currencySize: androidx.compose.ui.unit.TextUnit,
    figureSize: androidx.compose.ui.unit.TextUnit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(height.dp)
            .clip(RoundedCornerShape(radius.dp))
            .background(Handoff.FieldWell)
            .border(1.dp, Handoff.LineField, RoundedCornerShape(radius.dp))
            .padding(horizontal = horizontal.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Rs",
            fontSize = currencySize,
            fontWeight = FontWeight.SemiBold,
            color = Handoff.Muted3,
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            fontFamily = PlexMono,
            fontSize = figureSize,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (figureSize.value * -0.03f).sp,
            color = Handoff.InkFigure,
        )
    }
}

/** `border-radius:12px; padding:15px 16px` with a 10.5px caps label. */
@Composable
private fun StatCard(
    label: String,
    modifier: Modifier = Modifier,
    figure: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = Handoff.Surface,
        border = BorderStroke(1.dp, Handoff.LineSoft),
        modifier = modifier,
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 15.dp)) {
            Text(
                label.uppercase(),
                fontSize = 10.5.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.95.sp,
                color = Handoff.Muted2,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            Row(
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                content = figure,
            )
        }
    }
}

/** The `Rs` that leads a stat card's figure: 13px, 600, #7A8C90. */
@Composable
private fun Currency() {
    Text("Rs", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Muted3)
}

/** `IBM Plex Mono; font-size:28px; font-weight:600; letter-spacing:-.03em`. */
@Composable
private fun Figure(value: String) {
    Text(
        value,
        fontFamily = PlexMono,
        fontSize = 28.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.84).sp,
        color = Handoff.InkFigure,
    )
}

/** A dot, a name, a bar, a share and an amount — `padding:9px 0`. */
@Composable
private fun MethodRow(label: String, amount: Double, share: Double, color: Color) {
    Column {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.size(10.dp).clip(RoundedCornerShape(50)).background(color))
            Text(
                label,
                fontSize = 13.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.InkStrong,
                modifier = Modifier.width(112.dp),
            )
            Box(
                Modifier
                    .weight(1f)
                    .height(8.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Handoff.Well),
            ) {
                Box(
                    Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(share.toFloat().coerceIn(0f, 1f))
                        .clip(RoundedCornerShape(50))
                        .background(color),
                )
            }
            Text(
                "${kotlin.math.round(share * 100).toInt()}%",
                fontSize = 12.sp,
                color = Handoff.Muted3,
                textAlign = TextAlign.End,
                modifier = Modifier.width(52.dp),
            )
            Text(
                formatAmount(amount),
                fontFamily = PlexMono,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.InkFigure,
                textAlign = TextAlign.End,
                modifier = Modifier.width(96.dp),
            )
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineFaint))
    }
}

/** `padding:6px 0` — a label at 13px against a mono figure at 13.5px. */
@Composable
private fun DrawerRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(label, fontSize = 13.sp, color = Handoff.Muted2, modifier = Modifier.weight(1f))
        Text(
            value,
            fontFamily = PlexMono,
            fontSize = 13.5.sp,
            color = Handoff.InkStrong,
        )
    }
}

/**
 * The per-method bar colours.
 *
 * Keeping them distinct matters more than keeping them on-brand — the bars
 * exist to be told apart at a glance, which is the one place on this till
 * where four hues earn their keep.
 *
 * They are the back office's own `--chart-2/3/5` now, rather than four hexes
 * invented here. Two reasons. The same payment method should be the same
 * colour whichever screen the shop is looking at; and Juice was #F0806B,
 * which is the retired brand coral to within a couple of points — the one
 * colour deliberately removed from the entire app, still sitting on the
 * end-of-day screen next to the new crimson and reading as something left
 * behind.
 */
private fun methodColor(method: String): Color = when (method) {
    "cash" -> Handoff.AccentSolid
    "card" -> Color(0xFF00A4AC)
    "juice" -> Color(0xFFD48C3A)
    "myt", "myt_money" -> Color(0xFF7974C5)
    "bank" -> Color(0xFF2E5F8A)
    "credit" -> Color(0xFF8A5A12)
    else -> Handoff.Muted4
}
