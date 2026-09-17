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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import mu.kidscorner.till.data.ProductPatchRequest
import mu.kidscorner.till.data.TillProductDetail
import mu.kidscorner.till.data.TillProductRow
import mu.kidscorner.till.data.TillProductVariant
import mu.kidscorner.till.data.VariantPatchRequest
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * Product management on the tablet.
 *
 * Two screens, one file: the browser (search by name or code) and the detail
 * (header, barcode actions, one card per variant). Everything the counter
 * does to a product lives here; the desk jobs — new products, size×colour
 * generation, photographs, promotions — stay on the web.
 */

// ── the browser ─────────────────────────────────────────────────────────────

@Composable
fun ProductsScreen(
    query: String,
    rows: List<TillProductRow>,
    loading: Boolean,
    hasMore: Boolean,
    error: String?,
    online: Boolean,
    cashierName: String,
    onQuery: (String) -> Unit,
    onOpen: (Int) -> Unit,
    onBack: () -> Unit,
    onDismissError: () -> Unit,
) {
    TillGround {
        Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Surface(
                    onClick = onBack,
                    shape = RoundedCornerShape(12.dp),
                    color = Handoff.Well,
                    contentColor = Handoff.Muted,
                    modifier = Modifier.size(44.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", Modifier.size(20.dp))
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        "Products",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.36).sp,
                        color = Handoff.Ink,
                    )
                    Text(
                        "$cashierName · prices, barcodes, labels",
                        fontSize = 12.sp,
                        color = Handoff.Muted3,
                    )
                }
                if (!online) {
                    Text("Offline", fontSize = 12.sp, color = Handoff.WarnText)
                }
            }

            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                ProductSearchField(query, onQuery)
            }

            when {
                loading && rows.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text("Loading…", color = Handoff.Muted3)
                }
                rows.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.Inventory2, null,
                            tint = Handoff.Faint, modifier = Modifier.size(40.dp),
                        )
                        Text(
                            if (query.isBlank()) "Nothing here yet" else "No matches",
                            fontSize = 15.sp, color = Handoff.Muted,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                        Text(
                            "New products are created in the back office",
                            fontSize = 12.5.sp, color = Handoff.Muted3,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
                else -> LazyColumn(
                    Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    items(rows, key = { it.id }) { row ->
                        ProductRow(row) { onOpen(row.id) }
                    }
                    if (hasMore) {
                        item(key = "more") {
                            Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), Alignment.Center) {
                                Text(
                                    "Showing the first ${rows.size} — narrow the search to see more.",
                                    fontSize = 12.sp, color = Handoff.Muted3,
                                )
                            }
                        }
                    }
                    if (loading) {
                        item(key = "loading") {
                            Box(Modifier.fillMaxWidth().height(44.dp), Alignment.Center) {
                                CircularProgressIndicator(Modifier.size(20.dp), Handoff.AccentSolid, 2.dp)
                            }
                        }
                    }
                }
            }
        }

        error?.let { message ->
            ProductErrorBar(message, Modifier.align(Alignment.BottomStart), onDismissError)
        }
        }
    }
}

@Composable
private fun ProductSearchField(value: String, onValueChange: (String) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Handoff.Well2)
            .border(1.dp, Handoff.LineField, RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Default.Search, null, tint = Handoff.Muted4, modifier = Modifier.size(19.dp))
        androidx.compose.foundation.text.BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = androidx.compose.material3.LocalTextStyle.current.copy(
                fontSize = 15.5.sp,
                color = Handoff.Ink,
            ),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(Handoff.Accent),
            modifier = Modifier.weight(1f),
            decorationBox = { inner ->
                if (value.isEmpty()) {
                    Text("Search name or product code…", fontSize = 15.5.sp, color = Handoff.Muted3)
                }
                inner()
            },
        )
        if (value.isNotEmpty()) {
            Surface(
                onClick = { onValueChange("") },
                shape = RoundedCornerShape(8.dp),
                color = Color.Transparent,
                contentColor = Handoff.Muted4,
                modifier = Modifier.size(32.dp),
            ) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Icon(Icons.Default.Close, "Clear search", Modifier.size(16.dp))
                }
            }
        }
    }
}

