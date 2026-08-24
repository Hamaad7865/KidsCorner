package mu.kidscorner.till.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import kotlinx.coroutines.delay
import mu.kidscorner.till.data.CreditCharge
import mu.kidscorner.till.data.Customer
import mu.kidscorner.till.data.DepositSummaryRow
import mu.kidscorner.till.data.SaleSummary
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * The customer directory: everyone on file, browsable.
 *
 * Two panes, like the deposits screen it mirrors — a list of cards, and the
 * read-only profile a tap opens. Deliberately read-only: looking is not
 * attaching. The only way a customer here reaches checkout is the explicit
 * "Use this customer" action, so browsing can never silently swap whoever is
 * already on the basket.
 */
@Composable
fun CustomersScreen(
    cashierName: String,
    online: Boolean,
    browse: List<Customer>,
    browseLoading: Boolean,
    browseQuery: String,
    browseHasMore: Boolean,
    error: String?,
    profile: Customer?,
    profileCharges: List<CreditCharge>,
    profileBalance: Double,
    profileChargesLoading: Boolean,
    profileSales: List<SaleSummary>,
    profileSalesLoading: Boolean,
    profileDeposits: List<DepositSummaryRow>,
    profileDepositsLoading: Boolean,
    onQuery: (String) -> Unit,
    onLoadMore: () -> Unit,
    onOpenProfile: (Customer) -> Unit,
    onCloseProfile: () -> Unit,
    onUseCustomer: () -> Unit,
    onBack: () -> Unit,
    onDismissError: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Handoff.Surface)) {
        if (profile != null) {
            CustomerProfilePane(
                customer = profile,
                charges = profileCharges,
                balance = profileBalance,
                chargesLoading = profileChargesLoading,
                sales = profileSales,
                salesLoading = profileSalesLoading,
                deposits = profileDeposits,
                depositsLoading = profileDepositsLoading,
                onBack = onCloseProfile,
                onUseCustomer = onUseCustomer,
            )
        } else {
            CustomerListPane(
                cashierName = cashierName,
                online = online,
                customers = browse,
                loading = browseLoading,
                query = browseQuery,
                hasMore = browseHasMore,
                onQuery = onQuery,
                onLoadMore = onLoadMore,
                onOpen = onOpenProfile,
                onBack = onBack,
            )
        }

        error?.let { message ->
            CustomerBrowseErrorBar(
                message,
                modifier = Modifier.align(Alignment.BottomStart),
                onDismiss = onDismissError,
            )
        }
    }
}

// ── the list ─────────────────────────────────────────────────────────────────

@Composable
private fun CustomerListPane(
    cashierName: String,
    online: Boolean,
    customers: List<Customer>,
    loading: Boolean,
    query: String,
    hasMore: Boolean,
    onQuery: (String) -> Unit,
    onLoadMore: () -> Unit,
    onOpen: (Customer) -> Unit,
    onBack: () -> Unit,
) {
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
                    "Customers",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.36).sp,
                    color = Handoff.Ink,
                )
                Text(
                    "$cashierName · everyone on file",
                    fontSize = 12.sp,
                    color = Handoff.Muted3,
                )
            }
            if (!online) {
                Text("Offline", fontSize = 12.sp, color = Handoff.WarnText)
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Debounced like the attach dialog's search: this screen queries a
            // much larger server-paginated dataset, so a keystroke-per-query
            // would hammer the line for results nobody reads.
            var text by remember { mutableStateOf(query) }
            LaunchedEffect(text) {
                delay(300)
                if (text != query) onQuery(text)
            }
            BrowseSearchField(text) { text = it }
        }

        when {
            loading && customers.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                Text("Loading…", color = Handoff.Muted3)
            }
            customers.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Default.People, null,
                        tint = Handoff.Faint, modifier = Modifier.size(40.dp),
                    )
                    Text(
                        if (query.isBlank()) "Nobody on file yet" else "No matches",
                        fontSize = 15.sp, color = Handoff.Muted,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                    Text(
                        "Customers are added from the checkout's Attach dialog",
                        fontSize = 12.5.sp, color = Handoff.Muted3,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
            else -> LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                items(customers, key = { it.id }) { row ->
                    CustomerRow(row) { onOpen(row) }
                }
                if (hasMore || loading) {
                    item(key = "load-more") {
                        Surface(onClick = onLoadMore) { LoadMoreRow(loadingMore = loading) }
                    }
                }
            }
        }
    }
}

