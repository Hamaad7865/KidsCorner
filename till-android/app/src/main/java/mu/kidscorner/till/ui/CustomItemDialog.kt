package mu.kidscorner.till.ui

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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
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
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/** `customPresets` — the design's four, with their prices. */
private val PRESETS = listOf(
    "Gift wrap" to 60.0,
    "Alteration · hem" to 150.0,
    "Name embroidery" to 250.0,
    "Shoe care kit" to 180.0,
)

/**
 * `modalCustom` — a 520px card for something the catalogue does not carry.
 *
 * Four presets, a 56px description field, a 62px price well, a `repeat(3,1fr)`
 * pad on 50px rows, and a 60px Add to cart.
 *
 * Both halves are the cashier's word — what it is and what it costs — so a sale
 * carrying one of these will not commit without a manager's PIN. That is
 * decided server-side in `settleDiscounts`, not here.
 */
@Composable
fun CustomItemDialog(
    onAdd: (String, Double) -> Unit,
    onDismiss: () -> Unit,
) {
    var label by remember { mutableStateOf("") }
    var entry by remember { mutableStateOf("") }
    val noRipple = remember { MutableInteractionSource() }

    val price = entry.toDoubleOrNull() ?: 0.0
    val ready = label.trim().length > 1 && price > 0

    Box(
        Modifier
            .fillMaxSize()
            .background(Handoff.Scrim)
            .clickable(interactionSource = noRipple, indication = null, onClick = onDismiss),
        Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = Handoff.Surface,
            modifier = Modifier
                .width(520.dp)
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
                            "Custom item",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.34).sp,
                            color = Handoff.Ink,
                        )
                        Text(
                            "For alterations, gift wrap, or stock without a label.",
                            fontSize = 12.5.sp,
                            color = Handoff.Muted3,
                            modifier = Modifier.padding(top = 3.dp),
                        )
                    }
                    Surface(
                        onClick = onDismiss,
                        shape = RoundedCornerShape(12.dp),
                        color = Handoff.Well,
                        contentColor = Handoff.Muted,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Icon(Icons.Default.Close, "Close", Modifier.size(20.dp))
                        }
                    }
                }

                Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 18.dp)) {
                    // presets, `gap:6px; margin-bottom:12px`
                    PRESETS.chunked(2).forEach { pair ->
                        Row(
                            Modifier.fillMaxWidth().padding(bottom = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            pair.forEach { (name, amount) ->
                                Surface(
                                    onClick = {
                                        label = name
                                        entry = amount.toLong().toString()
                                    },
                                    shape = RoundedCornerShape(11.dp),
                                    color = Handoff.Surface,
                                    contentColor = Handoff.Muted,
                                    border = androidx.compose.foundation.BorderStroke(
                                        1.dp,
                                        Handoff.LineField,
                                    ),
                                    modifier = Modifier.weight(1f).height(46.dp),
                                ) {
                                    Box(
                                        Modifier.fillMaxSize().padding(horizontal = 14.dp),
                                        Alignment.Center,
                                    ) {
                                        Text(
                                            "$name · Rs ${amount.toLong()}",
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                }
                            }
                        }
                    }

                    FieldLabel("Description")
                    Box(Modifier.padding(top = 7.dp, bottom = 13.dp)) {
                        HandoffField(
                            value = label,
                            onValueChange = { if (it.length <= 120) label = it },
                            placeholder = "e.g. Hem trousers",
                        )
                    }

                    FieldLabel("Price")
                    // `height:62px; padding:0 16px; radius:12`
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(top = 7.dp, bottom = 9.dp)
                            .height(62.dp)
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
                            if (entry.isBlank()) "0" else formatAmount(price),
                            fontFamily = PlexMono,
                            fontSize = 28.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.84).sp,
                            color = Handoff.InkFigure,
                        )
                    }

                    HandoffPad(
                        onKey = { entry = entry.appendPadKey(it) },
                        onBackspace = { entry = entry.dropLast(1) },
                        rowHeight = 50.dp,
                        fontSize = 18.sp,
                        radius = 11.dp,
                        gap = 7.dp,
                        modifier = Modifier.padding(bottom = 13.dp),
                    )

                    if (ready) {
                        Surface(
                            onClick = { onAdd(label.trim(), price) },
                            shape = RoundedCornerShape(12.dp),
                            color = Handoff.AccentSolid,
                            contentColor = Color.White,
                            modifier = Modifier.fillMaxWidth().height(60.dp),
                        ) {
                            Box(Modifier.fillMaxSize(), Alignment.Center) {
                                Text(
                                    "Add to cart",
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    } else {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(60.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Handoff.Blocked),
                            Alignment.Center,
                        ) {
                            Text(
                                "Description and price needed",
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
