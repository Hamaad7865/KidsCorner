package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.AppliedDiscountLocal
import mu.kidscorner.till.data.DiscountRule
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/** `BASKET_PRESETS` — the design's own, split by tab. */
private val PCT_PRESETS = listOf(5.0, 10.0, 15.0, 20.0)
private val AMT_PRESETS = listOf(100.0, 250.0, 500.0)

/** `BASKET_REASONS` — the design's six. */
private val BASKET_REASONS = listOf(
    "Back-to-school promo",
    "Staff family",
    "Loyal customer",
    "Damaged packaging",
    "Price match",
    "Manager approval",
)

/**
 * `modalBasket` — a 620px card for money off the whole sale.
 *
 * Two tabs, a 64px well beside a `190px` keypad on 48px rows, preset chips, a
 * reason that prints on the receipt, and a before/after total.
 *
 * ## Where the shop's own rules went
 *
 * v2 draws this as a purely manual discount — a figure and a reason — and drops
 * v1's list of rows from the `discounts` table. That would strand the rules the
 * shop has actually configured, which carry a minimum spend, an expiry and a
 * manager flag the server still enforces.
 *
 * So they are carried in as reason chips, ahead of the design's six. A rule's
 * name IS its reason, the chip row is the design's own and unchanged, and
 * picking one keeps the `discountId` on the sale — which is what the discount
 * report is built from. Picking a plain reason posts a manual discount, which
 * needs a manager either way.
 */
@Composable
fun BasketDiscountDialog(
    basket: Double,
    rules: List<DiscountRule>,
    current: AppliedDiscountLocal?,
    onApply: (AppliedDiscountLocal?) -> Unit,
    onDismiss: () -> Unit,
) {
    var percent by remember { mutableStateOf(true) }
    var entry by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf(current?.label) }
    val noRipple = remember { MutableInteractionSource() }

    val eligible = rules.filter { it.eligibleOn(basket) }
    val pickedRule = eligible.firstOrNull { it.name == reason }

    val typed = entry.toDoubleOrNull() ?: 0.0
    // A rule decides its own figure; a manual discount takes what was typed.
    val cut = round2(
        when {
            pickedRule != null -> pickedRule.previewOn(basket)
            percent -> minOf(basket * typed / 100, basket)
            else -> minOf(typed, basket)
        },
    )
    val canApply = cut > 0 && reason != null

    HandoffDialog(
        title = "Basket discount",
        subtitle = "Applies after line discounts · ${formatRs(basket)} eligible",
        width = 620,
        // The card's natural height, which lands just over the 660 default:
        // the 190px pad is four 48px rows, and the reasons wrap to three.
        maxHeight = 730,
        onDismiss = onDismiss,
    ) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 18.dp)) {
            // ── the two tabs ────────────────────────────────────────
            Row(
                Modifier.fillMaxWidth().padding(bottom = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(true to "Percent off", false to "Rupees off").forEach { (pct, label) ->
                    PickChip(
                        label = label,
                        selected = percent == pct,
                        height = 48,
                        fontSize = 14.sp,
                        modifier = Modifier.weight(1f),
                    ) { percent = pct; entry = "" }
                }
            }

            Row(
                Modifier.fillMaxWidth().padding(bottom = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                Column(
                    Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    // `height:64px; padding:0 16px; radius:12`
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .height(64.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Handoff.FieldWell)
                            .border(1.dp, Handoff.LineField, RoundedCornerShape(12.dp))
                            .padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            if (percent) "% off" else "Rs off",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.Muted4,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            when {
                                pickedRule != null -> formatAmount(cut)
                                entry.isBlank() -> "0"
                                else -> formatAmount(typed)
                            },
                            fontFamily = PlexMono,
                            fontSize = 30.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.9).sp,
                            // Amber: the figure the shop is about to give up,
                            // shown the same way it will be shown on the line
                            // and in the totals once it is applied.
                            color = Handoff.WarnText,
                        )
                    }

                    val presets = if (percent) PCT_PRESETS else AMT_PRESETS
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        presets.forEach { value ->
                            PickChip(
                                label = if (percent) "${value.toInt()}%" else "Rs ${value.toInt()}",
                                selected = typed == value && pickedRule == null,
                                solid = true,
                                height = 46,
                            ) { entry = value.toInt().toString(); reason = reason }
                        }
                    }
                }

                // `width:190px; repeat(3,1fr); grid-auto-rows:48px; gap:6`
                HandoffPad(
                    onKey = { entry = entry.appendPadKey(it) },
                    onBackspace = { entry = entry.dropLast(1) },
                    rowHeight = 48.dp,
                    fontSize = 17.sp,
                    radius = 10.dp,
                    gap = 6.dp,
                    modifier = Modifier.width(190.dp),
                )
            }

            Text(
                "REASON (PRINTS ON THE RECEIPT)",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.1.sp,
                color = Handoff.Muted3,
                modifier = Modifier.padding(bottom = 7.dp),
            )

            // The shop's live rules first, then the design's six.
            val reasons = eligible.map { it.name } + BASKET_REASONS
            reasons.chunked(3).forEach { row ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    row.forEach { option ->
                        val isRule = eligible.any { it.name == option }
                        ReasonPill(
                            label = option,
                            selected = reason == option,
                            rule = isRule,
                            modifier = Modifier.weight(1f),
                        ) { reason = option }
                    }
                    repeat(3 - row.size) { Box(Modifier.weight(1f)) }
                }
            }

            // `padding:12px 14px; background:#FBFDFD; radius:12`
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 7.dp, bottom = 13.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Handoff.FieldWell)
                    .border(1.dp, Handoff.LineIdle, RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "New total",
                    fontSize = 13.sp,
                    color = Handoff.Muted2,
                    modifier = Modifier.weight(1f),
                )
                Row(
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    Text(
                        formatAmount(basket),
                        fontFamily = PlexMono,
                        fontSize = 13.5.sp,
                        color = Handoff.Faint,
                        textDecoration = TextDecoration.LineThrough,
                    )
                    Text(
                        formatAmount(round2(basket - cut)),
                        fontFamily = PlexMono,
                        fontSize = 25.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.75).sp,
                        color = Handoff.InkFigure,
                    )
                }
            }

            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Surface(
                    onClick = { if (current != null) onApply(null) else onDismiss() },
                    shape = RoundedCornerShape(12.dp),
                    color = Handoff.Surface,
                    contentColor = Handoff.InkStrong,
                    border = BorderStroke(1.dp, Handoff.Line),
                    modifier = Modifier.weight(1f).height(58.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Text(
                            if (current != null) "Remove" else "Cancel",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }

                if (canApply) {
                    Surface(
                        onClick = {
                            onApply(
                                AppliedDiscountLocal(
                                    rule = pickedRule,
                                    label = reason!!,
                                    kind = if (pickedRule != null) pickedRule.kind
                                    else if (percent) "percent" else "amount",
                                    value = pickedRule?.value ?: typed,
                                    amount = cut,
                                ),
                            )
                        },
                        shape = RoundedCornerShape(12.dp),
                        // The brand, like every other button that commits what
                        // a sheet was opened to do. Applying a discount is not
                        // a destructive act; refusing to look like one is the
                        // difference between a cashier tapping it and a
                        // cashier calling the manager over.
                        color = Handoff.AccentSolid,
                        contentColor = Color.White,
                        modifier = Modifier.weight(1.6f).height(58.dp),
                    ) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Text(
                                "Apply −${formatRs(cut)}",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                } else {
                    Box(
                        Modifier
                            .weight(1.6f)
                            .height(58.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Handoff.Blocked),
                        Alignment.Center,
                    ) {
                        Text(
                            if (cut <= 0) "Enter an amount" else "Pick a reason",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.BlockedText,
                        )
                    }
                }
            }
        }
    }
}