@Composable
private fun ProductRow(row: TillProductRow, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        color = Handoff.Surface,
        contentColor = Handoff.Ink,
        border = BorderStroke(1.dp, Handoff.LineSoft),
        shadowElevation = 2.dp,
        modifier = Modifier.fillMaxWidth().alpha(if (row.isActive) 1f else 0.55f),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 15.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            ProductThumb(name = row.name, url = row.imageUrl, size = 48)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        row.name,
                        fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.145).sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (!row.isActive) MiniChip("OFF", Handoff.Well, Handoff.Muted)
                }
                Text(
                    listOfNotNull(row.productCode, row.categoryName).joinToString(" · ").ifBlank { "—" },
                    fontSize = 12.sp, color = Handoff.Muted3,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (row.barcodelessCount > 0) {
                    Text(
                        "${row.barcodelessCount} variant${if (row.barcodelessCount == 1) "" else "s"} need${if (row.barcodelessCount == 1) "s" else ""} a code",
                        fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = Handoff.WarnText,
                    )
                }
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    row.priceText ?: "—",
                    fontFamily = PlexMono,
                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Ink,
                )
                Text(
                    "${row.totalStock} on hand",
                    fontSize = 11.5.sp, color = Handoff.Muted3,
                )
            }
        }
    }
}

@Composable
private fun ProductThumb(name: String, url: String?, size: Int) {
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier
            .size(size.dp)
            .clip(shape)
            .background(Handoff.Well)
            .border(1.dp, Handoff.LineSoft, shape),
        Alignment.Center,
    ) {
        if (url != null) {
            AsyncImage(
                model = url,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                initialsOf(name),
                fontSize = (size * 0.3f).sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.Fainter,
            )
        }
    }
}