@Composable
private fun LoadMoreRow(loadingMore: Boolean) {
    Box(Modifier.fillMaxWidth().height(44.dp), Alignment.Center) {
        if (loadingMore) {
            CircularProgressIndicator(Modifier.size(20.dp), Handoff.AccentSolid, 2.dp)
        } else {
            Text("Load more", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Handoff.AccentText)
        }
    }
}

/**
 * A directory card. Same shell as a deposit row. The trailing balance refines
 * the account-payment label with a fourth case: most people on file were never
 * given an account at all, and showing them "paid up" would be a lie — they
 * get nothing there.
 */
@Composable
private fun CustomerRow(customer: Customer, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(13.dp),
        color = Handoff.Surface,
        contentColor = Handoff.Ink,
        border = androidx.compose.foundation.BorderStroke(1.dp, Handoff.LineSoft),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 15.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Avatar(
                customer.fullName,
                size = 40,
                tint = Handoff.AvatarTint,
                ink = Handoff.AvatarInk,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        customer.fullName,
                        fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.14).sp,
                        maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
                    if (customer.creditOnHold) HeldChip()
                }
                customer.phone?.let {
                    Text(
                        it,
                        fontFamily = PlexMono,
                        fontSize = 12.sp, color = Handoff.Muted3,
                    )
                }
            }
            when {
                !customer.creditEnabled -> Unit
                customer.creditBalance > 0.0 -> Column(horizontalAlignment = Alignment.End) {
                    Text(formatRs(customer.creditBalance), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Text("OWES", fontSize = 9.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.8.sp, color = Handoff.Muted3)
                }
                customer.creditBalance < 0.0 -> Column(horizontalAlignment = Alignment.End) {
                    Text("in credit", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Muted)
                }
                else -> Column(horizontalAlignment = Alignment.End) {
                    Text("paid up", fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Muted)
                }
            }
        }
    }
}