/**
 * A preset the cashier picks: 5%, 10%, Rs 100. Brand-tinted when picked,
 * solid when the design asks for it.
 *
 * It used to be called DangerChip and drawn in the danger red — every chip in
 * the discount sheet looked like a warning, for what is a routine and
 * deliberate thing to do at a counter. Picking is picking, so it is the accent.
 */
@Composable
private fun PickChip(
    label: String,
    selected: Boolean,
    height: Int,
    modifier: Modifier = Modifier,
    solid: Boolean = false,
    fontSize: androidx.compose.ui.unit.TextUnit = 13.5.sp,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(11.dp),
        color = when {
            selected && solid -> Handoff.AccentSolid
            selected -> Handoff.AccentTint
            else -> Handoff.Surface
        },
        contentColor = when {
            selected && solid -> Color.White
            selected -> Handoff.AccentSolid
            else -> Handoff.InkStrong
        },
        border = BorderStroke(1.dp, if (selected) Handoff.AccentSolid else Handoff.LineField),
        modifier = modifier.height(height.dp),
    ) {
        Box(Modifier.fillMaxHeight().padding(horizontal = 15.dp), Alignment.Center) {
            Text(label, fontSize = fontSize, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/**
 * A reason. Accent-tinted when picked, per the design.
 *
 * A rule-backed one is marked, because the two behave differently: a rule
 * carries its own figure and its own ceiling, and the server recomputes it.
 */
@Composable
private fun ReasonPill(
    label: String,
    selected: Boolean,
    rule: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(11.dp),
        color = if (selected) Handoff.AccentTint else Handoff.Surface,
        contentColor = if (selected) Handoff.AccentText else Handoff.Muted,
        border = BorderStroke(1.dp, if (selected) Handoff.AccentSolid else Handoff.LineField),
        modifier = modifier.height(46.dp),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        ) {
            if (rule) {
                Box(
                    Modifier
                        .size(6.dp)
                        .clip(RoundedCornerShape(50))
                        .background(if (selected) Handoff.AccentSolid else Handoff.Accent),
                )
            }
            Text(
                label,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