@Composable
private fun MiniChip(text: String, tint: Color, ink: Color) {
    Surface(shape = RoundedCornerShape(7.dp), color = tint) {
        Text(
            text,
            fontSize = 9.5.sp, fontWeight = FontWeight.Bold,
            color = ink,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun ProductErrorBar(message: String, modifier: Modifier = Modifier, onDismiss: () -> Unit) {
    val noRipple = remember { MutableInteractionSource() }
    Box(
        modifier
            .fillMaxWidth()
            .padding(16.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Handoff.DangerTint)
            .border(1.dp, Handoff.DangerLine, RoundedCornerShape(12.dp))
            .clickable(interactionSource = noRipple, indication = null, onClick = onDismiss)
            .padding(horizontal = 14.dp, vertical = 11.dp),
    ) {
        Text(message, fontSize = 13.sp, color = Handoff.Danger)
    }
}

// ── the detail ──────────────────────────────────────────────────────────────

@Composable
fun ProductDetailScreen(
    product: TillProductDetail?,
    loading: Boolean,
    error: String?,
    saving: Boolean,
    canSeeCost: Boolean,
    labelPrinterLine: String,
    onBack: () -> Unit,
    onSaveVariant: (VariantPatchRequest) -> Unit,
    onSaveProduct: (ProductPatchRequest) -> Unit,
    onGenerate: (List<Int>) -> Unit,
    onPrintLabel: (TillProductVariant, Int) -> Unit,
    onDismissError: () -> Unit,
) {
    var editingVariant by remember { mutableStateOf<TillProductVariant?>(null) }
    var editingProduct by remember { mutableStateOf(false) }
    var printingVariant by remember { mutableStateOf<TillProductVariant?>(null) }

    Box(Modifier.fillMaxSize().background(Handoff.PinGround)) {
        // A brand wash behind the header — the screen sits on a tinted ground
        // with white cards floating on it, instead of white on white.
        Box(
            Modifier
                .fillMaxWidth()
                .height(300.dp)
                .background(
                    androidx.compose.ui.graphics.Brush.verticalGradient(
                        listOf(Handoff.AccentTint, Color.Transparent),
                    ),
                ),
        )
        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Surface(
                    onClick = onBack,
                    shape = RoundedCornerShape(12.dp),
                    color = Handoff.Well,
                    contentColor = Handoff.Muted,
                    modifier = Modifier.size(44.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to products", Modifier.size(20.dp))
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        product?.name ?: "Product",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.36).sp,
                        color = Handoff.Ink,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        product?.let {
                            listOfNotNull(it.productCode, it.categoryName).joinToString(" · ")
                        } ?: "Loading…",
                        fontSize = 12.sp,
                        color = Handoff.Muted3,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                if (product != null && !loading) {
                    Surface(
                        onClick = { editingProduct = true },
                        shape = RoundedCornerShape(11.dp),
                        color = Handoff.Surface,
                        contentColor = Handoff.InkStrong,
                        border = BorderStroke(1.dp, Handoff.Line),
                        modifier = Modifier.height(44.dp),
                    ) {
                        Row(
                            Modifier.fillMaxHeight().padding(horizontal = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                        ) {
                            Icon(Icons.Default.Edit, null, Modifier.size(16.dp))
                            Text("Edit", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }

            when {
                loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text("Loading…", color = Handoff.Muted3)
                }
                product == null -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Text(error ?: "Product could not be loaded.", color = Handoff.Muted)
                }
                else -> Column(
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ProductHeroCard(product)

                    // ── barcodes & labels ────────────────────────────────
                    DarkCard(
                        icon = Icons.Default.QrCodeScanner,
                        title = "Barcodes & labels",
                        subtitle = "Prints to $labelPrinterLine",
                    ) {
                            val missing = product.barcodeless.size
                            if (missing == 0) {
                                Row(
                                    Modifier.padding(top = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Box(
                                        Modifier
                                            .size(8.dp)
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(Color(0xFF4CC38A)),
                                    )
                                    Text(
                                        "Every variant has a scannable code.",
                                        fontSize = 13.5.sp, color = Handoff.ToastInk,
                                    )
                                }
                            } else {
                                Text(
                                    "$missing variant${if (missing == 1) "" else "s"} need${if (missing == 1) "s" else ""} a code. A valid code on a printed sticker is never overwritten.",
                                    fontSize = 13.sp, color = Handoff.ToastInk,
                                    modifier = Modifier.padding(top = 8.dp),
                                )
                                Row(
                                    Modifier.padding(top = 12.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    HandoffButton(
                                        label = if (saving) "Working…" else "Generate missing",
                                        enabled = !saving,
                                        modifier = Modifier.weight(1f),
                                    ) { onGenerate(product.barcodeless.map { it.id }) }
                                }
                            }
                    }

                    // ── variants ─────────────────────────────────────────
                    Text(
                        "VARIANTS · ${product.variants.size}",
                        fontSize = 10.5.sp, fontWeight = FontWeight.Bold,
                        letterSpacing = 1.1.sp, color = Handoff.Muted4,
                        modifier = Modifier.padding(start = 4.dp, top = 4.dp),
                    )
                    product.variants.forEach { variant ->
                        VariantCard(
                            variant = variant,
                            saving = saving,
                            onEdit = { editingVariant = variant },
                            onPrint = { printingVariant = variant },
                        )
                    }
                    Spacer(Modifier.height(60.dp))
                }
            }
        }

        error?.let { message ->
            ProductErrorBar(message, Modifier.align(Alignment.BottomStart), onDismissError)
        }
    }

    editingVariant?.let { variant ->
        // The card holds the row as it was opened; the screen's copy is the
        // truth after a save, and the dialog closes on save anyway.
        VariantEditDialog(
            variant = variant,
            saving = saving,
            canSeeCost = canSeeCost,
            onSave = { onSaveVariant(it); editingVariant = null },
            onDismiss = { editingVariant = null },
        )
    }

    if (editingProduct && product != null) {
        ProductEditDialog(
            product = product,
            saving = saving,
            onSave = { onSaveProduct(it); editingProduct = false },
            onDismiss = { editingProduct = false },
        )
    }

    printingVariant?.let { variant ->
        PrintLabelDialog(
            variant = variant,
            productName = product?.name ?: "",
            labelPrinterLine = labelPrinterLine,
            saving = saving,
            onPrint = { copies -> onPrintLabel(variant, copies); printingVariant = null },
            onDismiss = { printingVariant = null },
        )
    }
}

@Composable
private fun ProductHeroCard(product: TillProductDetail) {
    val live = product.variants.filter { it.isActive }
    val prices = live.map { it.sellingPrice }
    val priceText = when {
        prices.isEmpty() -> "—"
        prices.min() == prices.max() -> formatRs(prices.min())
        else -> "${formatRs(prices.min())} – ${formatRs(prices.max())}"
    }
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = Handoff.Surface,
        border = BorderStroke(1.dp, Handoff.LineSoft),
        shadowElevation = 3.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ProductThumb(name = product.name, url = product.imageUrl, size = 84)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            product.name,
                            fontSize = 19.sp, fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.38).sp, color = Handoff.Ink,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (!product.isActive) MiniChip("OFF", Handoff.Well, Handoff.Muted)
                    }
                    Text(
                        listOfNotNull(product.brandName, product.shelfLocation?.let { "Shelf $it" })
                            .joinToString(" · ").ifBlank { "—" },
                        fontSize = 13.sp, color = Handoff.Muted3,
                    )
                    // The colour story at a glance — up to six, like the tiles.
                    val dots = live.mapNotNull { parseHex(it.colourHex) }.distinct().take(6)
                    if (dots.isNotEmpty()) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(top = 4.dp),
                        ) {
                            dots.forEach { dot ->
                                Box(
                                    Modifier
                                        .size(18.dp)
                                        .clip(RoundedCornerShape(7.dp))
                                        .background(dot)
                                        .border(1.dp, Handoff.LineSoft, RoundedCornerShape(7.dp)),
                                )
                            }
                        }
                    }
                }
            }
            // The figures on their own band, so the eye finds them first.
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Handoff.Well)
                    .padding(vertical = 10.dp),
            ) {
                HeroStat(value = product.totalStock.toString(), label = "ON HAND", modifier = Modifier.weight(1f))
                Box(Modifier.width(1.dp).height(32.dp).background(Handoff.LineSoft).align(Alignment.CenterVertically))
                HeroStat(value = live.size.toString(), label = "VARIANTS", modifier = Modifier.weight(1f))
                Box(Modifier.width(1.dp).height(32.dp).background(Handoff.LineSoft).align(Alignment.CenterVertically))
                HeroStat(value = priceText, label = "PRICE", modifier = Modifier.weight(1f), mono = true)
            }
        }
    }
}

