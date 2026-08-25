package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.CatalogVariant
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * `modalVariant` — a size-by-colour MATRIX, not a list.
 *
 * From the handoff: `width:940px; max-height:706px; radius:18px`, a 148px size
 * column down the left and one column per colour across the top, cells 56px
 * high with an 8px gap.
 *
 * That shape is the point. A cashier holding a garment already knows its size
 * and its colour, so a matrix is two glances — down to the size, across to the
 * colour — where a list is a scroll through every combination.
 *
 * A combination with no stock is drawn and disabled rather than omitted. An
 * empty square answers the question the customer actually asked; a missing row
 * just looks like the till does not stock it at all.
 */
@Composable
fun VariantPickerDialog(
    productName: String,
    variants: List<CatalogVariant>,
    onPick: (CatalogVariant) -> Unit,
    onDismiss: () -> Unit,
) {
    val colours = remember(variants) {
        variants.distinctBy { it.colourName }.map { it.colourName to it.colourHex }
    }
    val sizes = remember(variants) {
        variants.distinctBy { it.sizeLabel }.sortedBy { it.sizeSort }.map { it.sizeLabel }
    }
    val cell = remember(variants) { variants.associateBy { it.sizeLabel to it.colourName } }
    val stock = remember(variants) { variants.sumOf { it.qtyOnHand } }
    val noRipple = remember { MutableInteractionSource() }

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
                .width(940.dp)
                .heightIn(max = 706.dp)
                // Swallowed, so a tap inside the card does not dismiss it.
                .clickable(interactionSource = noRipple, indication = null, onClick = {}),
        ) {
            Column {
                // header.  padding:18px 20px 16px
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            productName,
                            fontSize = 19.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.38).sp,
                            color = Handoff.Ink,
                        )
                        Text(
                            "${sizes.size} sizes · ${colours.size} colours · $stock in stock",
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
                Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineSoft))

                Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 6.dp)) {
                    // colour headers, over a 148px gutter that lines up with
                    // the size column below.
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Spacer(Modifier.width(148.dp))
                        colours.forEach { (name, hex) ->
                            Column(
                                Modifier.weight(1f),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(5.dp),
                            ) {
                                ColourSwatch(hex, size = 18)
                                Text(
                                    name,
                                    fontSize = 11.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Handoff.Muted,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }

                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(sizes, key = { it }) { size ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Column(
                                    Modifier.width(148.dp).height(56.dp),
                                    verticalArrangement = Arrangement.Center,
                                ) {
                                    Text(
                                        size,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Handoff.Ink,
                                    )
                                    val available =
                                        colours.count { (cell[size to it.first]?.qtyOnHand ?: 0) > 0 }
                                    Text(
                                        "$available available",
                                        fontSize = 11.sp,
                                        color = Handoff.Muted3,
                                    )
                                }

                                colours.forEach { (colour, _) ->
                                    val variant = cell[size to colour]
                                    val inStock = (variant?.qtyOnHand ?: 0) > 0
                                    Surface(
                                        onClick = { variant?.let(onPick) },
                                        enabled = inStock,
                                        shape = RoundedCornerShape(11.dp),
                                        color = if (inStock) Handoff.Surface else Handoff.Well2,
                                        border = BorderStroke(
                                            1.dp,
                                            // Fainter when there is none left, so the tile recedes
                                            // with its fill rather than keeping a full-strength
                                            // edge around something that cannot be tapped.
                                            if (inStock) Handoff.LineSoft else Handoff.LineFaint,
                                        ),
                                        modifier = Modifier.weight(1f).height(56.dp),
                                    ) {
                                        // A promotion is per VARIANT — two sizes
                                        // of one garment can be marked down apart —
                                        // so the marker lives on the cell: the
                                        // price turns brand red and what it
                                        // replaced sits struck through after it.
                                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                                            if (variant == null) {
                                                Text("—", fontSize = 13.sp, color = Handoff.Ghost)
                                            } else {
                                                Column(
                                                    horizontalAlignment = Alignment.CenterHorizontally,
                                                ) {
                                                    Row(
                                                        verticalAlignment = Alignment.CenterVertically,
                                                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                                                    ) {
                                                        Text(
                                                            formatAmount(variant.price),
                                                            fontFamily = PlexMono,
                                                            fontSize = 13.5.sp,
                                                            fontWeight = FontWeight.SemiBold,
                                                            color = when {
                                                                !inStock -> Handoff.Fainter
                                                                variant.onPromotion -> Handoff.Promo
                                                                else -> Handoff.InkFigure
                                                            },
                                                        )
                                                        if (variant.onPromotion && variant.promoWasPrice != null) {
                                                            Text(
                                                                formatAmount(variant.promoWasPrice),
                                                                fontFamily = PlexMono,
                                                                fontSize = 9.5.sp,
                                                                color = Handoff.Faint,
                                                                textDecoration = TextDecoration.LineThrough,
                                                            )
                                                        }
                                                    }
                                                    Text(
                                                        if (inStock) "${variant.qtyOnHand} left" else "none",
                                                        fontSize = 10.5.sp,
                                                        color = if (inStock) Handoff.Muted4
                                                        else Handoff.Fainter,
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
