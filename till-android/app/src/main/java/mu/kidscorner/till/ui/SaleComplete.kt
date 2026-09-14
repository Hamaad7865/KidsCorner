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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
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
import mu.kidscorner.till.data.formatQty
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono
import mu.kidscorner.till.ui.theme.Success

/**
 * `atComplete` — the whole screen, not a dialog.
 *
 * Two columns: the confirmation on the left (what happened, what to do
 * next), the slip that just came off the printer on the right, where the
 * cashier and the customer are both already looking. A till with no printer
 * still shows what the receipt said.
 *
 * The change figure stays the largest thing on any screen in this app: change
 * is the last thing that happens at a till and the easiest to get wrong.
 */
@Composable
fun SaleCompleteScreen(
    saleNo: String?,
    total: Double,
    change: Double,
    itemCount: Int,
    methods: String,
    customerName: String = "Walk-in",
    queued: Boolean,
    /**
     * What just came off the printer. Online this is the final `S...` receipt;
     * offline it is the provisional `OFF-...` paper (reprintable while queued,
     * final follows on sync). Null only while the paper is still on its way.
     */
    receiptPreview: String?,
    onPrint: () -> Unit,
    /** Opens the refund flow for this sale. Absent on a parked sale. */
    onVoid: (() -> Unit)? = null,
    onNewSale: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxSize().background(Handoff.Canvas), Alignment.Center) {
        Row(
            Modifier
                .width(1020.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Color.White)
                .border(1.dp, Handoff.LineSoft, RoundedCornerShape(20.dp))
                .padding(28.dp),
            horizontalArrangement = Arrangement.spacedBy(28.dp),
        ) {
            // ── the confirmation ────────────────────────────────────────
            Column(Modifier.weight(1.15f)) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        if (queued) "Saved to send" else "Sale complete",
                        fontSize = 26.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.5).sp,
                        color = Handoff.InkFigure,
                    )
                    Surface(
                        onClick = onNewSale,
                        shape = RoundedCornerShape(12.dp),
                        color = Color.Transparent,
                        contentColor = Handoff.Muted2,
                        border = BorderStroke(1.dp, Handoff.LineSoft),
                    ) {
                        Row(
                            Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(Icons.Default.ArrowBack, contentDescription = null, Modifier.size(15.dp))
                            Text("Back to POS", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }

                Text(
                    buildString {
                        if (saleNo != null) {
                            append(if (queued) "Provisional $saleNo · " else "Invoice $saleNo · ")
                        }
                        append("${formatQty(itemCount)} items · ")
                        append(if (methods.isNotBlank()) "paid in $methods" else "paid")
                    },
                    fontSize = 13.5.sp,
                    color = Handoff.Muted2,
                    modifier = Modifier.padding(top = 6.dp),
                )

                Row(
                    Modifier.padding(top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Box(
                        Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(if (queued) Handoff.ChangeFigure else Success),
                    )
                    Text(
                        if (queued) "SAVED — WILL SEND ITSELF" else "PAYMENT CONFIRMED",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.2.sp,
                        color = if (queued) Handoff.ChangeFigure else Success,
                    )
                }

                Text(
                    formatRs(total),
                    fontFamily = PlexMono,
                    fontSize = 54.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-2).sp,
                    lineHeight = 60.sp,
                    color = Handoff.InkFigure,
                    modifier = Modifier.padding(top = 10.dp),
                )

                Text(
                    if (queued) {
                        "Provisional receipt printed — final invoice follows when sent." +
                            if (change > 0) " Change ${formatRs(change)} due now." else ""
                    } else if (change > 0) {
                        "received from $customerName · change ${formatRs(change)}"
                    } else {
                        "received from $customerName · no change due"
                    },
                    fontSize = 13.5.sp,
                    color = Handoff.Muted2,
                    modifier = Modifier.padding(top = 6.dp),
                )

                if (change > 0) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(top = 14.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(Handoff.ChangeTint)
                            .border(1.dp, Handoff.ChangeLine, RoundedCornerShape(14.dp))
                            .padding(horizontal = 20.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            "CHANGE DUE",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.2.sp,
                            color = Handoff.ChangeLabel,
                        )
                        Text(
                            formatRs(change),
                            fontFamily = PlexMono,
                            fontSize = 30.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.ChangeFigure,
                        )
                    }
                }

                Spacer(Modifier.height(18.dp))

                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Surface(
                        onClick = onPrint,
                        enabled = receiptPreview != null,
                        shape = RoundedCornerShape(14.dp),
                        color = Handoff.AccentSolid,
                        contentColor = Color.White,
                        modifier = Modifier.weight(1f).height(58.dp),
                    ) {
                        Row(
                            Modifier.fillMaxSize(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                        ) {
                            Icon(Icons.Default.Print, contentDescription = null, Modifier.size(18.dp))
                            Text("Print again", fontSize = 15.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (onVoid != null) {
                        Surface(
                            onClick = onVoid,
                            shape = RoundedCornerShape(14.dp),
                            color = Color.Transparent,
                            contentColor = Handoff.Danger,
                            border = BorderStroke(1.dp, Handoff.DangerLine),
                            modifier = Modifier.weight(1f).height(58.dp),
                        ) {
                            Box(Modifier.fillMaxSize(), Alignment.Center) {
                                Text(
                                    "Void — refund & restock",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    textAlign = TextAlign.Center,
                                )
                            }
                        }
                    }
                }

                Spacer(Modifier.height(14.dp))

                // The next customer is already waiting: one tap clears this
                // screen back to an empty basket.
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Handoff.FieldWell)
                        .border(1.dp, Handoff.LineSoft, RoundedCornerShape(14.dp))
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(Handoff.AccentTint),
                        Alignment.Center,
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, tint = Handoff.AccentSolid)
                    }
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(
                            "New sale ready",
                            fontSize = 14.5.sp,
                            fontWeight = FontWeight.Bold,
                            color = Handoff.Ink,
                        )
                        Text(
                            "Counter is clear — start the next customer",
                            fontSize = 12.5.sp,
                            color = Handoff.Muted2,
                        )
                    }
                    Surface(
                        onClick = onNewSale,
                        shape = RoundedCornerShape(12.dp),
                        color = Handoff.ScanButton,
                        contentColor = Color.White,
                        modifier = Modifier.height(48.dp),
                    ) {
                        Box(Modifier.padding(horizontal = 22.dp), Alignment.Center) {
                            Text("Start →", fontSize = 14.5.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // ── the slip ────────────────────────────────────────────────
            Column(Modifier.weight(1f)) {
                if (receiptPreview != null) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(max = 560.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color.White)
                            .border(1.dp, Handoff.LineSoft, RoundedCornerShape(12.dp))
                            .verticalScroll(rememberScrollState())
                            .padding(16.dp),
                        contentAlignment = Alignment.TopCenter,
                    ) {
                        Text(
                            receiptPreview,
                            fontFamily = PlexMono,
                            fontSize = 11.5.sp,
                            lineHeight = 15.5.sp,
                            color = Handoff.Ink,
                        )
                    }
                } else {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(220.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Handoff.FieldWell)
                            .border(1.dp, Handoff.LineSoft, RoundedCornerShape(12.dp))
                            .padding(16.dp),
                        Alignment.Center,
                    ) {
                        Text(
                            if (queued) {
                                "Provisional receipt is on its way to the preview — final invoice prints from Past sales once this sends."
                            } else {
                                "The receipt is on its way to the preview."
                            },
                            fontSize = 13.sp,
                            color = Handoff.Muted2,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
            }
        }
    }
}