@Composable
private fun VariantCard(
    variant: TillProductVariant,
    saving: Boolean,
    onEdit: () -> Unit,
    onPrint: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = Handoff.Surface,
        border = BorderStroke(1.dp, Handoff.LineSoft),
        shadowElevation = 2.dp,
        modifier = Modifier.fillMaxWidth().alpha(if (variant.isActive) 1f else 0.6f),
    ) {
        // The garment's own colour as a spine — the card is found by colour
        // before it is read, the way a rail is shopped.
        Row(Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min)) {
            Box(
                Modifier
                    .width(6.dp)
                    .fillMaxHeight()
                    .background(parseHex(variant.colourHex) ?: Handoff.AccentTint),
            )
            Column(
                Modifier.weight(1f).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!variant.colourHex.isNullOrBlank()) {
                    ColourSwatch(variant.colourHex, size = 22)
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        variant.variantLabel.ifBlank { variant.sku },
                        fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.15).sp, color = Handoff.Ink,
                    )
                    Text(
                        "SKU ${variant.sku}",
                        fontFamily = PlexMono, fontSize = 11.5.sp, color = Handoff.Muted3,
                    )
                }
                if (!variant.isActive) MiniChip("OFF", Handoff.Well, Handoff.Muted)
            }

            // Price and stock on their own band, barcode docked right.
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(11.dp))
                    .background(Handoff.Well)
                    .padding(horizontal = 12.dp, vertical = 9.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(
                        formatRs(variant.sellingPrice),
                        fontFamily = PlexMono,
                        fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = Handoff.InkFigure,
                    )
                    Text(
                        "${variant.qtyOnHand} on hand · reorder at ${variant.reorderLevel}",
                        fontSize = 11.5.sp, color = Handoff.Muted3,
                    )
                }
                BarcodeChip(variant)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Surface(
                    onClick = onEdit,
                    enabled = !saving,
                    shape = RoundedCornerShape(11.dp),
                    color = Handoff.Surface,
                    contentColor = Handoff.InkStrong,
                    border = BorderStroke(1.dp, Handoff.Line),
                    modifier = Modifier.weight(1f).height(48.dp),
                ) {
                    Row(
                        Modifier.fillMaxSize(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(7.dp, Alignment.CenterHorizontally),
                    ) {
                        Icon(Icons.Default.Edit, null, Modifier.size(16.dp))
                        Text("Edit", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
                Surface(
                    onClick = onPrint,
                    enabled = !saving && variant.barcodeValid,
                    shape = RoundedCornerShape(11.dp),
                    color = if (variant.barcodeValid) Handoff.ScanButton else Handoff.Blocked,
                    contentColor = if (variant.barcodeValid) Handoff.ScanGlyph else Handoff.BlockedText,
                    modifier = Modifier.weight(1f).height(48.dp),
                ) {
                    Row(
                        Modifier.fillMaxSize(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(7.dp, Alignment.CenterHorizontally),
                    ) {
                        Icon(Icons.Default.Print, null, Modifier.size(16.dp))
                        Text("Labels", fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            }
        }
    }
}

@Composable
private fun BarcodeChip(variant: TillProductVariant) {
    when {
        variant.barcodeValid -> Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Icons.Default.QrCodeScanner, null, tint = Handoff.AccentText, modifier = Modifier.size(15.dp))
            Text(
                variant.barcode ?: "",
                fontFamily = PlexMono, fontSize = 12.sp, color = Handoff.AccentText,
            )
        }
        variant.barcode.isNullOrBlank() -> MiniChip("NO BARCODE", Handoff.WarnTint, Handoff.WarnText)
        else -> MiniChip("INVALID BARCODE", Handoff.DangerTint, Handoff.Danger)
    }
}

// ── dialogs ─────────────────────────────────────────────────────────────────

@Composable
private fun VariantEditDialog(
    variant: TillProductVariant,
    saving: Boolean,
    canSeeCost: Boolean,
    onSave: (VariantPatchRequest) -> Unit,
    onDismiss: () -> Unit,
) {
    var price by remember { mutableStateOf(trimMoney(variant.sellingPrice)) }
    var cost by remember { mutableStateOf(trimMoney(variant.costPrice)) }
    var reorder by remember { mutableStateOf(variant.reorderLevel.toString()) }
    var barcode by remember { mutableStateOf(variant.barcode ?: "") }
    var active by remember { mutableStateOf(variant.isActive) }

    val priceValue = price.toDoubleOrNull()
    val valid = priceValue != null && priceValue >= 0 &&
        (reorder.toIntOrNull() ?: -1) >= 0 &&
        (!canSeeCost || (cost.toDoubleOrNull() ?: -1.0) >= 0)

    HandoffDialog(
        title = variant.variantLabel.ifBlank { variant.sku },
        subtitle = "SKU ${variant.sku}",
        width = 560,
        onDismiss = onDismiss,
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FieldLabel("Selling price (Rs)")
            HandoffField(
                value = price,
                onValueChange = { price = it.filter { c -> c.isDigit() || c == '.' } },
                placeholder = "0.00",
                keyboard = KeyboardType.Decimal,
                mono = true,
            )
            if (canSeeCost) {
                FieldLabel("Cost price (Rs) · owner/manager only")
                HandoffField(
                    value = cost,
                    onValueChange = { cost = it.filter { c -> c.isDigit() || c == '.' } },
                    placeholder = "0.00",
                    keyboard = KeyboardType.Decimal,
                    mono = true,
                )
            }
            FieldLabel("Reorder level")
            HandoffField(
                value = reorder,
                onValueChange = { reorder = it.filter(Char::isDigit).take(6) },
                placeholder = "0",
                keyboard = KeyboardType.Number,
                mono = true,
            )
            FieldLabel("Barcode")
            HandoffField(
                value = barcode,
                onValueChange = { barcode = it.trim().take(64) },
                placeholder = "Scan or type…",
                keyboard = KeyboardType.Text,
                mono = true,
            )
            Text(
                "Blank clears it. A code already on another variant will be refused, naming the garment.",
                fontSize = 11.5.sp, color = Handoff.Muted3,
            )
            ActiveToggleRow(active = active) { active = it }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HandoffButton(label = "Cancel", primary = false, modifier = Modifier.weight(1f), onClick = onDismiss)
                HandoffButton(
                    label = if (saving) "Saving…" else "Save",
                    enabled = valid && !saving,
                    modifier = Modifier.weight(1f),
                ) {
                    val originalBarcode = variant.barcode ?: ""
                    onSave(
                        VariantPatchRequest(
                            variantId = variant.id,
                            sellingPrice = priceValue ?: 0.0,
                            costPrice = if (canSeeCost) cost.toDoubleOrNull() else null,
                            reorderLevel = reorder.toIntOrNull() ?: 0,
                            barcode = barcode.trim().ifBlank { null },
                            barcodeTouched = barcode.trim() != originalBarcode.trim(),
                            isActive = active,
                        ),
                    )
                }
            }
        }
    }
}