@Composable
private fun HeldChip() {
    Surface(shape = RoundedCornerShape(7.dp), color = Color(0xFFFDF4E6)) {
        Text(
            "ON HOLD",
            fontSize = 9.5.sp, fontWeight = FontWeight.Bold,
            color = Color(0xFFB47A2F),
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

// ── the profile ──────────────────────────────────────────────────────────────

@Composable
private fun CustomerProfilePane(
    customer: Customer,
    charges: List<CreditCharge>,
    balance: Double,
    chargesLoading: Boolean,
    sales: List<SaleSummary>,
    salesLoading: Boolean,
    deposits: List<DepositSummaryRow>,
    depositsLoading: Boolean,
    onBack: () -> Unit,
    onUseCustomer: () -> Unit,
) {
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
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to the list", Modifier.size(20.dp))
                }
            }
            Column(Modifier.weight(1f)) {
                Text(
                    customer.fullName,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.36).sp,
                    color = Handoff.Ink,
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
                Text(
                    customer.phone ?: "no phone number",
                    fontSize = 12.sp,
                    color = Handoff.Muted3,
                    fontFamily = PlexMono,
                )
            }
        }

        // Pinned under the header, outside the scroll: exactly one action, and
        // it is always valid whatever the sections below have loaded.
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp)) {
            HandoffButton(
                label = "Use this customer",
                modifier = Modifier.weight(1f),
                primary = true,
                onClick = onUseCustomer,
            )
        }

        Column(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // The account card, as the server last saw it — the same figure the
            // payment-on-account view pays against, shown read-only.
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Handoff.Well2,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Credit account",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.Ink,
                        )
                        Text(
                            when {
                                !customer.creditEnabled -> "No account opened"
                                customer.creditOnHold -> "Account on hold"
                                balance > 0 -> "owes on their tab"
                                balance < 0 -> "The shop is holding money for them"
                                else -> "Nothing owed"
                            },
                            fontSize = 12.sp,
                            color = Handoff.Muted3,
                        )
                    }
                    if (customer.creditEnabled) {
                        Column(horizontalAlignment = Alignment.End) {
                            Text(
                                formatRs(balance),
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = PlexMono,
                                color = if (balance > 0) Handoff.AccentText else Handoff.InkStrong,
                            )
                            Text(
                                "BALANCE",
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.8.sp,
                                color = Handoff.Muted3,
                            )
                        }
                    }
                }
            }

            SectionCard(title = "OUTSTANDING CHARGES") {
                when {
                    chargesLoading -> SectionSpinner()
                    charges.isEmpty() -> SectionEmpty("Nothing outstanding.")
                    else -> charges.forEach { charge ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    charge.saleNo ?: charge.date.take(10),
                                    fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                                )
                                Text(charge.date.take(10), fontSize = 11.sp, color = Handoff.Muted3)
                            }
                            Text(
                                formatRs(charge.amount),
                                fontFamily = PlexMono,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }

            SectionCard(title = "PURCHASE HISTORY") {
                when {
                    salesLoading -> SectionSpinner()
                    sales.isEmpty() -> SectionEmpty("No purchases yet.")
                    else -> sales.forEach { sale ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(sale.saleNo, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                Text(
                                    buildString {
                                        append(sale.saleDate.take(10))
                                        append(" · ${sale.itemCount} item")
                                        if (sale.itemCount != 1) append("s")
                                        if (sale.status != "completed") append(" · ${sale.status}")
                                    },
                                    fontSize = 11.sp, color = Handoff.Muted3,
                                )
                            }
                            Text(
                                formatRs(sale.total),
                                fontFamily = PlexMono,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }

            SectionCard(title = "DEPOSITS") {
                when {
                    depositsLoading -> SectionSpinner()
                    deposits.isEmpty() -> SectionEmpty("No deposit orders.")
                    else -> deposits.forEach { deposit ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(deposit.orderNo, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                    if (deposit.status != "open") {
                                        Text(
                                            deposit.status.replaceFirstChar { it.uppercase() },
                                            fontSize = 10.sp, color = Handoff.Muted3,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                    } else if (deposit.overdue) {
                                        Text("OVERDUE", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFFB4552F))
                                    }
                                }
                                Text(
                                    "${deposit.unitsTotal - deposit.unitsCollected} of ${deposit.unitsTotal} still held" +
                                        if (deposit.balance > 0) " · ${formatRs(deposit.balance)} owed" else "",
                                    fontSize = 11.sp, color = Handoff.Muted3,
                                )
                            }
                            Text(
                                formatRs(deposit.total),
                                fontFamily = PlexMono,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
        }
    }
}

// ── small shared pieces (file-private, per this codebase's convention) ───────

@Composable
private fun BrowseSearchField(value: String, onValueChange: (String) -> Unit) {
    Box(
        Modifier
            .width(240.dp)
            .height(40.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(Handoff.FieldWell)
            .border(1.dp, Handoff.LineField, RoundedCornerShape(11.dp))
            .padding(horizontal = 12.dp),
        Alignment.CenterStart,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = LocalTextStyle.current.copy(fontSize = 13.sp, color = Handoff.Ink),
            cursorBrush = SolidColor(Handoff.Accent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.Search, null,
                        tint = Handoff.Muted3, modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Box {
                        if (value.isEmpty()) {
                            Text("Search name or phone", fontSize = 12.5.sp, color = Handoff.Muted3)
                        }
                        inner()
                    }
                }
            },
        )
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(13.dp))
            .background(Handoff.Well)
            .border(1.dp, Handoff.LineSoft, RoundedCornerShape(13.dp))
            .padding(horizontal = 14.dp, vertical = 11.dp),
    ) {
        Text(
            title,
            fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.6.sp, color = Handoff.Muted3,
        )
        Column(Modifier.padding(top = 6.dp)) { content() }
    }
}

@Composable
private fun SectionSpinner() {
    Box(Modifier.fillMaxWidth().height(40.dp), Alignment.Center) {
        CircularProgressIndicator(Modifier.size(18.dp), Handoff.AccentSolid, 2.dp)
    }
}

@Composable
private fun SectionEmpty(message: String) {
    Text(message, fontSize = 12.5.sp, color = Handoff.Muted3, modifier = Modifier.padding(vertical = 6.dp))
}

@Composable
private fun CustomerBrowseErrorBar(
    message: String,
    modifier: Modifier = Modifier,
    onDismiss: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = Color(0xFFFDECE6),
        modifier = modifier
            .clickable(onClick = onDismiss)
            .padding(16.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(message, fontSize = 12.5.sp, color = Color(0xFFB4552F), modifier = Modifier.weight(1f))
            Icon(Icons.Default.Close, "Dismiss", Modifier.size(16.dp), tint = Color(0xFFB4552F))
        }
    }
}
