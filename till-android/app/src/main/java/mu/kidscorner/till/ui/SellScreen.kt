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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.StickyNote2
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import mu.kidscorner.till.data.AppliedDiscountLocal
import mu.kidscorner.till.data.CartLine
import mu.kidscorner.till.data.CartTotals
import mu.kidscorner.till.data.Cashier
import mu.kidscorner.till.data.CatalogVariant
import mu.kidscorner.till.data.Customer
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatPriceRange
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * The sell screen, reproduced from the handoff.
 *
 * `design-handoff/project/Kids Corner POS.dc.html`, the `atSell` block. Every
 * dimension here is the literal value from that file — a 56px search row, a
 * 4-column grid on 136px rows with a 10px gap, 76px result rows, 44px steppers,
 * a 72px pay button. Figures are set in IBM Plex Mono because the design sets
 * them that way, and a column of prices only lines up digit-under-digit if they
 * are monospaced.
 *
 * The one deviation is colour: the handoff is teal, this shop is coral. That
 * mapping lives in `Handoff` and nowhere else.
 *
 * The design is drawn at 1280x800. Nothing here rescales it — the theme scales
 * density for the whole window, so these proportions hold on any panel.
 */

/**
 * A dashed 1px outline.
 *
 * Compose has no dashed border modifier, so it is drawn — the design uses one
 * on the custom-item key and nowhere else, which is the point: that key adds
 * something the catalogue behind it does not contain.
 */
private fun Modifier.dashedBorder(colour: Color, radius: androidx.compose.ui.unit.Dp): Modifier =
    this.drawBehind {
        val r = radius.toPx()
        drawRoundRect(
            color = colour,
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(r, r),
            style = androidx.compose.ui.graphics.drawscope.Stroke(
                width = 1.dp.toPx(),
                pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(
                    floatArrayOf(6.dp.toPx(), 4.dp.toPx()),
                ),
            ),
        )
    }

/** Results rendered before the cashier is asked for a narrower query. */
private const val MAX_RESULTS = 40

/** Products shown per tab before the same. */
private const val MAX_TILES = 60

private data class ProductGroup(
    val productId: Int,
    val productName: String,
    val variants: List<CatalogVariant>,
) {
    val stock: Int get() = variants.sumOf { it.qtyOnHand }
    val minPrice: Double get() = variants.minOf { it.price }
    val maxPrice: Double get() = variants.maxOf { it.price }

    /** Distinct colours, in catalogue order — the swatch row on a tile. */
    val swatches: List<String?>
        get() = variants.map { it.colourHex }.distinct().take(6)

    /** "3-6 mths – 4-5 yrs", or the single size when there is one. */
    val sizes: String
        get() {
            val labels = variants.sortedBy { it.sizeSort }
                .map { it.sizeLabel }.filter { it.isNotBlank() }.distinct()
            return when {
                labels.isEmpty() -> ""
                labels.size == 1 -> labels.first()
                else -> "${labels.first()} – ${labels.last()}"
            }
        }
}

