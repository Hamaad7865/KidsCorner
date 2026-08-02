package mu.kidscorner.till.ui

import coil3.compose.AsyncImage
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material.icons.filled.QrCodeScanner
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
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

/**
 * Below this width the category rail starts closed.
 *
 * Carfectionist's figure, kept rather than re-derived: three columns need room,
 * and a 225dp rail on a drawer-sized tablet is taken out of the two that are
 * doing the work.
 */
private const val COMPACT_RAIL_DP = 1100

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

    /**
     * The photograph, from whichever variant carries one.
     *
     * `firstNotNullOfOrNull` rather than `first().imageUrl`: the picture is a
     * property of the product, so every variant repeats it — but a catalogue
     * fetched by an older till, or mid-way through a back-office edit, can hand
     * back a group whose first row is the one without it.
     */
    val imageUrl: String?
        get() = variants.firstNotNullOfOrNull { it.imageUrl?.takeIf(String::isNotBlank) }

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
    /**
     * The category rail, open unless the tablet is too narrow for three columns.
     *
     * Carfectionist's own rule, and its number: below 1100dp the grid and the
     * bill need the width more than the rail does, so it starts tucked away and
     * the » brings it back. Without this a drawer-sized tablet gets 225dp of
     * rail, a crushed grid and a bill too narrow to read a total in — which is
     * the shape of every three-column layout that was only ever tried on the
     * developer's screen.
     */
    val compactScreen = LocalConfiguration.current.screenWidthDp < COMPACT_RAIL_DP
    var railOpen by remember(compactScreen) { mutableStateOf(!compactScreen) }
    /** The line most recently added, for the design's "Added" badge. */
    var justAdded by remember { mutableStateOf<Int?>(null) }

    val search = remember { FocusRequester() }

    LaunchedEffect(justAdded) {
        if (justAdded != null) { delay(1_600); justAdded = null }
    }

    // The search box is the till's default focus: a barcode scanner acts as a
    // keyboard, so anything typed anywhere has to land here.
    //
    // Focused, but the ON-SCREEN keyboard is pushed straight back down. The
    // counter's scanner is a hardware keyboard; a soft keyboard springing up
    // over the basket every time the field takes focus would cover the very
    // thing the cashier is checking, and there is nothing to type on it. It
    // still opens on a deliberate tap, which is when somebody actually wants
    // to search by name.
    val keyboard = LocalSoftwareKeyboardController.current
    LaunchedEffect(picker, lines.size) {
        if (picker == null) {
            runCatching { search.requestFocus() }
            keyboard?.hide()
        }
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

        // ── the checkout, three columns ───────────────────────────────────
        //
        // Carfectionist's CounterScreen, column for column: a category rail
        // that collapses, the grid in the middle, the bill on the right at
        // 42:54. Their layout, our colours.
        //
        // The scan bar stays where it is, under all three. Carfectionist puts
        // its search at the head of the middle column; here the counter is
        // scanner-first and that field holds focus for a hardware scanner, so
        // it spans the till rather than sitting inside one pane. That is the
        // one deliberate departure, and it is about a scanner theirs does not
        // have to serve.
        Row(
            Modifier.weight(1f).fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CategoryRail(
                open = railOpen,
                tabs = tabs,
                selected = tab,
                onToggle = { railOpen = !railOpen },
                onSelect = { tab = it },
            )

            // ── products (42fr) ───────────────────────────────────────────
            Column(
                Modifier.weight(42f).fillMaxHeight(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (catalogLoading && catalog.isEmpty()) {
                    Centred { Text("Loading the catalogue…", fontSize = 14.sp, color = Handoff.Muted2) }
                } else if (query.trim().length >= 2 || scanHit != null) {
                    // Typing turns the middle column into results, exactly as
                    // tapping a category turns it into that category's tiles.
                    ResultRows(
                        groups = if (scanHit != null) emptyList() else results,
                        query = query.trim(),
                        onPick = ::open,
                        onAdd = { add(it); query = "" },
                    )
                } else {
                    TileGrid(groups = tiles, onPick = ::open)
                }
            }

            // ── the bill (54fr) ───────────────────────────────────────────
            Column(
                Modifier
                    .weight(54f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Handoff.Surface)
                    .border(1.dp, Handoff.Line, RoundedCornerShape(16.dp)),
            ) {
                BasketPane(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    lines = lines,
                    tillOpen = tillOpen,
                    note = note,
                    justAdded = justAdded,
                    itemCount = totals.itemCount,
                    onSetQty = onSetQty,
                    onSetLineDiscount = onSetLineDiscount,
                    onOpenPriceOverride = onOpenPriceOverride,
                    onOpenNote = onOpenNote,
                    onSetNote = onSetNote,
                    onRemove = onRemove,
                    onClear = onClear,
                    onOpenTill = onOpenTill,
                )

                CartPane(
                    modifier = Modifier.fillMaxWidth(),
                    lines = lines,
                    totals = totals,
                    vatRate = vatRate,
                    tillOpen = tillOpen,
                    customer = customer,
                    discount = discount,
                    heldCount = heldCount,
                    onOpenNote = onOpenNote,
                    note = note,
                    onPay = onPay,
                    onHold = onHold,
                    onOpenHeld = onOpenHeld,
                    onOpenCustomer = onOpenCustomer,
                    onDetachCustomer = onDetachCustomer,
                    onOpenDiscount = onOpenDiscount,
                    onRemoveDiscount = onRemoveDiscount,
                    onCloseTill = onCloseTill,
                    onOpenMovement = onOpenMovement,
                    onOpenHistory = onOpenHistory,
                )
            }
        }

        // ── the scan bar: full width, always focused ──────────────────────
        //
        // A hardware scanner is a keyboard, so this holds focus and anything
        // typed anywhere lands here. It spans the till because it is the till's
        // primary input, not a field in a corner of a browsing pane.
        Row(
            Modifier
                .fillMaxWidth()
                .background(Handoff.Surface)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
                    SearchField(
                        value = query,
                        onValueChange = { query = it },
                        onSubmit = ::submitSearch,
                        onClear = { query = "" },
                        focusRequester = search,
                        modifier = Modifier.weight(1f),
                    )
                    ScanButton(onClick = ::submitSearch)

                    // Custom item takes the key Browse used to hold. Browse
                    // opened an overlay onto the catalogue, and the catalogue
                    // is now the middle column — a door onto the room you are
                    // already standing in.
                    Surface(
                        onClick = onOpenCustomItem,
                        shape = RoundedCornerShape(12.dp),
                        color = Handoff.Surface,
                        contentColor = Handoff.InkStrong,
                        border = BorderStroke(1.dp, Handoff.Line),
                        modifier = Modifier.size(width = 132.dp, height = 56.dp),
                    ) {
                        Row(
                            Modifier.fillMaxSize(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(
                                8.dp,
                                Alignment.CenterHorizontally,
                            ),
                        ) {
                            Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                            Text("Custom", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }

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
        // Adaptive, as Carfectionist has it: the middle column is 42fr of
        // whatever the tablet is, and a fixed count would either crush the
        // tiles on a narrow one or strand them on a wide one.
        columns = GridCells.Adaptive(minSize = 140.dp),
        horizontalArrangement = Arrangement.spacedBy(9.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
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
                    // The picture leads and the name takes what is left. The
                    // name drops from three lines to two to pay for it, which
                    // costs an ellipsis on the longest names and buys a tile a
                    // person can recognise from a metre away — the whole reason
                    // anyone opens Browse instead of scanning.
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(9.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        ImageSlot(group.productName, group.imageUrl, size = 40, radius = 9)
                        Text(
                            group.productName,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            lineHeight = 18.75.sp,
                            color = Handoff.Ink,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                    }
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
                    ImageSlot(group.productName, group.imageUrl)
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

/**
 * The design's `48x48; radius:10px; #F1F5F5` slot, with the garment in it.
 *
 * It read "IMG" for as long as there was nothing to put there. Now it shows the
 * product's photograph, and where the shop has not taken one it shows the
 * product's INITIALS rather than the word IMG or an empty grey square — most of
 * a catalogue will have no picture for a long time, and a screen of identical
 * grey boxes is worse than no slot at all. Initials differ from row to row, so
 * the eye can still use the column to keep its place.
 *
 * The initials come from `TillChrome`'s own helper, the one that puts "MA" on
 * Marie Appadoo's chip. Same shop, same abbreviation.
 */
@Composable
private fun ImageSlot(name: String, url: String?, size: Int = 48, radius: Int = 10) {
    val shape = RoundedCornerShape(radius.dp)
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
                // Decorative: the product's name is always beside it, and
                // hearing it twice helps nobody.
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
private fun Centred(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), Alignment.Center) { content() }
}

// ───────────────────────────────────────────────────────────── the browser

/**
 * The basket, which now owns the till.
 *
 * At rest a scanning cashier is doing one of two things: confirming that what
 * they just scanned is what they meant, and reading the total. This pane is the
 * first of those, so it is given the room and the type size to be read at arm's
 * length while their hands are on the goods.
 */
@Composable
private fun BasketPane(
    lines: List<CartLine>,
    tillOpen: Boolean,
    note: String,
    justAdded: Int?,
    itemCount: Int,
    onSetQty: (Int, Int) -> Unit,
    onSetLineDiscount: (Int, String?, Double) -> Unit,
    onOpenPriceOverride: (Int) -> Unit,
    onOpenNote: () -> Unit,
    onSetNote: (String) -> Unit,
    onRemove: (Int) -> Unit,
    onClear: () -> Unit,
    onOpenTill: () -> Unit,
    modifier: Modifier = Modifier,
) {
    /** The design confirms a clear IN PLACE — the button becomes "Clear sale?". */
    var confirmingClear by remember { mutableStateOf(false) }
    LaunchedEffect(confirmingClear) {
        if (confirmingClear) { delay(3_000); confirmingClear = false }
    }

    Column(modifier.background(Handoff.Surface).padding(horizontal = 14.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "BASKET",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.4.sp,
                color = Handoff.Muted3,
            )
            if (itemCount > 0) {
                Text(
                    "  $itemCount item${if (itemCount == 1) "" else "s"}",
                    fontFamily = PlexMono,
                    fontSize = 13.sp,
                    color = Handoff.Muted3,
                )
            }
            Spacer(Modifier.weight(1f))
            if (lines.isNotEmpty()) {
                if (confirmingClear) {
                    Surface(
                        onClick = { onClear(); confirmingClear = false },
                        shape = RoundedCornerShape(11.dp),
                        color = Handoff.Danger,
                        contentColor = Color.White,
                        modifier = Modifier.height(44.dp),
                    ) {
                        Box(Modifier.padding(horizontal = 16.dp).fillMaxHeight(), Alignment.Center) {
                            Text("Clear sale?", fontSize = 13.5.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                } else {
                    ToolButton(
                        label = "Clear",
                        textColour = Handoff.Muted2,
                        modifier = Modifier.height(44.dp),
                        onClick = { confirmingClear = true },
                    )
                }
            }
        }

        if (note.isNotBlank()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(bottom = 9.dp)
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
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
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

        if (!tillOpen) {
            Surface(
                onClick = onOpenTill,
                color = Handoff.DangerTint,
                contentColor = Handoff.Danger,
                modifier = Modifier.fillMaxWidth().padding(bottom = 9.dp),
                shape = RoundedCornerShape(11.dp),
            ) {
                Text(
                    "The till is closed. Tap to count the float and start a shift.",
                    Modifier.padding(12.dp),
                    fontSize = 13.sp,
                )
            }
        }

        Box(Modifier.weight(1f)) {
            if (lines.isEmpty()) {
                // An empty basket is an invitation, not a void: it says what to
                // do, and the scan bar below it is where to do it.
                Column(
                    Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 30.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Default.QrCodeScanner,
                        contentDescription = null,
                        tint = Handoff.Ghost,
                        modifier = Modifier.size(46.dp),
                    )
                    Spacer(Modifier.height(14.dp))
                    Text(
                        "Scan a tag to start",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Handoff.Muted2,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "No tag? Tap Browse, or type a name below.",
                        fontSize = 14.sp,
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
    }
}

// ─────────────────────────────────────────────────────────────── the cart

@Composable
private fun CartPane(
    /** Only to know whether there is anything to hold. */
    lines: List<CartLine>,
    totals: CartTotals,
    vatRate: Double,
    tillOpen: Boolean,
    customer: Customer?,
    discount: AppliedDiscountLocal?,
    heldCount: Int,
    onRemoveDiscount: () -> Unit,
    onOpenNote: () -> Unit,
    note: String,
    onPay: () -> Unit,
    onHold: () -> Unit,
    onOpenHeld: () -> Unit,
    onOpenCustomer: () -> Unit,
    onDetachCustomer: () -> Unit,
    onOpenDiscount: () -> Unit,
    onCloseTill: () -> Unit,
    onOpenMovement: () -> Unit,
    onOpenHistory: () -> Unit,
    modifier: Modifier = Modifier,
) {

    // ── the rail ──────────────────────────────────────────────────────────
    //
    // What the cashier and the customer both look at, and the one action that
    // matters. The basket is checked on the left; this side answers "how much"
    // and "take the money", and everything else on it is deliberately quiet.
    Column(modifier.background(Handoff.Surface)) {
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
        )

        // Hold and the parked baskets. Quiet, and below the fold of the total:
        // they are not what this rail is for, but a cashier fetching another
        // size needs them within reach.
        Row(
            Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ToolButton(
                label = "Hold",
                icon = Icons.Default.Pause,
                enabled = lines.isNotEmpty(),
                border = Handoff.LineStrong,
                background = Handoff.Well2,
                modifier = Modifier.weight(1f).height(48.dp),
                onClick = onHold,
            )
            ToolButton(
                label = "Held",
                badge = heldCount.takeIf { it > 0 },
                modifier = Modifier.weight(1f).height(48.dp),
                onClick = onOpenHeld,
            )
        }

        // Everything a till does between customers, under the keys that do the
        // selling — reachable, never in the way of taking money.
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, bottom = 18.dp),
            horizontalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            FooterLink("Cash in/out", onOpenMovement)
            FooterLink("Past sales", onOpenHistory)
            if (tillOpen) FooterLink("Close till", onCloseTill)
        }
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

    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp)
            .clip(RoundedCornerShape(13.dp))
            .background(if (isNew) Handoff.AccentTint else Handoff.Surface)
            .border(
                1.dp,
                if (isNew) Handoff.AccentLine else Handoff.LineSoft,
                RoundedCornerShape(13.dp),
            ),
        verticalAlignment = Alignment.Top,
    ) {
        // The garment's own colour, running the full height of the line.
        //
        // This is the one place chroma is let in from outside the brand, and it
        // is what makes a basket checkable against a pile of clothes at arm's
        // length: you match the band and the size chip, not the words. A
        // variant with no colour on file gets a neutral rather than a guess,
        // the same rule ColourSwatch follows.
        Box(
            Modifier
                .width(9.dp)
                .heightIn(min = 86.dp)
                .fillMaxHeight()
                .background(parseHex(line.colourHex) ?: Handoff.Ghost),
        )

        Column(
            Modifier
                .weight(1f)
                .padding(start = 13.dp, end = 11.dp, top = 11.dp, bottom = 11.dp),
        ) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Text(
                    line.productName,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                    lineHeight = 25.sp,
                    letterSpacing = (-0.2).sp,
                    color = Handoff.Ink,
                )
                Row(
                    Modifier.padding(top = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    // The size, stamped. Mono and uppercase so "3-6 MTHS" reads
                    // as a garment tag rather than as prose.
                    if (line.sizeLabel.isNotBlank()) {
                        Text(
                            line.sizeLabel.uppercase(),
                            Modifier
                                .clip(RoundedCornerShape(7.dp))
                                .background(Handoff.Well)
                                .padding(horizontal = 8.dp, vertical = 3.dp),
                            fontFamily = PlexMono,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = 0.5.sp,
                            color = Handoff.Muted,
                        )
                    }
                    Text(
                        line.colourName.ifBlank { line.variantLabel.ifBlank { line.sku } },
                        fontSize = 14.sp,
                        color = Handoff.Muted2,
                    )
                    // The last one on the shelf, said on the line it concerns
                    // rather than as a warning after the sale is refused.
                    if (line.qtyOnHand == 1 && !line.isCustom) {
                        Badge("Last one", Handoff.WarnTint, Handoff.WarnText)
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
                        fontSize = 13.sp,
                        color = Handoff.Faint,
                        textDecoration = TextDecoration.LineThrough,
                    )
                }
                Text(
                    formatAmount(line.lineTotal),
                    fontFamily = PlexMono,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.4).sp,
                    color = Handoff.InkFigure,
                )
                // So a line of three reads as three of one thing rather than as
                // one expensive thing.
                if (line.qty > 1) {
                    Text(
                        "${line.qty} x ${formatAmount(line.unitPrice)}",
                        fontFamily = PlexMono,
                        fontSize = 12.sp,
                        color = Handoff.Muted3,
                    )
                }
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

        }
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
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color(0xFFFBFDFD))
            .padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 16.dp),
    ) {
        // ── the total, first and largest ──────────────────────────────────
        //
        // This is the figure the cashier reads out and the customer checks, and
        // it used to be 34sp at the bottom of a 500dp column. It leads now, in
        // mono so the digits do not shift width as it changes, and in the one
        // colour reserved for it.
        Text(
            "TOTAL",
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.4.sp,
            color = Handoff.Muted3,
        )
        Text(
            formatAmount(totals.total),
            fontFamily = PlexMono,
            fontSize = 56.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = (-2).sp,
            lineHeight = 60.sp,
            color = Handoff.AccentSolid,
        )
        Text(
            "incl. VAT ${(vatRate * 100).toInt()}%  ${formatAmount(totals.vat)}",
            fontFamily = PlexMono,
            fontSize = 12.5.sp,
            color = Handoff.Muted4,
        )

        Spacer(Modifier.height(14.dp))

        if (totals.itemCount > 0 && tillOpen) {
            Surface(
                onClick = onPay,
                shape = RoundedCornerShape(14.dp),
                color = Handoff.AccentSolid,
                contentColor = Color.White,
                modifier = Modifier.fillMaxWidth().height(88.dp),
            ) {
                Row(
                    Modifier.fillMaxSize().padding(horizontal = 24.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text("PAY", fontSize = 21.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                    Text(
                        formatAmount(totals.total),
                        fontFamily = PlexMono,
                        fontSize = 25.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        } else {
            // Blocked reads as a well, never as a dimmed button — the handoff's
            // own rule, and it stops a cashier stabbing at something disabled.
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(88.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Handoff.Blocked),
                Alignment.Center,
            ) {
                Text(
                    if (!tillOpen) "Open the till to sell" else "Scan something to sell",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Handoff.BlockedText,
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color(0xFFE7EDEE)))
        Spacer(Modifier.height(12.dp))

        // The customer, as a key rather than as grey text. Attaching one is a
        // deliberate act with a name attached to it afterwards, so it gets a
        // target a thumb can find.
        Surface(
            onClick = if (customer == null) onOpenCustomer else onDetachCustomer,
            shape = RoundedCornerShape(11.dp),
            color = if (customer == null) Handoff.Surface else Handoff.AccentTint,
            contentColor = if (customer == null) Handoff.Muted else Handoff.AccentText,
            border = BorderStroke(
                1.dp,
                if (customer == null) Handoff.Line else Handoff.AccentLine,
            ),
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            Row(
                Modifier.fillMaxSize().padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Icon(Icons.Default.PersonOutline, null, Modifier.size(18.dp))
                Text(
                    customer?.fullName ?: "Attach a customer",
                    fontSize = 14.sp,
                    fontWeight = if (customer == null) FontWeight.Medium else FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (customer != null) {
                    Icon(Icons.Default.Close, "Detach the customer", Modifier.size(16.dp))
                }
            }
        }

        Spacer(Modifier.height(8.dp))

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

// ────────────────────────────────────────────────── the checkout columns

/**
 * The category rail — Carfectionist's CounterScreen, column for column.
 *
 * 225dp open, a 40dp strip closed, with its own search and a count per row.
 * Their teal is our coral and their card is our off-white; everything else
 * about it is theirs, including the 3dp bar down the selected row. That bar is
 * not decoration: selection has to be readable as something other than colour
 * alone, and a rail read at arm's length across a counter is exactly where
 * that matters.
 */
@Composable
private fun CategoryRail(
    open: Boolean,
    tabs: List<Triple<Int, String, Int>>,
    selected: Int?,
    onToggle: () -> Unit,
    onSelect: (Int?) -> Unit,
) {
    var filter by remember { mutableStateOf("") }
    val shown = remember(tabs, filter) {
        val q = filter.trim().lowercase()
        if (q.isEmpty()) tabs else tabs.filter { it.second.lowercase().contains(q) }
    }

    if (!open) {
        Column(
            Modifier
                .width(40.dp)
                .fillMaxHeight()
                .clip(RoundedCornerShape(14.dp))
                .background(Handoff.Surface)
                .border(1.dp, Handoff.Line, RoundedCornerShape(14.dp))
                .clickable(onClick = onToggle),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "»",
                color = Handoff.Muted,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                modifier = Modifier.padding(top = 11.dp),
            )
            // A dot when a filter is on, so a collapsed rail cannot hide the
            // reason the grid is showing less than everything.
            if (selected != null) {
                Box(
                    Modifier
                        .padding(top = 10.dp)
                        .size(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(Handoff.AccentSolid),
                )
            }
        }
        return
    }

    Column(
        Modifier
            .width(225.dp)
            .fillMaxHeight()
            .clip(RoundedCornerShape(14.dp))
            .background(Handoff.Surface)
            .border(1.dp, Handoff.Line, RoundedCornerShape(14.dp)),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(40.dp)
                .clickable(onClick = onToggle)
                .padding(start = 13.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "CATEGORIES",
                color = Handoff.Muted3,
                fontWeight = FontWeight.Bold,
                fontSize = 10.sp,
                letterSpacing = 1.4.sp,
                modifier = Modifier.weight(1f),
            )
            Text("«", color = Handoff.Muted, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }

        RailFilter(
            value = filter,
            onValueChange = { filter = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
        )

        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            item {
                RailRow("All", tabs.sumOf { it.third }, selected == null) { onSelect(null) }
            }
            items(shown, key = { it.first }) { (id, name, count) ->
                RailRow(name, count, selected == id) { onSelect(id) }
            }
        }
    }
}

@Composable
private fun RailRow(label: String, count: Int, on: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 46.dp)
            .height(IntrinsicSize.Min)
            .background(if (on) Handoff.AccentTint else Color.Transparent)
            .clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(if (on) Handoff.AccentSolid else Color.Transparent),
        )
        Text(
            label,
            color = if (on) Handoff.AccentText else Handoff.Ink,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            lineHeight = 18.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).padding(start = 11.dp, top = 10.dp, bottom = 10.dp),
        )
        Text(
            count.toString(),
            color = Handoff.Muted3,
            fontFamily = PlexMono,
            fontSize = 12.sp,
            modifier = Modifier.padding(start = 6.dp, end = 11.dp),
        )
    }
}

/** The rail's own 38dp filter. Deliberately not the scanner's field. */
@Composable
private fun RailFilter(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .height(38.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(Handoff.Well)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Icon(Icons.Default.Search, null, Modifier.size(15.dp), tint = Handoff.Muted4)
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) {
                Text("Search…", color = Handoff.Muted4, fontSize = 13.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = TextStyle(color = Handoff.Ink, fontSize = 13.sp),
                cursorBrush = SolidColor(Handoff.AccentSolid),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
