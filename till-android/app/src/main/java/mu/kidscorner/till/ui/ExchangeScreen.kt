package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PhoneAndroid
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.CatalogVariant
import mu.kidscorner.till.data.SaleDetail
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * The exchange screen.
 *
 * Left: the original sale's lines, each with a stepper for how many come
 * back, and beneath them a catalogue search that adds replacement variants.
 * Right: the gap — what the replacements cost today minus the credit for what
 * came back — as one 44px mono figure.
 *
 * Nothing here decides money. `create_exchange` re-prices both sides: the
 * return at what the customer actually paid, the replacements at today's
 * list price read from `product_variants`. The figure on this screen is a
 * quote — and it settles in either direction: the customer pays when the
 * replacements cost more, the shop pays back when they cost less, through
 * whichever method is picked below.
 */
@Composable
fun ExchangeScreen(
    sale: SaleDetail,
    /** Variant → how many are still exchangeable on that line. */
    alreadyReturned: Map<Int, Int>,
    catalog: List<CatalogVariant>,
    paymentMethods: List<String>,
    busy: Boolean,
    error: String?,
    onBack: () -> Unit,
    onExchange: (Map<Int, Int>, List<Pair<Int, Int>>, String, Double?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var returnQty by remember(sale.id) { mutableStateOf(mapOf<Int, Int>()) }
    val newItems = remember { mutableStateOf(listOf<Pair<CatalogVariant, Int>>()) }
    var query by remember(sale.id) { mutableStateOf("") }
    var method by remember(sale.id) {
        mutableStateOf(sale.payments.firstOrNull()?.method ?: "cash")
    }
    var tenderedText by remember(sale.id) { mutableStateOf("") }

    fun returnable(line: mu.kidscorner.till.data.SaleDetailLine): Int =
        (line.qty - (alreadyReturned[line.id] ?: 0)).coerceAtLeast(0)

    // Same fraction a Return quotes: what was paid net of basket discount, as
    // a share of the lines' listed prices.
    val paidFactor = if (sale.subtotal > 0) sale.total / sale.subtotal else 1.0

    fun unitPaid(line: mu.kidscorner.till.data.SaleDetailLine): Double =
        if (line.qty > 0) round2((line.lineTotal / line.qty) * paidFactor) else 0.0

    // Shared by the size-swap chips and the catalogue search below — adding a
    // replacement is the same operation everywhere it can be started from.
    fun addReplacement(v: CatalogVariant) {
        val existing = newItems.value.firstOrNull { it.first.id == v.id }
        newItems.value = if (existing == null) {
            newItems.value + (v to 1)
        } else {
            newItems.value.map { (e, q) -> if (e.id == v.id) e to q + 1 else e to q }
        }
    }

    // The everyday exchange: same product, same colour, a different size — a
    // Large that no longer fits, back for a Small. Listed by size order so the
    // run reads the way a size chart does, with the returned size itself left
    // out (there is nothing to swap it for).
    fun sameSizeSwaps(line: mu.kidscorner.till.data.SaleDetailLine): List<CatalogVariant> =
        catalog.filter {
            it.productName == line.productName &&
                it.colourName == line.colourName &&
                it.sizeLabel != line.sizeLabel
        }.sortedBy { it.sizeSort }

    val creditTotal = round2(
        sale.lines.sumOf { line -> unitPaid(line) * (returnQty[line.id] ?: 0) },
    )
    // Display-only list price; the server re-prices from product_variants.
    val newTotal = round2(newItems.value.sumOf { (v, q) -> v.price * q })
    val gap = round2(newTotal - creditTotal)
    val count = returnQty.values.sum()
    val ready = creditTotal > 0 && newItems.value.isNotEmpty() && !busy

    // Same four fields the sell screen's own catalogue search matches
    // (groupsFor in SellScreen.kt) — a replacement is picked from the same
    // catalogue, so it should be findable the same ways: by name, SKU, the
    // shelf's product code, or a scanned barcode.
    val results = remember(query, catalog) {
        val q = query.trim().lowercase()
        if (q.length < 2) emptyList() else catalog.filter {
            it.productName.lowercase().contains(q) ||
                it.sku.lowercase().contains(q) ||
                it.productCode.orEmpty().lowercase().contains(q) ||
                it.barcode.orEmpty().lowercase().contains(q)
        }.take(6)
    }

    Row(modifier.fillMaxSize().background(Handoff.Canvas)) {

        // ══════════════════════════════ coming back · going out ═════════════
        Column(
            Modifier
                .weight(1f)
                .fillMaxHeight()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 20.dp),
        ) {
            Row(
                Modifier.padding(bottom = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SquareKey(onClick = onBack, size = 48) {
                    Icon(
                        Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                        "Back to selling",
                        Modifier.size(18.dp),
                    )
                }
                Column {
                    Text(
                        "Exchange items",
                        fontSize = 18.sp,
                        lineHeight = 22.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.36).sp,
                        color = Handoff.Ink,
                    )
                    Text(
                        buildString {
                            append(sale.saleNo)
                            append(" · ")
                            append(sale.saleDate.take(16).replace('T', ' '))
                        },
                        fontSize = 12.5.sp,
                        color = Handoff.Muted3,
                    )
                }
            }

            // ── what comes back ─────────────────────────────────────────────
            Surface(
                shape = RoundedCornerShape(13.dp),
                color = Handoff.Surface,
                border = BorderStroke(1.dp, Handoff.LineSoft),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp)) {
                    sale.lines.forEach { line ->
                        val max = returnable(line)
                        val picked = returnQty[line.id] ?: 0
                        Column {
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        line.productName,
                                        fontSize = 14.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Handoff.Ink,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        listOf(line.colourName, line.sizeLabel)
                                            .filter { it.isNotBlank() && it != "—" }
                                            .joinToString(" · ")
                                            .ifBlank { line.sku } +
                                            "  ·  paid ${formatRs(unitPaid(line))}",
                                        fontSize = 12.sp,
                                        color = Handoff.Muted2,
                                    )
                                }
                                Row(
                                    Modifier
                                        .clip(RoundedCornerShape(11.dp))
                                        .border(1.dp, Handoff.LineField, RoundedCornerShape(11.dp)),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    StepperKey(Icons.Default.Remove, "Fewer", picked > 0) {
                                        returnQty = returnQty + (line.id to picked - 1)
                                    }
                                    Text(
                                        picked.toString(),
                                        Modifier.width(46.dp),
                                        fontFamily = PlexMono,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                        color = if (picked > 0) Handoff.AccentSolid else Handoff.Fainter,
                                    )
                                    StepperKey(Icons.Default.Add, "More", picked < max) {
                                        returnQty = returnQty + (line.id to picked + 1)
                                    }
                                }
                                Text(
                                    if (picked > 0) "+${formatAmount(unitPaid(line) * picked)}" else "—",
                                    Modifier.width(96.dp),
                                    fontFamily = PlexMono,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                                    color = if (picked > 0) Handoff.InkFigure else Handoff.Fainter,
                                )
                            }
                            // The one-tap path for the exchange this screen exists
                            // for: this line is coming back, and the same product
                            // in another size can go straight into Replacements
                            // without typing a single letter into search.
                            if (picked > 0) {
                                val swaps = sameSizeSwaps(line)
                                if (swaps.isNotEmpty()) {
                                    Row(
                                        Modifier.padding(start = 12.dp),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    ) {
                                        swaps.forEach { v ->
                                            SizeSwapChip(v.sizeLabel) { addReplacement(v) }
                                        }
                                    }
                                }
                            }
                            Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineFaint))
                        }
                    }

                    Row(
                        Modifier.padding(top = 12.dp, bottom = 2.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlineKey("Return everything") {
                            returnQty = sale.lines.associate { it.id to returnable(it) }
                                .filterValues { it > 0 }
                        }
                        OutlineKey("Clear selection", muted = true) { returnQty = emptyMap() }
                    }
                }
            }

            // ── what goes out ───────────────────────────────────────────────
            Surface(
                shape = RoundedCornerShape(13.dp),
                color = Handoff.Surface,
                border = BorderStroke(1.dp, Handoff.LineSoft),
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            ) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp)) {
                    Text(
                        "REPLACEMENTS",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.1.sp,
                        color = Handoff.Muted3,
                        modifier = Modifier.padding(bottom = 9.dp),
                    )

                    newItems.value.forEach { (variant, qty) ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(9.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    variant.productName,
                                    fontSize = 13.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Handoff.Ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    listOfNotNull(
                                        variant.colourName.takeIf { it.isNotBlank() && it != "—" },
                                        variant.sizeLabel.takeIf { it.isNotBlank() && it != "—" },
                                    ).joinToString(" · ") + "  ·  ${formatRs(variant.price)} today",
                                    fontSize = 11.5.sp,
                                    color = Handoff.Muted2,
                                )
                            }
                            OutlineKey("−") {
                                val next = qty - 1
                                newItems.value = if (next <= 0) {
                                    newItems.value.filter { (v, _) -> v.id != variant.id }
                                } else {
                                    newItems.value.map { (v, q) -> if (v.id == variant.id) v to next else v to q }
                                }
                            }
                            OutlineKey("+") {
                                newItems.value = newItems.value.map { (v, q) -> if (v.id == variant.id) v to qty + 1 else v to q }
                            }
                        }
                    }
                    if (newItems.value.isEmpty()) {
                        Text(
                            "Search the catalogue below and add what the customer is taking instead.",
                            fontSize = 12.sp,
                            color = Handoff.Muted3,
                        )
                    }

                    Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineFaint).padding(top = 10.dp))

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Search, null, tint = Handoff.Muted4, modifier = Modifier.size(16.dp))
                        androidx.compose.foundation.text.BasicTextField(
                            value = query,
                            onValueChange = { query = it },
                            singleLine = true,
                            textStyle = androidx.compose.ui.text.TextStyle(
                                fontSize = 14.sp,
                                color = Handoff.Ink,
                            ),
                            cursorBrush = androidx.compose.ui.graphics.SolidColor(Handoff.Accent),
                            decorationBox = { inner ->
                                Box {
                                    if (query.isEmpty()) {
                                        Text("Search name or SKU…", fontSize = 13.sp, color = Handoff.Muted3)
                                    }
                                    inner()
                                }
                            },
                            modifier = Modifier.weight(1f).padding(start = 8.dp),
                        )
                    }

                    results.forEach { v ->
                        Row(
                            Modifier.fillMaxWidth().padding(top = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(9.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    "${v.productName} — ${listOf(v.colourName, v.sizeLabel).filter { it.isNotBlank() && it != "—" }.joinToString("·")}",
                                    fontSize = 13.sp,
                                    color = Handoff.Ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Text(formatRs(v.price), fontFamily = PlexMono, fontSize = 13.sp, color = Handoff.Muted)
                            OutlineKey("Add") {
                                addReplacement(v)
                                query = ""
                            }
                        }
                    }
                }
            }
        }

        // ════════════════════════════════════════════ the gap ═══════════════
        Box(Modifier.fillMaxHeight().width(1.dp).background(Handoff.LineChrome))

        Column(
            Modifier
                .width(392.dp)
                .fillMaxHeight()
                .background(Handoff.Surface)
                .padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 18.dp),
        ) {
            Text(
                if (gap < 0) "REFUND TO CUSTOMER" else "CUSTOMER PAYS",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.1.sp,
                color = if (gap != 0.0 && count > 0) Handoff.ChangeLabel else Handoff.Muted3,
            )
            Text(
                formatRs(kotlin.math.abs(gap)),
                fontFamily = PlexMono,
                fontSize = 44.sp,
                lineHeight = 48.4.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-1.76).sp,
                color = if (ready) Handoff.ChangeFigure else Handoff.Faint,
                modifier = Modifier.padding(top = 2.dp),
            )
            Text(
                buildString {
                    append("$count ${if (count == 1) "item" else "items"} back · ")
                    append("${newItems.value.sumOf { it.second }} going out")
                },
                fontSize = 12.5.sp,
                color = Handoff.Muted3,
                modifier = Modifier.padding(top = 4.dp),
            )
            Text(
                "SETTLE THE GAP BY",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.1.sp,
                color = Handoff.Muted3,
                modifier = Modifier.padding(top = 18.dp, bottom = 8.dp),
            )
            val methods = paymentMethods.filter { it != "credit" }
            methods.chunked(2).forEach { pair ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    pair.forEach { id ->
                        MethodKey(
                            label = methodLabel(id),
                            icon = exchangeMethodIcon(id),
                            selected = method == id,
                            modifier = Modifier.weight(1f),
                        ) { method = id }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }

            if (method == "cash" && gap > 0) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text("CASH GIVEN", fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.1.sp, color = Handoff.Muted3)
                    androidx.compose.foundation.text.BasicTextField(
                        value = tenderedText,
                        onValueChange = { next -> if (next.all { it.isDigit() || it == '.' } && next.length <= 9) tenderedText = next },
                        singleLine = true,
                        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 15.sp, color = Handoff.Ink),
                        cursorBrush = androidx.compose.ui.graphics.SolidColor(Handoff.Accent),
                        decorationBox = { inner ->
                            Box {
                                if (tenderedText.isEmpty()) {
                                    Text(gap.toString(), fontSize = 15.sp, color = Handoff.Fainter)
                                }
                                inner()
                            }
                        },
                        modifier = Modifier.width(140.dp),
                    )
                }
            }

            error?.let {
                Text(
                    it,
                    fontSize = 12.5.sp,
                    color = Handoff.Danger,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }

            Spacer(Modifier.weight(1f))

            if (ready) {
                Surface(
                    onClick = {
                        val tendered = if (method == "cash" && gap > 0) tenderedText.toDoubleOrNull() ?: gap else null
                        onExchange(
                            returnQty.filterValues { it > 0 },
                            newItems.value.map { (v, q) -> v.id to q },
                            method,
                            tendered,
                        )
                    },
                    shape = RoundedCornerShape(14.dp),
                    color = Handoff.AccentSolid,
                    contentColor = Color.White,
                    shadowElevation = 6.dp,
                    modifier = Modifier.fillMaxWidth().height(68.dp),
                ) {
                    Row(
                        Modifier.fillMaxSize().padding(horizontal = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Exchange", fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Text(
                            formatRs(kotlin.math.abs(gap)),
                            fontFamily = PlexMono,
                            fontSize = 21.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(68.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Handoff.Blocked),
                    Alignment.Center,
                ) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(26.dp), Handoff.AccentSolid, 2.dp)
                    } else {
                        Text(
                            if (creditTotal <= 0) "Pick what is coming back" else "Add what is going out",
                            fontSize = 15.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.BlockedText,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StepperKey(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        color = Handoff.FieldWell,
        contentColor = if (enabled) Handoff.InkStrong else Handoff.Fainter,
        modifier = Modifier.size(48.dp),
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Icon(icon, label, Modifier.size(16.dp))
        }
    }
}

@Composable
private fun OutlineKey(label: String, muted: Boolean = false, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(11.dp),
        color = Handoff.Surface,
        contentColor = if (muted) Handoff.Muted else Handoff.InkStrong,
        border = BorderStroke(1.dp, Handoff.Line),
        modifier = Modifier.height(40.dp),
    ) {
        Box(Modifier.fillMaxHeight().padding(horizontal = 13.dp), Alignment.Center) {
            Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

/** One size, one tap, straight into Replacements — the Large-for-a-Small swap. */
@Composable
private fun SizeSwapChip(sizeLabel: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        color = Handoff.AccentTint,
        contentColor = Handoff.AccentSolid,
        border = BorderStroke(1.dp, Handoff.AccentSolid),
        modifier = Modifier.height(30.dp),
    ) {
        Box(Modifier.fillMaxHeight().padding(horizontal = 11.dp), Alignment.Center) {
            Text(sizeLabel, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}

@Composable
private fun MethodKey(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = if (selected) Handoff.AccentTint else Handoff.Surface,
        contentColor = Handoff.Ink,
        border = BorderStroke(1.dp, if (selected) Handoff.AccentSolid else Handoff.LineSoft),
        modifier = modifier.height(58.dp),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Box(
                Modifier.size(36.dp).clip(RoundedCornerShape(9.dp)).background(Handoff.Well),
                Alignment.Center,
            ) {
                Icon(icon, null, tint = Handoff.Muted, modifier = Modifier.size(18.dp))
            }
            Text(label, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** Shared with RefundScreen's wording so the two screens speak alike. */
private fun exchangeMethodIcon(method: String): androidx.compose.ui.graphics.vector.ImageVector = when (method) {
    "cash" -> Icons.Default.Payments
    "card" -> Icons.Default.CreditCard
    "bank" -> Icons.Default.AccountBalance
    else -> Icons.Default.PhoneAndroid
}

private fun methodLabel(method: String, prefix: String = ""): String = when (method) {
    "cash" -> "Cash"
    "card" -> "Card"
    "juice" -> "Juice"
    "myt_money" -> "my.t money"
    "bank" -> "Bank transfer"
    else -> method
}