@Composable
fun SellScreen(
    catalog: List<CatalogVariant>,
    lines: List<CartLine>,
    totals: CartTotals,
    cashier: Cashier,
    shopName: String,
    tillOpen: Boolean,
    catalogLoading: Boolean,
    online: Boolean,
    vatRate: Double,
    customer: Customer?,
    discount: AppliedDiscountLocal?,
    heldCount: Int,
    queuedCount: Int,
    onSwitchCashier: () -> Unit,
    onAdd: (CatalogVariant) -> Unit,
    onSetQty: (Int, Int) -> Unit,
    onSetLineDiscount: (Int, String?, Double) -> Unit,
    onOpenPriceOverride: (Int) -> Unit,
    onOpenActions: () -> Unit,
    onOpenCustomItem: () -> Unit,
    onOpenNote: () -> Unit,
    onSetNote: (String) -> Unit,
    note: String,
    onRemove: (Int) -> Unit,
    onClear: () -> Unit,
    onFindBarcode: (String) -> CatalogVariant?,
    onPay: () -> Unit,
    onLock: () -> Unit,
    onHold: () -> Unit,
    onOpenHeld: () -> Unit,
    onOpenCustomer: () -> Unit,
    onDetachCustomer: () -> Unit,
    onOpenDiscount: () -> Unit,
    onRemoveDiscount: () -> Unit,
    onOpenTill: () -> Unit,
    onCloseTill: () -> Unit,
    onOpenMovement: () -> Unit,
    onOpenHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var query by remember { mutableStateOf("") }
    var picker by remember { mutableStateOf<ProductGroup?>(null) }
    var tab by remember { mutableStateOf<Int?>(null) }
    /** The line most recently added, for the design's "Added" badge. */
    var justAdded by remember { mutableStateOf<Int?>(null) }

    val search = remember { FocusRequester() }

    LaunchedEffect(justAdded) {
        if (justAdded != null) { delay(1_600); justAdded = null }
    }

    // The search box is the till's default focus: a barcode scanner acts as a
    // keyboard, so anything typed anywhere has to land here.
    LaunchedEffect(picker, lines.size) {
        if (picker == null) runCatching { search.requestFocus() }
    }

    // `scanHit` — when what has been typed IS a barcode, the design drops the
    // fuzzy matches entirely (`matches = isCode ? [] : …`) and shows one row
    // for the variant that code identifies.
    //
    // A hardware scanner still adds on its own Enter, in `submitSearch`. This
    // row is for the code keyed in by hand, where nobody has pressed anything
    // yet and the cashier wants to see what they are about to add.
    val scanHit = remember(query, catalog) { onFindBarcode(query.trim()) }
    val results = remember(query, catalog, scanHit) {
        if (scanHit != null) emptyList() else groupsFor(query, catalog)
    }
    val tabs = remember(catalog) { tabsFor(catalog) }
    val tiles = remember(tab, catalog) { tilesFor(tab, catalog) }

    fun add(variant: CatalogVariant) {
        onAdd(variant)
        justAdded = variant.id
    }

    fun open(group: ProductGroup) {
        if (group.variants.size == 1) add(group.variants.first()) else picker = group
    }

    fun submitSearch() {
        val raw = query.trim()
        if (raw.isEmpty()) return
        val scanned = onFindBarcode(raw)
        if (scanned != null) { add(scanned); query = ""; return }
        if (results.size == 1) { open(results.first()); query = "" }
    }

    Column(modifier.fillMaxSize().background(Handoff.Canvas)) {
        TillChrome(
            shopName = shopName,
            cashier = cashier,
            online = online,
            queuedCount = queuedCount,
            tillOpen = tillOpen,
            onSwitchCashier = onSwitchCashier,
            onLock = onLock,
            onCloseTill = onCloseTill,
        )

        Row(Modifier.weight(1f).fillMaxWidth()) {
            // ── the catalogue side.  flex:1; padding:14px; gap:12px ────────
            Column(
                Modifier.weight(1f).fillMaxHeight().padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // search row.  gap:10px
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SearchField(
                        value = query,
                        onValueChange = { query = it },
                        onSubmit = ::submitSearch,
                        onClear = { query = "" },
                        focusRequester = search,
                        modifier = Modifier.weight(1f),
                    )
                    ScanButton(onClick = ::submitSearch)

                    // `width:74px;height:56px` — everything the till does that
                    // is not ringing up a sale, kept off the selling surface.
                    Surface(
                        onClick = onOpenActions,
                        shape = RoundedCornerShape(12.dp),
                        color = Handoff.Surface,
                        contentColor = Handoff.InkStrong,
                        border = BorderStroke(1.dp, Handoff.Line),
                        modifier = Modifier.size(width = 74.dp, height = 56.dp),
                    ) {
                        Column(
                            Modifier.fillMaxSize(),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(Icons.Default.MoreHoriz, null, Modifier.size(19.dp))
                            Spacer(Modifier.height(2.dp))
                            Text(
                                "More",
                                fontSize = 10.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                letterSpacing = 0.42.sp,
                            )
                        }
                    }
                }

                if (query.trim().length < 2) {
                    // tab strip.  gap:8px, with the custom-item key pushed to
                    // the far end by the design's own `flex:1` spacer.
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        tabs.forEach { (id, label, count) ->
                            Tab(
                                label = label,
                                count = count,
                                selected = tab == id,
                                onClick = { tab = if (tab == id) null else id },
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        // `border:1px dashed #B6C9CB` — dashed because it adds
                        // something the catalogue does not have.
                        Surface(
                            onClick = onOpenCustomItem,
                            shape = RoundedCornerShape(11.dp),
                            color = Handoff.Surface,
                            contentColor = Handoff.Muted,
                            modifier = Modifier
                                .height(48.dp)
                                .dashedBorder(Handoff.LineStrong, 11.dp),
                        ) {
                            Row(
                                Modifier.fillMaxHeight().padding(horizontal = 15.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(7.dp),
                            ) {
                                Icon(Icons.Default.Add, null, Modifier.size(16.dp))
                                Text(
                                    "Custom item",
                                    fontSize = 13.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }

                when {
                    catalog.isEmpty() -> Centred {
                        Text(
                            if (catalogLoading) "Loading the catalogue…"
                            else "No products on this device yet.",
                            fontSize = 14.sp,
                            color = Handoff.Muted2,
                        )
                    }

                    query.trim().length >= 2 ->
                        if (scanHit != null) {
                            ScanHitRow(scanHit, query.trim()) { add(scanHit); query = "" }
                        } else {
                            ResultRows(results, query.trim(), ::open, ::add)
                        }

                    else -> TileGrid(tiles, ::open)
                }
            }

            // ── the cart side.  width:406px in the handoff ────────────────
            CartPane(
                modifier = Modifier.width(508.dp).fillMaxHeight(),
                lines = lines,
                totals = totals,
                vatRate = vatRate,
                tillOpen = tillOpen,
                customer = customer,
                discount = discount,
                heldCount = heldCount,
                justAdded = justAdded,
                onSetQty = onSetQty,
                onSetLineDiscount = onSetLineDiscount,
                onOpenPriceOverride = onOpenPriceOverride,
                onOpenNote = onOpenNote,
                onSetNote = onSetNote,
                note = note,
                onRemove = onRemove,
                onClear = onClear,
                onPay = onPay,
                onHold = onHold,
                onOpenHeld = onOpenHeld,
                onOpenCustomer = onOpenCustomer,
                onDetachCustomer = onDetachCustomer,
                onOpenDiscount = onOpenDiscount,
                onRemoveDiscount = onRemoveDiscount,
                onOpenTill = onOpenTill,
                onCloseTill = onCloseTill,
                onOpenMovement = onOpenMovement,
                onOpenHistory = onOpenHistory,
            )
        }
    }

    picker?.let { group ->
        VariantPickerDialog(
            productName = group.productName,
            variants = group.variants,
            onPick = { add(it); picker = null },
            onDismiss = { picker = null },
        )
    }
}

// ────────────────────────────────────────────────────────── the search row

/**
 * `height:56px; padding:0 56px 0 46px; radius:12px; border:1px solid #DAE3E4`,
 * and on focus the border becomes the accent with a 3px ring.
 *
 * A BasicTextField rather than an OutlinedTextField: Material's has its own
 * label slot, its own 56dp minimum and its own focus indicator, none of which
 * are what the handoff draws.
 */
@Composable
private fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onClear: () -> Unit,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
) {
    var focused by remember { mutableStateOf(false) }

    Box(
        modifier
            .height(56.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Handoff.Surface)
            .border(
                width = 1.dp,
                color = if (focused) Handoff.Accent else Handoff.Line,
                shape = RoundedCornerShape(12.dp),
            ),
        contentAlignment = Alignment.CenterStart,
    ) {
        Icon(
            Icons.Default.Search,
            contentDescription = null,
            tint = Handoff.Muted4,
            modifier = Modifier.padding(start = 16.dp).size(19.dp),
        )

        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = LocalTextStyle.current.copy(
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = Handoff.Ink,
            ),
            cursorBrush = SolidColor(Handoff.Accent),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onSubmit() }),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 46.dp, end = 56.dp)
                .focusRequester(focusRequester)
                .onFocusChanged { focused = it.isFocused },
            decorationBox = { inner ->
                if (value.isEmpty()) {
                    Text(
                        "Scan barcode or search…",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium,
                        color = Handoff.Faint,
                    )
                }
                inner()
            },
        )

        // clear: 44x44, right:8px, radius:10px, #F1F5F5
        if (value.isNotEmpty()) {
            Surface(
                onClick = onClear,
                shape = RoundedCornerShape(10.dp),
                color = Handoff.Well,
                contentColor = Handoff.Muted,
                modifier = Modifier.align(Alignment.CenterEnd).padding(end = 8.dp).size(44.dp),
            ) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Icon(Icons.Default.Close, "Clear search", Modifier.size(17.dp))
                }
            }
        }
    }
}