@Composable
private fun ProductEditDialog(
    product: TillProductDetail,
    saving: Boolean,
    onSave: (ProductPatchRequest) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf(product.name) }
    var code by remember { mutableStateOf(product.productCode ?: "") }
    var shelf by remember { mutableStateOf(product.shelfLocation ?: "") }
    var active by remember { mutableStateOf(product.isActive) }

    val valid = name.isNotBlank() && code.isNotBlank()

    HandoffDialog(
        title = "Edit product",
        subtitle = "Name, code, shelf and flag — the rest lives in the back office.",
        width = 560,
        onDismiss = onDismiss,
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FieldLabel("Name")
            HandoffField(value = name, onValueChange = { name = it.take(120) }, placeholder = "Product name")
            FieldLabel("Product code")
            HandoffField(
                value = code,
                onValueChange = { code = it.take(40) },
                placeholder = "PC-1023",
                mono = true,
            )
            FieldLabel("Shelf location")
            HandoffField(
                value = shelf,
                onValueChange = { shelf = it.take(120) },
                placeholder = "A12",
            )
            ActiveToggleRow(active = active) { active = it }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HandoffButton(label = "Cancel", primary = false, modifier = Modifier.weight(1f), onClick = onDismiss)
                HandoffButton(
                    label = if (saving) "Saving…" else "Save",
                    enabled = valid && !saving,
                    modifier = Modifier.weight(1f),
                ) {
                    onSave(
                        ProductPatchRequest(
                            name = name.trim(),
                            productCode = code.trim(),
                            shelfLocation = shelf.trim().ifBlank { null },
                            isActive = active,
                        ),
                    )
                }
            }
        }
    }
}

