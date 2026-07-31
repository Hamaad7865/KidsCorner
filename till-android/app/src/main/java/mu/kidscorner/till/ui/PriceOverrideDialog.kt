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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.CartLine
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * `modalOverride` — a 480px card for setting one line's unit price.
 *
 * `padding:17px 20px 12px` header over a `height:66px` well, the note, a
 * `repeat(3,1fr)` pad on `54px` rows, and a two-key footer at 56px.
 *
 * The note names the list price and says the override is logged against the
 * cashier, which is the design's own wording and is true here: the difference
 * becomes the line's discount, and `settleDiscounts` will not commit a sale
 * carrying one without a manager's PIN.
 *
 * A price above the list is refused, with the reason on screen rather than a
 * dead key. The schema has nowhere to record a negative discount, so accepting
 * it would quote one figure and charge another.
 */
@Composable
fun PriceOverrideDialog(
    line: CartLine,
    onApply: (Double?) -> Unit,
    onDismiss: () -> Unit,
) {
    var entry by remember(line.variantId) { mutableStateOf("") }
    val noRipple = remember { MutableInteractionSource() }

    val typed = entry.toDoubleOrNull()
    val current = line.priceOverride ?: line.unitPrice
    val tooHigh = typed != null && typed > line.unitPrice
    val canApply = typed != null && typed > 0 && !tooHigh

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0x70091C20))
            .clickable(interactionSource = noRipple, indication = null, onClick = onDismiss),
        Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = Handoff.Surface,
            modifier = Modifier
                .width(480.dp)
                .clickable(interactionSource = noRipple, indication = null, onClick = {}),
        ) {
            Column {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 20.dp, top = 17.dp, bottom = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Set unit price",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.34).sp,
                            color = Handoff.Ink,
                        )
                        Text(
                            "${line.productName} · ${line.variantLabel.ifBlank { line.sku }}",
                            fontSize = 12.5.sp,
                            color = Handoff.Muted3,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 3.dp),
                        )
                    }
                    Surface(
                        onClick = onDismiss,
                        shape = RoundedCornerShape(12.dp),
                        color = Color(0xFFF5F8F8),
                        contentColor = Handoff.Muted,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Icon(Icons.Default.Close, "Close", Modifier.size(20.dp))
                        }
                    }
                }

                Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 18.dp)) {
                    // `height:66px; padding:0 16px; radius:12`
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .height(66.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Handoff.FieldWell)
                            .border(1.dp, Handoff.LineField, RoundedCornerShape(12.dp))
                            .padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Rs",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.Muted4,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            if (entry.isBlank()) formatAmount(current) else formatAmount(typed ?: 0.0),
                            fontFamily = PlexMono,
                            fontSize = 32.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.96).sp,
                            color = if (tooHigh) Handoff.Danger else Handoff.InkFigure,
                        )
                    }

                    Text(
                        if (tooHigh) {
                            "Above the list price of ${formatRs(line.unitPrice)} — the back " +
                                "office sets prices, not the till."
                        } else {
                            buildString {
                                append("List price ${formatRs(line.unitPrice)}")
                                line.priceOverride?.let { append(" · currently ${formatRs(it)}") }
                                append(" · needs a manager's PIN at payment")
                            }
                        },
                        fontSize = 12.sp,
                        color = if (tooHigh) Handoff.Danger else Handoff.Muted4,
                        modifier = Modifier.padding(top = 9.dp, bottom = 10.dp),
                    )

                    HandoffPad(
                        onKey = { entry = entry.appendPadKey(it) },
                        onBackspace = { entry = entry.dropLast(1) },
                        rowHeight = 54.dp,
                        fontSize = 19.sp,
                        radius = 11.dp,
                        gap = 7.dp,
                        modifier = Modifier.padding(bottom = 13.dp),
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        Surface(
                            onClick = { onApply(null) },
                            shape = RoundedCornerShape(12.dp),
                            color = Handoff.Surface,
                            contentColor = Handoff.InkStrong,
                            border = BorderStroke(1.dp, Handoff.Line),
                            modifier = Modifier.weight(1f).height(56.dp),
                        ) {
                            Box(Modifier.fillMaxSize(), Alignment.Center) {
                                Text(
                                    "Reset to list price",
                                    fontSize = 14.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }

                        if (canApply) {
                            Surface(
                                onClick = { onApply(typed) },
                                shape = RoundedCornerShape(12.dp),
                                color = Handoff.AccentSolid,
                                contentColor = Color.White,
                                modifier = Modifier.weight(1.2f).height(56.dp),
                            ) {
                                Box(Modifier.fillMaxSize(), Alignment.Center) {
                                    Text(
                                        "Set price",
                                        fontSize = 15.5.sp,
                                        fontWeight = FontWeight.Bold,
                                    )
                                }
                            }
                        } else {
                            Box(
                                Modifier
                                    .weight(1.2f)
                                    .height(56.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(Handoff.Blocked),
                                Alignment.Center,
                            ) {
                                Text(
                                    "Set price",
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
    }
}
