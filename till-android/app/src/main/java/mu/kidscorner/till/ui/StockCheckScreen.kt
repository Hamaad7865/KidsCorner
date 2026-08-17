package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.StockCheckUiState
import mu.kidscorner.till.data.CatalogVariant
import mu.kidscorner.till.data.StockCheckLocation
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

@Composable
fun StockCheckScreen(
    catalog: List<CatalogVariant>,
    state: StockCheckUiState,
    onSelectProduct: (Int) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var query by remember { mutableStateOf("") }
    var showingResults by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val matches = remember(query, catalog) { stockCheckMatches(query, catalog) }
    val selected = remember(state.productId, catalog) {
        state.productId?.let { productId -> productFrom(productId, catalog) }
    }

    fun choose(product: StockCheckProduct) {
        showingResults = false
        query = product.productName
        keyboard?.hide()
        onSelectProduct(product.productId)
    }

    fun submit() {
        val first = matches.firstOrNull()
        if (first != null && (first.barcodeMatch || matches.size == 1)) {
            choose(first)
        } else {
            showingResults = true
        }
    }

    LaunchedEffect(Unit) { focus.requestFocus() }

    Column(modifier.fillMaxSize().background(Handoff.Canvas)) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Handoff.Surface)
                .padding(horizontal = 18.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to selling")
            }
            Spacer(Modifier.width(6.dp))
            Column(Modifier.weight(1f)) {
                Text("Stock check", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Live shop and warehouse quantities",
                    color = Handoff.Muted2,
                    fontSize = 13.sp,
                )
            }
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = if (state.error == null) Handoff.AccentTint else Color(0xFFFFF3F1),
            ) {
                Text(
                    if (state.error == null) "LIVE STOCK" else "CONNECTION NEEDED",
                    Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                    color = if (state.error == null) Handoff.AccentText else Color(0xFF9B2C20),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.7.sp,
                )
            }
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = {
                    query = it
                    showingResults = it.isNotBlank()
                },
                modifier = Modifier.weight(1f).focusRequester(focus),
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                placeholder = { Text("Product name, SKU or barcode") },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { submit() }),
            )
            Button(onClick = ::submit, modifier = Modifier.height(56.dp)) {
                Icon(Icons.Default.Search, contentDescription = null)
                Spacer(Modifier.width(7.dp))
                Text("Search")
            }
            OutlinedButton(
                onClick = {
                    focus.requestFocus()
                    if (query.isNotBlank()) submit()
                },
                modifier = Modifier.height(56.dp),
            ) {
                Icon(Icons.Default.QrCodeScanner, contentDescription = null)
                Spacer(Modifier.width(7.dp))
                Text("Scan")
            }
        }

        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())

        BoxWithConstraints(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(start = 18.dp, end = 18.dp, bottom = 18.dp),
        ) {
            val compact = maxWidth < 900.dp
            if (compact) {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (showingResults) {
                        MatchList(
                            matches = matches,
                            query = query,
                            onChoose = ::choose,
                            modifier = Modifier.fillMaxWidth().heightIn(max = 220.dp),
                        )
                    }
                    StockDetails(
                        product = selected,
                        state = state,
                        onRetry = onRetry,
                        modifier = Modifier.fillMaxWidth().weight(1f, fill = true),
                    )
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    MatchList(
                        matches = matches,
                        query = query,
                        onChoose = ::choose,
                        modifier = Modifier.width(330.dp).fillMaxHeight(),
                    )
                    StockDetails(
                        product = selected,
                        state = state,
                        onRetry = onRetry,
                        modifier = Modifier.weight(1f).fillMaxHeight(),
                    )
                }
            }
        }
    }
}

private fun productFrom(
    productId: Int,
    catalog: List<CatalogVariant>,
): StockCheckProduct? {
    val variants = catalog.filter { it.productId == productId }
    val first = variants.firstOrNull() ?: return null
    return StockCheckProduct(
        productId = productId,
        productName = first.productName,
        shelfLocation = variants.firstNotNullOfOrNull { it.shelfLocation },
        variants = variants.sortedWith(compareBy<CatalogVariant> { it.sizeSort }.thenBy { it.id }),
        barcodeMatch = false,
    )
}

