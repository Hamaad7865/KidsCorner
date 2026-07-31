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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Print
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import mu.kidscorner.till.data.SaleSummary
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatQty
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * `modalTxns` — an 820px card over today's sales.
 *
 * A 52px search beside a dark "Reprint last ticket", then rows of `padding:12px
 * 0` with a 104px number column, the customer, the total, and three keys:
 * reprint, gift receipt, return.
 *
 * Reached from Till actions. It is the fast path a counter actually needs —
 * somebody comes back with a receipt and the answer is one of those three
 * things — which is why the design gives it a modal rather than a screen.
 */
@Composable
fun TodaysSalesDialog(
    sales: List<SaleSummary>,
    loading: Boolean,
    onSearch: (String) -> Unit,
    onReprint: (Int) -> Unit,
    onGiftReceipt: (Int) -> Unit,
    onReturn: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val noRipple = remember { MutableInteractionSource() }

    // Debounced, like every other search on this till: a receipt number typed
    // at speed should not fire a request per digit.
    LaunchedEffect(query) {
        delay(300)
        onSearch(query)
    }

    HandoffDialog(
        title = "Today's sales",
        subtitle = "Reprint a ticket, print a gift receipt, or start a return.",
        width = 820,
        maxHeight = 700,
        onDismiss = onDismiss,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Box(Modifier.weight(1f)) {
                HandoffField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = "Receipt number, customer or amount…",
                )
            }
            // `background:#0C2429` — the same near-black as the scan key.
            Surface(
                onClick = { sales.firstOrNull()?.let { onReprint(it.id) } },
                enabled = sales.isNotEmpty(),
                shape = RoundedCornerShape(12.dp),
                color = if (sales.isEmpty()) Handoff.Blocked else Handoff.ScanButton,
                contentColor = if (sales.isEmpty()) Handoff.BlockedText else Handoff.ScanGlyph,
                modifier = Modifier.height(52.dp),
            ) {
                Row(
                    Modifier.fillMaxHeight().padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Default.Print, null, Modifier.size(17.dp))
                    Text(
                        "Reprint last ticket",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                    )
                }
            }
        }

        if (sales.isEmpty()) {
            Box(
                Modifier.fillMaxWidth().height(160.dp).padding(20.dp),
                Alignment.Center,
            ) {
                Text(
                    if (loading) "Looking…" else if (query.isBlank()) {
                        "Nothing rung up yet today."
                    } else {
                        "Nothing matches that."
                    },
                    fontSize = 13.5.sp,
                    color = Handoff.Muted3,
                )
            }
        } else {
            LazyColumn(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 16.dp)) {
                items(sales, key = { it.id }) { sale ->
                    Column {
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(13.dp),
                        ) {
                            Column(Modifier.width(104.dp)) {
                                Text(
                                    sale.saleNo,
                                    fontFamily = PlexMono,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Handoff.InkFigure,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    shortClock(sale.saleDate),
                                    fontSize = 11.5.sp,
                                    color = Handoff.Muted4,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
                            }

                            Column(Modifier.weight(1f)) {
                                Text(
                                    sale.customerName ?: "Walk-in",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    letterSpacing = (-0.14).sp,
                                    color = Handoff.Ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    buildString {
                                        append(formatQty(sale.itemCount))
                                        append(if (sale.itemCount == 1) " item" else " items")
                                        sale.cashierName?.let {
                                            append(" · ${it.substringBefore(' ')}")
                                        }
                                    },
                                    fontSize = 12.sp,
                                    color = Handoff.Muted3,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(top = 3.dp),
                                )
                            }

                            // `completed` is the only status with anything left
                            // to give back: a `refunded` sale is spent, and a
                            // `void` one never took money in the first place.
                            val refunded = sale.status != "completed"
                            if (refunded) {
                                Box(
                                    Modifier
                                        .background(
                                            Handoff.DangerTint,
                                            RoundedCornerShape(6.dp),
                                        )
                                        .border(
                                            1.dp,
                                            Handoff.DangerLine,
                                            RoundedCornerShape(6.dp),
                                        )
                                        .padding(horizontal = 7.dp, vertical = 3.dp),
                                ) {
                                    Text(
                                        "REFUNDED",
                                        fontSize = 10.5.sp,
                                        fontWeight = FontWeight.Bold,
                                        letterSpacing = 0.63.sp,
                                        color = Handoff.Danger,
                                    )
                                }
                            }

                            Text(
                                formatAmount(sale.total),
                                Modifier.width(96.dp),
                                fontFamily = PlexMono,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold,
                                textAlign = TextAlign.End,
                                color = Handoff.InkFigure,
                            )

                            SquareKey(onClick = { onReprint(sale.id) }, size = 48) {
                                Icon(Icons.Default.Print, "Reprint", Modifier.size(17.dp))
                            }
                            SquareKey(onClick = { onGiftReceipt(sale.id) }, size = 48) {
                                Icon(
                                    Icons.Default.CardGiftcard,
                                    "Gift receipt",
                                    Modifier.size(17.dp),
                                )
                            }

                            // A fully refunded sale has nothing left to
                            // give back, so the key goes flat rather
                            // than opening a screen that would refuse.
                            Surface(
                                onClick = { onReturn(sale.id) },
                                enabled = !refunded,
                                shape = RoundedCornerShape(11.dp),
                                color = if (refunded) Handoff.FieldWell else Handoff.DangerTint,
                                contentColor = if (refunded) Handoff.Fainter else Handoff.Danger,
                                border = BorderStroke(
                                    1.dp,
                                    if (refunded) Handoff.LineIdle else Handoff.DangerLine,
                                ),
                                modifier = Modifier.height(48.dp),
                            ) {
                                Box(
                                    Modifier.fillMaxHeight().padding(horizontal = 15.dp),
                                    Alignment.Center,
                                ) {
                                    Text(
                                        "Return",
                                        fontSize = 13.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                    )
                                }
                            }
                        }
                        Box(
                            Modifier.fillMaxWidth().height(1.dp)
                                .background(Handoff.LineFaint),
                        )
                    }
                }
            }
        }
    }
}

/** "14:32" from an ISO stamp. Sliced, like the history list's. */
private fun shortClock(iso: String): String =
    if (iso.length >= 16) iso.substring(11, 16) else iso