/** `56x56; radius:12px; background:#0C2429; glyph #8FE3D8` — the barcode key. */
@Composable
private fun ScanButton(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = Handoff.ScanButton,
        contentColor = Handoff.ScanGlyph,
        modifier = Modifier.size(56.dp),
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) { BarcodeGlyph() }
    }
}

/** The handoff's own barcode mark: six bars of varying weight. */
@Composable
private fun BarcodeGlyph(size: Int = 24, tint: Color? = null) {
    Row(
        Modifier.size(size.dp),
        horizontalArrangement = Arrangement.spacedBy((size / 12).dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        listOf(2, 2, 1, 2, 1, 2).forEach { weight ->
            Box(
                Modifier
                    .width((weight * size / 14).dp)
                    .height((size * 0.62f).dp)
                    .background(tint ?: LocalContentColourOrCurrent()),
            )
        }
    }
}

@Composable
private fun LocalContentColourOrCurrent(): Color = LocalTextStyle.current.color

// ─────────────────────────────────────────────────────────────── the tabs

@Composable
private fun Tab(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(11.dp),
        color = if (selected) Handoff.AccentTint else Handoff.Surface,
        contentColor = if (selected) Handoff.AccentText else Handoff.InkStrong,
        border = BorderStroke(1.dp, if (selected) Handoff.AccentSolid else Handoff.Line),
        modifier = Modifier.height(44.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Text(label, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Text(
                count.toString(),
                fontFamily = PlexMono,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (selected) Handoff.AccentText else Handoff.Muted4,
            )
        }
    }
}

// ────────────────────────────────────────────────────────────── the tiles

/** `repeat(4,1fr); grid-auto-rows:136px; gap:10px` — fixed four across. */
@Composable
private fun TileGrid(groups: List<ProductGroup>, onPick: (ProductGroup) -> Unit) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(groups, key = { it.productId }) { group ->
            val out = group.stock <= 0
            Surface(
                onClick = { if (!out) onPick(group) },
                enabled = !out,
                shape = RoundedCornerShape(12.dp),
                color = Handoff.Surface,
                border = BorderStroke(1.dp, Handoff.LineSoft),
                modifier = Modifier.height(132.dp),
            ) {
                Column(
                    Modifier.padding(horizontal = 13.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        group.productName,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        lineHeight = 18.75.sp,
                        color = Handoff.Ink,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            group.swatches.forEach { ColourSwatch(it) }
                        }
                        // The price is laid out first and the size range takes
                        // what is left. At v2's 508px cart the tile column is
                        // narrower than v1's, and a long range ("12-18m -
                        // 18-24m") ran straight into the price — a figure a
                        // customer is about to be charged must never be the
                        // thing that gets clipped.
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            Text(
                                if (out) "Sold out" else formatPriceRange(group.minPrice, group.maxPrice),
                                fontFamily = PlexMono,
                                fontSize = 15.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (out) Handoff.Danger else Handoff.InkFigure,
                                maxLines = 1,
                            )
                            Text(
                                group.sizes,
                                fontSize = 10.5.sp,
                                color = Handoff.Muted4,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                textAlign = TextAlign.End,
                                modifier = Modifier.weight(1f, fill = true),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** `width:14px;height:14px;border-radius:5px` with a hairline. */
@Composable
internal fun ColourSwatch(hex: String?, size: Int = 14) {
    Box(
        Modifier
            .size(size.dp)
            .clip(RoundedCornerShape((size / 2.8f).dp))
            .background(parseHex(hex) ?: Handoff.Well)
            .border(1.dp, Handoff.LineSoft, RoundedCornerShape((size / 2.8f).dp)),
    )
}

// ───────────────────────────────────────────────────────────── the results

/** `height:76px; gap:8px; radius:12px`, each with a 48x48 IMG slot and a + key. */
@Composable
private fun ResultRows(
    groups: List<ProductGroup>,
    query: String,
    onPick: (ProductGroup) -> Unit,
    onAdd: (CatalogVariant) -> Unit,
) {
    if (groups.isEmpty()) {
        Centred { Text("Nothing matches \"$query\".", fontSize = 14.sp, color = Handoff.Muted2) }
        return
    }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(groups, key = { it.productId }) { group ->
            val out = group.stock <= 0
            Surface(
                onClick = { if (!out) onPick(group) },
                enabled = !out,
                shape = RoundedCornerShape(12.dp),
                color = Handoff.Surface,
                border = BorderStroke(1.dp, Handoff.LineSoft),
                modifier = Modifier.fillMaxWidth().height(76.dp),
            ) {
                Row(
                    Modifier.padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    ImageSlot()
                    Column(Modifier.weight(1f)) {
                        Text(
                            group.productName,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.Ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Row(
                            Modifier.padding(top = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(7.dp),
                        ) {
                            group.swatches.take(3).forEach { ColourSwatch(it, size = 12) }
                            Text(
                                group.sizes,
                                fontSize = 12.sp,
                                color = Handoff.Muted3,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    Text(
                        formatPriceRange(group.minPrice, group.maxPrice),
                        fontFamily = PlexMono,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Handoff.InkFigure,
                    )
                    // 48x48, radius:11px, tinted — the design's add key.
                    Box(
                        Modifier
                            .size(48.dp)
                            .clip(RoundedCornerShape(11.dp))
                            .background(if (out) Handoff.Well else Handoff.AccentTint),
                        Alignment.Center,
                    ) {
                        Icon(
                            Icons.Default.Add,
                            contentDescription = "Add ${group.productName}",
                            tint = if (out) Handoff.Fainter else Handoff.AccentText,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }
            }
        }
    }
}

/** `48x48; radius:10px; #F1F5F5; 9px 600 #A3B2B5` reading "IMG". */
@Composable
private fun ImageSlot() {
    Box(
        Modifier
            .size(48.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Handoff.Well)
            .border(1.dp, Handoff.LineSoft, RoundedCornerShape(10.dp)),
        Alignment.Center,
    ) {
        Text("IMG", fontSize = 9.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Fainter)
    }
}

@Composable
private fun Centred(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), Alignment.Center) { content() }
}

// ─────────────────────────────────────────────────────────────── the cart

@Composable
private fun CartPane(
    lines: List<CartLine>,
    totals: CartTotals,
    vatRate: Double,
    tillOpen: Boolean,
    customer: Customer?,
    discount: AppliedDiscountLocal?,
    heldCount: Int,
    justAdded: Int?,
    onSetQty: (Int, Int) -> Unit,
    onSetLineDiscount: (Int, String?, Double) -> Unit,
    onOpenPriceOverride: (Int) -> Unit,
    onRemoveDiscount: () -> Unit,
    onOpenNote: () -> Unit,
    onSetNote: (String) -> Unit,
    note: String,
    onRemove: (Int) -> Unit,
    onClear: () -> Unit,
    onPay: () -> Unit,
    onHold: () -> Unit,
    onOpenHeld: () -> Unit,
    onOpenCustomer: () -> Unit,
    onDetachCustomer: () -> Unit,
    onOpenDiscount: () -> Unit,
    onOpenTill: () -> Unit,
    onCloseTill: () -> Unit,
    onOpenMovement: () -> Unit,
    onOpenHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {
    /** The design confirms a clear IN PLACE — the button becomes "Clear sale?". */
    var confirmingClear by remember { mutableStateOf(false) }
    LaunchedEffect(confirmingClear) {
        if (confirmingClear) { delay(3_000); confirmingClear = false }
    }

    Column(modifier.background(Handoff.Surface)) {
        // `hasNote` — `margin:9px 14px 0; padding:4px 6px 4px 10px`
        if (note.isNotBlank()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 14.dp, end = 14.dp, top = 9.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(Color(0xFFFFF9EF))
                    .border(1.dp, Color(0xFFF2E1C4), RoundedCornerShape(11.dp))
                    .padding(start = 10.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Icon(
                    Icons.Default.StickyNote2,
                    null,
                    tint = Color(0xFFB08A4C),
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    note,
                    Modifier.weight(1f).clickable(onClick = onOpenNote),
                    fontSize = 12.5.sp,
                    lineHeight = 17.5.sp,
                    color = Color(0xFF7A4E10),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Surface(
                    onClick = { onSetNote("") },
                    shape = RoundedCornerShape(10.dp),
                    color = Color.Transparent,
                    contentColor = Color(0xFFB08A4C),
                    modifier = Modifier.size(48.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Icon(Icons.Default.Close, "Clear note", Modifier.size(17.dp))
                    }
                }
            }
        }

        // toolbar.  padding:12px 14px; gap:8px
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ToolButton(
                label = "Hold",
                icon = Icons.Default.Pause,
                enabled = lines.isNotEmpty(),
                border = Handoff.LineStrong,
                background = Handoff.Well2,
                modifier = Modifier.weight(1f),
                onClick = onHold,
            )
            ToolButton(
                label = "Held",
                badge = heldCount.takeIf { it > 0 },
                modifier = Modifier.width(92.dp),
                onClick = onOpenHeld,
            )
            if (confirmingClear) {
                Surface(
                    onClick = { onClear(); confirmingClear = false },
                    shape = RoundedCornerShape(11.dp),
                    color = Handoff.Danger,
                    contentColor = Color.White,
                    modifier = Modifier.width(118.dp).height(48.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Text("Clear sale?", fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
                    }
                }
            } else {
                ToolButton(
                    label = "Clear",
                    enabled = lines.isNotEmpty(),
                    textColour = Handoff.Muted2,
                    modifier = Modifier.width(78.dp),
                    onClick = { confirmingClear = true },
                )
            }
        }

        if (!tillOpen) {
            Surface(
                onClick = onOpenTill,
                color = Handoff.DangerTint,
                contentColor = Handoff.Danger,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp),
                shape = RoundedCornerShape(11.dp),
            ) {
                Text(
                    "The till is closed. Tap to count the float and start a shift.",
                    Modifier.padding(12.dp),
                    fontSize = 12.5.sp,
                )
            }
        }

        // lines.  padding:0 14px
        Box(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            if (lines.isEmpty()) {
                Column(
                    Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 30.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Default.ShoppingCart,
                        contentDescription = null,
                        tint = Handoff.Ghost,
                        modifier = Modifier.size(34.dp),
                    )
                    Spacer(Modifier.height(10.dp))
                    Text("Cart is empty", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Muted2)
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Scan a label, tap a quick key, or resume a held sale.",
                        fontSize = 12.5.sp,
                        color = Handoff.Faint,
                        textAlign = TextAlign.Center,
                    )
                }
            } else {
                LazyColumn {
                    items(lines, key = { it.variantId }) { line ->
                        CartRow(
                            line = line,
                            isNew = justAdded == line.variantId,
                            onSetQty = onSetQty,
                            onRemove = onRemove,
                            onLineDiscount = onSetLineDiscount,
                            onOpenPriceOverride = onOpenPriceOverride,
                        )
                    }
                }
            }
        }

        CartFooter(
            totals = totals,
            vatRate = vatRate,
            discount = discount,
            note = note,
            onOpenDiscount = onOpenDiscount,
            onRemoveDiscount = onRemoveDiscount,
            onOpenNote = onOpenNote,
            customer = customer,
            tillOpen = tillOpen,
            onPay = onPay,
            onOpenCustomer = onOpenCustomer,
            onDetachCustomer = onDetachCustomer,
            onOpenMovement = onOpenMovement,
            onOpenHistory = onOpenHistory,
            onCloseTill = onCloseTill,
        )
    }
}

/** "10%" or "Rs 250" — the figure the design puts on the chip and the row. */
private fun discountFigure(d: AppliedDiscountLocal): String {
    // A whole number loses its ".0" — the shop's rules are almost always whole,
    // and "Basket 10.0%" on a chip reads like a rounding artefact.
    val n = if (d.value % 1.0 == 0.0) d.value.toLong().toString() else formatAmount(d.value)
    return if (d.kind == "percent") "$n%" else "Rs $n"
}

/** `height:48px; radius:11px; 13.5px 600` — the toolbar's shape. */
@Composable
private fun ToolButton(
    label: String,
    modifier: Modifier = Modifier,
    icon: androidx.compose.ui.graphics.vector.ImageVector? = null,
    badge: Int? = null,
    enabled: Boolean = true,
    border: Color = Handoff.Line,
    background: Color = Handoff.Surface,
    textColour: Color = Handoff.InkStrong,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(11.dp),
        color = background,
        contentColor = textColour,
        border = BorderStroke(1.dp, border),
        modifier = modifier.height(48.dp),
    ) {
        // Height only, plus the design's own `padding:0 13px`.
        //
        // `fillMaxSize()` here took the whole row: Material's Surface
        // propagates min constraints, so an unsized button expands to whatever
        // the Row offers and squeezes its siblings out. It only looked right
        // while there was one such button per row — adding "Price" beside
        // "Discount" made it eat the Discount key entirely.
        Row(
            Modifier.fillMaxHeight().padding(horizontal = 13.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        ) {
            icon?.let { Icon(it, contentDescription = null, modifier = Modifier.size(16.dp)) }
            Text(label, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            badge?.let {
                Box(
                    Modifier
                        .clip(CircleShape)
                        .background(Handoff.WarnTint)
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                ) {
                    Text(
                        it.toString(),
                        fontFamily = PlexMono,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Handoff.WarnText,
                    )
                }
            }
        }
    }
}

/**
 * `padding:12px 0 13px; border-bottom:1px solid #F1F4F5`.
 *
 * The struck-through gross above the net is the design's own: a discounted line
 * shows what it was as well as what it is, so a customer can see the reduction
 * rather than take it on trust.
 */
@Composable
private fun CartRow(
    line: CartLine,
    isNew: Boolean,
    onSetQty: (Int, Int) -> Unit,
    onRemove: (Int) -> Unit,
    onLineDiscount: (Int, String?, Double) -> Unit,
    onOpenPriceOverride: (Int) -> Unit,
) {
    val discounted = line.discount > 0
    var discOpen by remember(line.variantId) { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 11.dp, bottom = 12.dp)
            .border(0.dp, Color.Transparent),
    ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Text(
                    line.productName,
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    lineHeight = 18.85.sp,
                    color = Handoff.Ink,
                )
                Row(
                    Modifier.padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    ColourSwatch(line.colourHex, size = 12)
                    Text(
                        line.variantLabel.ifBlank { line.sku },
                        fontSize = 12.5.sp,
                        color = Handoff.Muted2,
                    )
                    if (isNew) {
                        Badge("Added", Handoff.AccentTint, Handoff.AccentText)
                    }
                    if (line.priceOverride != null) {
                        // `l.overridden` — a hand-set price is called out by
                        // name, not just as money off, because it is a
                        // different act from applying a discount chip.
                        Badge(
                            "Price set",
                            Color(0xFFFFF3DF),
                            Color(0xFF7A4E10),
                            border = Color(0xFFF2E1C4),
                        )
                    } else if (discounted) {
                        Badge(
                            "-${formatAmount(line.discount)}",
                            Handoff.DangerTint,
                            Handoff.Danger,
                            border = Handoff.DangerLine,
                        )
                    }
                }
            }

            Column(horizontalAlignment = Alignment.End) {
                if (discounted) {
                    Text(
                        formatAmount(line.unitPrice * line.qty),
                        fontFamily = PlexMono,
                        fontSize = 11.5.sp,
                        color = Handoff.Faint,
                        textDecoration = TextDecoration.LineThrough,
                    )
                }
                Text(
                    formatAmount(line.lineTotal),
                    fontFamily = PlexMono,
                    fontSize = 15.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.InkFigure,
                )
            }

            Surface(
                onClick = { onRemove(line.variantId) },
                color = Color.Transparent,
                contentColor = Handoff.Fainter,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.size(48.dp),
            ) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Icon(Icons.Default.Close, "Remove ${line.productName}", Modifier.size(17.dp))
                }
            }
        }

        // stepper.  48x44 keys either side of a 46px mono figure
        Row(
            Modifier.padding(top = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                Modifier
                    .clip(RoundedCornerShape(11.dp))
                    .background(Handoff.Surface)
                    .border(1.dp, Color(0xFFDFE7E8), RoundedCornerShape(11.dp)),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StepKey(Icons.Default.Remove, "Fewer") { onSetQty(line.variantId, line.qty - 1) }
                Text(
                    line.qty.toString(),
                    Modifier.widthIn(min = 44.dp),
                    fontFamily = PlexMono,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.Ink,
                    textAlign = TextAlign.Center,
                )
                StepKey(
                    Icons.Default.Add,
                    "More",
                    enabled = line.qty < line.qtyOnHand,
                ) { onSetQty(line.variantId, line.qty + 1) }
            }

            Spacer(Modifier.weight(1f))

            // `l.openOverride` — `height:48px; padding:0 13px; radius:11`,
            // amber-bordered once a price has been set by hand.
            ToolButton(
                label = "Price",
                icon = Icons.Default.Sell,
                modifier = Modifier.height(48.dp),
                border = if (line.priceOverride != null) Color(0xFFF2E1C4) else Handoff.LineField,
                onClick = { onOpenPriceOverride(line.variantId) },
            )

            Spacer(Modifier.width(8.dp))

            // `l.toggleDisc` — opens this line's own chips, not a basket dialog.
            ToolButton(
                label = "Discount",
                icon = Icons.Default.Sell,
                modifier = Modifier.height(44.dp),
                border = if (discounted) Handoff.DangerLine else Handoff.Line,
                onClick = { discOpen = !discOpen },
            )
        }

        // ── `l.discOptions` ────────────────────────────────────────────────
        //
        // `display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;padding:9px;
        //  background:#F7FAFA;border:1px solid #E7EDEE;border-radius:11px`
        // over 44px chips, the selected one solid `#B4402F`.
        if (discOpen) {
            Column(
                Modifier
                    .padding(top = 9.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(Handoff.FieldWell)
                    .border(1.dp, Handoff.LineIdle, RoundedCornerShape(11.dp))
                    .padding(9.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                val gross = round2(line.unitPrice * line.qty)
                LINE_DISCOUNTS.chunked(3).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { (label, spec) ->
                            val (kind, value) = spec
                            // Selected when this chip is what produced the
                            // figure on the line — compared on the amount, so a
                            // quantity change that rescales 10% still reads as
                            // 10% rather than silently deselecting.
                            val would = round2(
                                minOf(
                                    if (kind == "percent") gross * value / 100 else value,
                                    gross,
                                ),
                            )
                            val on = discounted && would == line.discount
                            DiscountChip(label, on) {
                                onLineDiscount(line.variantId, if (on) null else kind, value)
                                discOpen = false
                            }
                        }
                    }
                }
                if (discounted) {
                    DiscountChip("Remove discount", false, wide = true) {
                        onLineDiscount(line.variantId, null, 0.0)
                        discOpen = false
                    }
                }
            }
        }

        Spacer(Modifier.height(13.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineFaint))
    }
}

/**
 * `DISC_OPTS` — the design's own five, plus a clear.
 *
 * Fixed offers rather than a keypad: at a counter the cashier is choosing from
 * what the shop allows, and a free-text box is how "20%" becomes "80%".
 */
private val LINE_DISCOUNTS: List<Pair<String, Pair<String, Double>>> = listOf(
    "5%" to ("percent" to 5.0),
    "10%" to ("percent" to 10.0),
    "20%" to ("percent" to 20.0),
    "Rs 50" to ("amount" to 50.0),
    "Rs 100" to ("amount" to 100.0),
)

/** `height:44px; padding:0 16px; radius:10px`, solid `#B4402F` when on. */
@Composable
private fun DiscountChip(
    label: String,
    selected: Boolean,
    wide: Boolean = false,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(10.dp),
        color = if (selected) Handoff.Danger else Handoff.Surface,
        contentColor = if (selected) Color.White else Handoff.InkStrong,
        border = BorderStroke(1.dp, if (selected) Handoff.Danger else Handoff.LineField),
        modifier = if (wide) Modifier.fillMaxWidth().height(44.dp) else Modifier.height(44.dp),
    ) {
        // Height only. `fillMaxSize()` would take the whole row: Material's
        // Surface propagates min constraints, so an unsized chip would expand to
        // whatever the Row offered and squeeze its siblings out — which it did.
        Box(Modifier.fillMaxHeight().padding(horizontal = 16.dp), Alignment.Center) {
            Text(label, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

@Composable
private fun StepKey(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        color = Color(0xFFF7FAFA),
        contentColor = Handoff.InkStrong,
        modifier = Modifier.size(48.dp),
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun Badge(
    text: String,
    background: Color,
    foreground: Color,
    border: Color? = null,
) {
    Box(
        Modifier
            .clip(RoundedCornerShape(5.dp))
            .background(background)
            .let { if (border != null) it.border(1.dp, border, RoundedCornerShape(5.dp)) else it }
            .padding(horizontal = 5.dp, vertical = 2.dp),
    ) {
        Text(
            text,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.8.sp,
            color = foreground,
        )
    }
}

/**
 * `border-top:1px #E7EDEE; background:#FBFDFD; padding:12px 16px 14px`.
 *
 * The total is set at 34px in the mono face with -.03em tracking — by a wide
 * margin the largest thing on the screen, which is the point: it is the number
 * the customer is about to be asked for.
 */
@Composable
private fun CartFooter(
    totals: CartTotals,
    vatRate: Double,
    discount: AppliedDiscountLocal?,
    note: String,
    customer: Customer?,
    tillOpen: Boolean,
    onPay: () -> Unit,
    onOpenDiscount: () -> Unit,
    onRemoveDiscount: () -> Unit,
    onOpenNote: () -> Unit,
    onOpenCustomer: () -> Unit,
    onDetachCustomer: () -> Unit,
    onOpenMovement: () -> Unit,
    onOpenHistory: () -> Unit,
    onCloseTill: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color(0xFFFBFDFD))
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 14.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFE7EDEE)))
        Spacer(Modifier.height(12.dp))

        Row(
            Modifier.fillMaxWidth().padding(vertical = 3.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Surface(
                onClick = if (customer == null) onOpenCustomer else onDetachCustomer,
                color = Color.Transparent,
                contentColor = if (customer == null) Handoff.Muted2 else Handoff.AccentText,
            ) {
                Text(
                    customer?.fullName ?: "Attach customer",
                    fontSize = 13.sp,
                    fontWeight = if (customer == null) FontWeight.Normal else FontWeight.SemiBold,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                FooterLink("Cash in/out", onOpenMovement)
                FooterLink("Past sales", onOpenHistory)
                if (tillOpen) FooterLink("Close till", onCloseTill)
            }
        }

        Spacer(Modifier.height(10.dp))

        // ── the basket-discount chip and the note key ───────────────────────
        //
        // `flex:1; height:48px; radius:11` beside a `flex:0 0 52px` note key.
        // The chip goes coral-bordered on `#FDECEA` once a discount is on, and
        // carries the figure and the reason: "Basket 10% · Staff discount".
        // That is the whole state of it, readable without opening anything.
        Row(
            Modifier.fillMaxWidth().padding(bottom = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Surface(
                onClick = onOpenDiscount,
                shape = RoundedCornerShape(11.dp),
                color = if (discount != null) Handoff.DangerTint else Handoff.Surface,
                contentColor = if (discount != null) Handoff.Danger else Handoff.InkStrong,
                border = BorderStroke(
                    1.dp,
                    if (discount != null) Color(0xFFF2C8C1) else Handoff.Line,
                ),
                modifier = Modifier.weight(1f).height(48.dp),
            ) {
                Row(
                    Modifier.fillMaxHeight().padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    Icon(Icons.Default.Sell, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text(
                        discount?.let { "Basket ${discountFigure(it)} · ${it.label}" }
                            ?: "Basket discount",
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            Surface(
                onClick = onOpenNote,
                shape = RoundedCornerShape(11.dp),
                color = Handoff.Surface,
                contentColor = if (note.isBlank()) Handoff.Muted else Handoff.AccentText,
                border = BorderStroke(1.dp, Handoff.Line),
                modifier = Modifier.width(52.dp).height(48.dp),
            ) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Icon(
                        Icons.Default.Description,
                        contentDescription = if (note.isBlank()) "Add a note" else "Edit the note",
                        modifier = Modifier.size(17.dp),
                    )
                }
            }
        }

        TotalRow("Subtotal", formatAmount(totals.subtotal), 13.sp, Handoff.Muted2, Handoff.InkStrong)

        if (totals.lineDiscounts > 0) {
            TotalRow(
                "Line discounts",
                "-${formatAmount(totals.lineDiscounts)}",
                13.sp,
                Handoff.Danger,
                Handoff.Danger,
                bold = true,
            )
        }

        // `hasBasketDisc` — the name, a 22px key to take it off, and the
        // figure. The chip above is the way *in*; this row is the way out, so
        // removing a discount never means reopening the dialog that set it.
        if (discount != null && totals.saleDiscount > 0) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Basket ${discountFigure(discount)}",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.Danger,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Surface(
                    onClick = onRemoveDiscount,
                    shape = RoundedCornerShape(6.dp),
                    color = Handoff.DangerTint,
                    contentColor = Handoff.Danger,
                    modifier = Modifier.padding(start = 7.dp).size(22.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Icon(
                            Icons.Default.Close,
                            "Remove the basket discount",
                            Modifier.size(12.dp),
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                Text(
                    "-${formatAmount(totals.saleDiscount)}",
                    fontFamily = PlexMono,
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.Danger,
                )
            }
        }

        TotalRow(
            "VAT ${(vatRate * 100).toInt()}% (included)",
            formatAmount(totals.vat),
            12.5.sp,
            Handoff.Muted4,
            Handoff.Muted4,
        )

        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFE7EDEE)))
        Spacer(Modifier.height(10.dp))

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(
                "TOTAL",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.3.sp,
                color = Handoff.Muted,
            )
            Text(
                formatAmount(totals.total),
                fontFamily = PlexMono,
                fontSize = 34.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-1).sp,
                lineHeight = 34.sp,
                color = Handoff.InkFigure,
            )
        }

        Spacer(Modifier.height(12.dp))

        if (totals.itemCount > 0 && tillOpen) {
            Surface(
                onClick = onPay,
                shape = RoundedCornerShape(14.dp),
                color = Handoff.AccentSolid,
                contentColor = Color.White,
                modifier = Modifier.fillMaxWidth().height(72.dp),
            ) {
                Row(
                    Modifier.fillMaxSize().padding(horizontal = 22.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("PAY", fontSize = 19.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.9.sp)
                    Text(
                        formatAmount(totals.total),
                        fontFamily = PlexMono,
                        fontSize = 23.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.46).sp,
                    )
                }
            }
        } else {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(72.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFFEFF3F3)),
                Alignment.Center,
            ) {
                Text(
                    if (!tillOpen) "Open the till to take payment" else "Add an item to take payment",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.Fainter,
                )
            }
        }
    }
}

@Composable
private fun FooterLink(label: String, onClick: () -> Unit) {
    Surface(onClick = onClick, color = Color.Transparent, contentColor = Handoff.Muted2) {
        Text(label, fontSize = 12.5.sp)
    }
}

@Composable
private fun TotalRow(
    label: String,
    value: String,
    size: androidx.compose.ui.unit.TextUnit,
    labelColour: Color,
    valueColour: Color,
    bold: Boolean = false,
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(
            label,
            fontSize = size,
            color = labelColour,
            fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
        )
        Text(
            value,
            fontFamily = PlexMono,
            fontSize = size * 1.04f,
            color = valueColour,
            fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}

// ────────────────────────────────────────────────────────────── plumbing

private fun groupsFor(query: String, catalog: List<CatalogVariant>): List<ProductGroup> {
    val q = query.trim().lowercase()
    if (q.length < 2) return emptyList()
    return catalog
        .filter {
            it.productName.lowercase().contains(q) ||
                it.sku.lowercase().contains(q) ||
                it.barcode.orEmpty().lowercase().contains(q)
        }
        .groupBy { it.productId }
        .map { (id, v) -> ProductGroup(id, v.first().productName, v.sortedBy { it.sizeSort }) }
        .take(MAX_RESULTS)
}

/** The tab strip: every category that has stock, with its product count. */
private fun tabsFor(catalog: List<CatalogVariant>): List<Triple<Int, String, Int>> =
    catalog.filter { it.categoryId != null }
        .groupBy { it.categoryId!! }
        .map { (id, v) ->
            Triple(id, v.first().categoryName ?: "Uncategorised", v.distinctBy { it.productId }.size)
        }
        .sortedBy { it.second }

private fun tilesFor(tab: Int?, catalog: List<CatalogVariant>): List<ProductGroup> =
    catalog.filter { tab == null || it.categoryId == tab }
        .groupBy { it.productId }
        .map { (id, v) -> ProductGroup(id, v.first().productName, v.sortedBy { it.sizeSort }) }
        .sortedBy { it.productName }
        .take(MAX_TILES)

/** `#RRGGBB` from the back office, or null when missing or malformed. */
internal fun parseHex(hex: String?): Color? {
    val cleaned = hex?.trim()?.removePrefix("#") ?: return null
    if (cleaned.length != 6) return null
    return cleaned.toLongOrNull(16)?.let { Color(it or 0xFF000000L) }
}

/**
 * `scanHit` — the one row a barcode resolves to.
 *
 * `padding:14px; radius:12px` on the accent tint behind an accent hairline,
 * with a 46px solid square carrying the barcode mark, then the code in mono
 * caps, the product, and the variant behind its swatch.
 *
 * Deliberately not a `ResultRows` entry. A text match is a guess the cashier
 * chooses between; a barcode is an identification, and drawing the two the
 * same way invites tapping the wrong one.
 */
@Composable
private fun ScanHitRow(variant: CatalogVariant, code: String, onAdd: () -> Unit) {
    Surface(
        onClick = onAdd,
        shape = RoundedCornerShape(12.dp),
        color = Handoff.DangerTint,
        border = BorderStroke(1.dp, Handoff.Danger),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                Modifier
                    .size(46.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Handoff.Danger),
                Alignment.Center,
            ) {
                BarcodeGlyph(size = 22, tint = Color.White)
            }

            Column(Modifier.weight(1f)) {
                Text(
                    "Barcode ${variant.barcode ?: code}",
                    fontFamily = PlexMono,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.88.sp,
                    color = Handoff.Danger,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    variant.productName,
                    fontSize = 15.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 3.dp),
                )
                Row(
                    Modifier.padding(top = 3.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    ColourSwatch(variant.colourHex, size = 12)
                    Text(
                        listOfNotNull(
                            variant.colourName.takeIf { it.isNotBlank() },
                            variant.sizeLabel.takeIf { it.isNotBlank() },
                        ).joinToString(" · "),
                        fontSize = 12.5.sp,
                        color = Handoff.Muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            Text(
                formatAmount(variant.price),
                fontFamily = PlexMono,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.InkFigure,
            )
        }
    }
}
