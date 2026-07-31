package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Print
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatQty
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * `atComplete` — the whole screen, not a dialog.
 *
 * `position:absolute; inset:0`, a 620px centred column: an 84px accent disc
 * with a tick, "Sale complete" at 33px, then the change panel with the figure
 * at **60px in IBM Plex Mono**.
 *
 * That size is the design making a judgement, and it is the right one: change
 * is the last thing that happens at a till and the easiest to get wrong. It is
 * the largest thing on any screen in this app.
 *
 * The change panel's colours are the handoff's own — #FFF3F0, #F7D8D0, #A83A28
 * — because it is already warm there. Nothing to translate.
 */
@Composable
fun SaleCompleteScreen(
    saleNo: String?,
    total: Double,
    change: Double,
    itemCount: Int,
    methods: String,
    queued: Boolean,
    onPrint: () -> Unit,
    onPrintGift: () -> Unit,
    onNewSale: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxSize().background(Handoff.Canvas), Alignment.Center) {
        Column(
            Modifier.width(620.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 88px disc.  A cloud-off mark instead of a tick when the sale is
            // only parked — the shape says at a glance which of the two it is.
            Box(
                Modifier
                    .size(84.dp)
                    .clip(CircleShape)
                    .background(if (queued) Handoff.Muted3 else Handoff.AccentSolid),
                Alignment.Center,
            ) {
                Icon(
                    if (queued) Icons.Default.CloudOff else Icons.Default.Check,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(42.dp),
                )
            }

            Spacer(Modifier.height(16.dp))

            Text(
                if (queued) "Saved to send" else "Sale complete",
                fontSize = 33.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-1.02).sp,
                color = Handoff.InkFigure,
            )

            Text(
                // `{{ doneSaleNo }} · {{ doneTotalLabel }} · {{ doneMethods }}`,
                // where the handoff's `rs()` carries the currency.
                buildString {
                    saleNo?.let { append("$it · ") }
                    append(formatRs(total))
                    append(" · ${formatQty(itemCount)} items")
                    if (methods.isNotBlank()) append(" · $methods")
                },
                fontSize = 14.sp,
                color = Handoff.Muted2,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp),
            )

            Spacer(Modifier.height(20.dp))

            if (change > 0) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Handoff.ChangeTint)
                        .border(1.dp, Handoff.ChangeLine, RoundedCornerShape(16.dp))
                        .padding(horizontal = 26.dp, vertical = 20.dp),
                ) {
                    Text(
                        "CHANGE DUE TO CUSTOMER",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.44.sp,
                        color = Handoff.ChangeLabel,
                    )
                    Text(
                        formatRs(change),
                        fontFamily = PlexMono,
                        fontSize = 60.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-2.4).sp,
                        lineHeight = 66.sp,
                        color = Handoff.ChangeFigure,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Handoff.Surface)
                        .border(1.dp, Handoff.LineSoft, RoundedCornerShape(16.dp))
                        .padding(horizontal = 26.dp, vertical = 18.dp),
                ) {
                    Text(
                        if (queued) {
                            "The till could not reach the server, so this sale is held on " +
                                "the tablet and will send itself when the connection is back."
                        } else {
                            "Paid in full — no change due."
                        },
                        fontSize = 13.sp,
                        color = Handoff.Muted2,
                    )
                }
            }

            Spacer(Modifier.height(18.dp))

            // Print is flex:1, Gift receipt flex:1, New sale flex:1.3 — the design weights the
            // continue action slightly larger, because it is the one taken
            // every time and printing is not.
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Surface(
                    onClick = onPrint,
                    enabled = !queued,
                    shape = RoundedCornerShape(14.dp),
                    color = Handoff.Surface,
                    contentColor = Handoff.InkStrong,
                    border = BorderStroke(1.dp, Handoff.Line),
                    modifier = Modifier.weight(1f).height(62.dp),
                ) {
                    Row(
                        Modifier.fillMaxSize(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    ) {
                        Icon(Icons.Default.Print, contentDescription = null, modifier = Modifier.size(19.dp))
                        Text("Print receipt", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    }
                }

                // `printGift` — new in v2. The same receipt with the prices
                // taken off, which is the whole point of it: the recipient can
                // exchange without learning what it cost.
                Surface(
                    onClick = onPrintGift,
                    enabled = !queued,
                    shape = RoundedCornerShape(14.dp),
                    color = Handoff.Surface,
                    contentColor = Handoff.InkStrong,
                    border = BorderStroke(1.dp, Handoff.Line),
                    modifier = Modifier.weight(1f).height(62.dp),
                ) {
                    Row(
                        Modifier.fillMaxSize(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    ) {
                        Icon(Icons.Default.CardGiftcard, contentDescription = null, modifier = Modifier.size(19.dp))
                        Text("Gift receipt", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    }
                }

                Surface(
                    onClick = onNewSale,
                    shape = RoundedCornerShape(14.dp),
                    color = Handoff.AccentSolid,
                    contentColor = Color.White,
                    modifier = Modifier.weight(1.3f).height(62.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Text("New sale", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