@Composable
private fun MatchList(
    matches: List<StockCheckProduct>,
    query: String,
    onChoose: (StockCheckProduct) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = Handoff.Surface,
        border = BorderStroke(1.dp, Handoff.Line),
    ) {
        when {
            query.isBlank() -> EmptyMessage(
                icon = Icons.Default.Inventory2,
                title = "Find a product",
                detail = "Type a name or SKU, or scan its barcode.",
            )
            matches.isEmpty() -> EmptyMessage(
                icon = Icons.Default.Search,
                title = "No matching product",
                detail = "Try another name, SKU or barcode.",
            )
            else -> LazyColumn {
                item {
                    Text(
                        "${matches.size} product${if (matches.size == 1) "" else "s"}",
                        Modifier.padding(14.dp),
                        color = Handoff.Muted2,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
                items(matches, key = { it.productId }) { product ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onChoose(product) }
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                    ) {
                        Text(
                            product.productName,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            "Shelf ${product.shelfLocation ?: "not set"} · " +
                                "${product.variants.size} variant${if (product.variants.size == 1) "" else "s"}",
                            color = Handoff.Muted2,
                            fontSize = 12.sp,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StockDetails(
    product: StockCheckProduct?,
    state: StockCheckUiState,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = Handoff.Surface,
        border = BorderStroke(1.dp, Handoff.Line),
    ) {
        if (product == null) {
            EmptyMessage(
                icon = Icons.Default.Inventory2,
                title = "Stock will appear here",
                detail = "Choose a product to see every size and colour.",
            )
            return@Surface
        }

        Column(Modifier.fillMaxSize()) {
            Row(
                Modifier.fillMaxWidth().padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(product.productName, fontSize = 21.sp, fontWeight = FontWeight.Bold)
                    Text(
                        "Shelf location: ${product.shelfLocation ?: "Not set"}",
                        color = Handoff.Muted,
                        fontSize = 14.sp,
                    )
                }
                Text(
                    "${product.variants.sumOf { it.qtyOnHand }} total",
                    fontFamily = PlexMono,
                    fontWeight = FontWeight.Bold,
                    color = Handoff.AccentText,
                )
            }

            state.error?.let { message ->
                Surface(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    shape = RoundedCornerShape(10.dp),
                    color = Color(0xFFFFF3F1),
                ) {
                    Row(
                        Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "Cached totals are shown. Live location stock needs a connection. " + message,
                            Modifier.weight(1f),
                            color = Color(0xFF8A3027),
                            fontSize = 13.sp,
                        )
                        OutlinedButton(onClick = onRetry) {
                            Icon(Icons.Default.Refresh, contentDescription = null)
                            Spacer(Modifier.width(6.dp))
                            Text("Retry")
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
            }

            VariantHeader(state.locations)
            LazyColumn(Modifier.fillMaxSize()) {
                items(product.variants, key = { it.id }) { variant ->
                    VariantStockRow(variant, state.locations)
                }
                if (state.loading && state.locations.isEmpty()) {
                    item {
                        Row(
                            Modifier.fillMaxWidth().padding(24.dp),
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            CircularProgressIndicator(Modifier.size(24.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun VariantHeader(locations: List<StockCheckLocation>) {
    val names = locations.map { it.name }.ifEmpty { listOf("Shop", "Warehouse") }
    Row(
        Modifier.fillMaxWidth().background(Handoff.Well2).padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("VARIANT", Modifier.weight(1f), color = Handoff.Muted2, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        names.forEach { name -> StockColumnLabel(name) }
        StockColumnLabel("TOTAL")
    }
}

@Composable
private fun VariantStockRow(
    variant: CatalogVariant,
    locations: List<StockCheckLocation>,
) {
    val shownLocations = if (locations.isEmpty()) listOf<StockCheckLocation?>(null, null) else locations
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(variant.variantLabel.ifBlank { variant.productName }, fontWeight = FontWeight.SemiBold)
            Text(variant.sku, color = Handoff.Muted2, fontSize = 12.sp, fontFamily = PlexMono)
        }
        shownLocations.forEach { location ->
            StockFigure(location?.let { quantityAt(it, variant.id) }?.toString() ?: "—")
        }
        StockFigure(variant.qtyOnHand.toString(), strong = true)
    }
}

@Composable
private fun StockColumnLabel(label: String) {
    Text(
        label.uppercase(),
        Modifier.widthIn(min = 76.dp, max = 110.dp).width(88.dp),
        color = Handoff.Muted2,
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        textAlign = androidx.compose.ui.text.style.TextAlign.End,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun StockFigure(value: String, strong: Boolean = false) {
    Text(
        value,
        Modifier.width(88.dp),
        color = if (strong) Handoff.AccentText else Handoff.Ink,
        fontFamily = PlexMono,
        fontWeight = if (strong) FontWeight.Bold else FontWeight.Medium,
        textAlign = androidx.compose.ui.text.style.TextAlign.End,
    )
}

@Composable
private fun EmptyMessage(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    detail: String,
) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, contentDescription = null, tint = Handoff.Muted3, modifier = Modifier.size(34.dp))
            Spacer(Modifier.height(10.dp))
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(detail, color = Handoff.Muted2, fontSize = 13.sp)
        }
    }
}