@Composable
private fun PrintLabelDialog(
    variant: TillProductVariant,
    productName: String,
    labelPrinterLine: String,
    saving: Boolean,
    onPrint: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    var copies by remember { mutableStateOf(1) }

    HandoffDialog(
        title = "Print labels",
        subtitle = "$productName · ${variant.variantLabel}",
        width = 520,
        onDismiss = onDismiss,
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.QrCodeScanner, null, tint = Handoff.Muted3, modifier = Modifier.size(18.dp))
                Text(
                    variant.barcode ?: "",
                    fontFamily = PlexMono, fontSize = 15.sp, color = Handoff.Ink,
                )
            }
            Text(
                formatRs(variant.sellingPrice),
                fontFamily = PlexMono,
                fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Handoff.InkFigure,
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Copies", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Ink)
                Spacer(Modifier.weight(1f))
                StepperKey(Icons.Default.Remove, "Fewer copies", copies > 1) { copies -= 1 }
                Text(
                    copies.toString(),
                    fontFamily = PlexMono,
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Ink,
                    modifier = Modifier.width(36.dp),
                )
                StepperKey(Icons.Default.Add, "More copies", copies < 50) { copies += 1 }
            }
            Text(
                "Prints to $labelPrinterLine.",
                fontSize = 12.sp, color = Handoff.Muted3,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HandoffButton(label = "Cancel", primary = false, modifier = Modifier.weight(1f), onClick = onDismiss)
                HandoffButton(
                    label = if (saving) "Printing…" else if (copies == 1) "Print label" else "Print $copies",
                    enabled = !saving,
                    modifier = Modifier.weight(1f),
                ) { onPrint(copies) }
            }
        }
    }
}

@Composable
private fun StepperKey(icon: androidx.compose.ui.graphics.vector.ImageVector, description: String, enabled: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(10.dp),
        color = Handoff.Surface,
        contentColor = if (enabled) Handoff.Ink else Handoff.Faint,
        border = BorderStroke(1.dp, Handoff.LineField),
        modifier = Modifier.size(44.dp),
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Icon(icon, description, Modifier.size(18.dp))
        }
    }
}

@Composable
private fun ActiveToggleRow(active: Boolean, onChange: (Boolean) -> Unit) {
    val noRipple = remember { MutableInteractionSource() }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (active) Handoff.AccentTint else Handoff.Well)
            .clickable(interactionSource = noRipple, indication = null, onClick = { onChange(!active) })
            .padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            Icons.Default.Check, null,
            tint = if (active) Handoff.AccentText else Handoff.Faint,
            modifier = Modifier.size(18.dp).alpha(if (active) 1f else 0f),
        )
        Column(Modifier.weight(1f)) {
            Text(
                if (active) "Active — sells on the till" else "Inactive — hidden from selling",
                fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold,
                color = if (active) Handoff.AccentText else Handoff.Muted,
            )
        }
    }
}

private fun trimMoney(value: Double): String {
    val rounded = kotlin.math.round(value * 100) / 100
    return if (rounded == kotlin.math.floor(rounded)) {
        rounded.toLong().toString()
    } else {
        rounded.toString()
    }
}
