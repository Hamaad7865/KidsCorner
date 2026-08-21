package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import mu.kidscorner.till.data.Customer
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * A customer walking in to pay their tab.
 *
 * The counter-side twin of the back office's "Record a payment". Two steps, in
 * the order the conversation happens: find the customer (their balance rides
 * along on every search result), then take the money and say how it arrived.
 *
 * The amount is checked in the DATABASE, not here. The dialog clamps the input
 * for politeness — nobody should type Rs 500 against a Rs 350 tab and hit an
 * error they could have been told about — but the refusal for a balance that
 * moved between the search and the press comes from `settle_customer_credit`,
 * which re-reads the ledger under a lock. What is typed here can never make the
 * shop record money it was not actually handed.
 *
 * One rule the dialog does own, and it is the drawer's: cash needs an open
 * shift, because the payment is recorded INTO that drawer. With no shift open
 * the chip is simply not offered, and the note says why.
 */
@Composable
fun AccountPaymentDialog(
    results: List<Customer>,
    searching: Boolean,
    searchError: String?,
    busy: Boolean,
    error: String?,
    done: Boolean,
    /** Whether the drawer is open, which decides whether cash is on offer. */
    shiftOpen: Boolean,
    onSearch: (String) -> Unit,
    onSettle: (customerId: Int, amount: Double, method: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<Customer?>(null) }
    var amount by remember { mutableStateOf("") }
    var method by remember { mutableStateOf("") }

    // Closes itself once the server has taken it, exactly like MovementDialog.
    LaunchedEffect(done) { if (done) onDismiss() }

    // Debounced: the same scanner-speed typist the customer picker serves.
    LaunchedEffect(query) {
        delay(300)
        if (picked == null) onSearch(query)
    }

    // Cash first only while a shift is open; otherwise the first method that
    // can still be taken is card, and the cashier sees the reason beside it.
    val cashable = shiftOpen
    val methods = remember(cashable) {
        listOfNotNull(
            "cash".takeIf { cashable },
            "card",
            "bank",
            "juice",
            "myt_money",
        )
    }
    val methodName = methodLabel(method)

    HandoffDialog(
        title = "Payment on account",
        width = 620,
        maxHeight = 700,
        divided = false,
        onDismiss = onDismiss,
    ) {
        val customer = picked

        if (customer == null) {
            Box(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 12.dp)) {
                HandoffField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = "Phone number or name…",
                )
            }

            Column(Modifier.weight(1f, fill = false).padding(horizontal = 20.dp)) {
                Text(
                    when {
                        searching -> "SEARCHING"
                        query.length < 2 -> "WHO IS PAYING?"
                        results.isEmpty() -> "NO MATCH"
                        else -> "${results.size} FOUND"
                    },
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.05.sp,
                    color = Handoff.Muted3,
                    modifier = Modifier.padding(top = 4.dp, bottom = 6.dp),
                )

                if (searching) {
                    Box(Modifier.fillMaxWidth().height(60.dp), Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(22.dp), Handoff.AccentSolid, 2.dp)
                    }
                } else {
                    searchError?.let {
                        Text(it, fontSize = 12.5.sp, color = Handoff.Danger)
                    }

                    LazyColumn(Modifier.heightIn(max = 320.dp)) {
                        items(results, key = { it.id }) { row ->
                            Surface(
                                onClick = {
                                    picked = row
                                    // The whole tab, ready to take. Defaulting to
                                    // the balance is the honest first offer — a
                                    // part payment is a deliberate edit, and a
                                    // cashier should not have to type a figure
                                    // just to do the ordinary thing.
                                    amount = trimZeros(row.creditBalance)
                                    method = ""
                                },
                                color = androidx.compose.ui.graphics.Color.Transparent,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column {
                                    Row(
                                        Modifier.padding(horizontal = 10.dp, vertical = 11.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    ) {
                                        Avatar(
                                            row.fullName,
                                            size = 40,
                                            tint = Handoff.AvatarTint,
                                            ink = Handoff.AvatarInk,
                                        )
                                        Column(Modifier.weight(1f)) {
                                            Text(
                                                row.fullName,
                                                fontSize = 15.sp,
                                                fontWeight = FontWeight.SemiBold,
                                                color = Handoff.Ink,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                            row.phone?.let {
                                                Text(
                                                    it,
                                                    fontFamily = PlexMono,
                                                    fontSize = 12.5.sp,
                                                    color = Handoff.Muted3,
                                                )
                                            }
                                        }
                                        Column(horizontalAlignment = Alignment.End) {
                                            Text(
                                                if (row.owes) formatRs(row.creditBalance)
                                                else if (row.creditBalance < 0) "in credit"
                                                else "paid up",
                                                fontSize = 13.sp,
                                                fontWeight = FontWeight.SemiBold,
                                                fontFamily = PlexMono,
                                                color = if (row.owes) Handoff.InkStrong else Handoff.Muted3,
                                            )
                                            if (row.owes) {
                                                Text(
                                                    "OWES",
                                                    fontSize = 9.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    letterSpacing = 0.8.sp,
                                                    color = Handoff.Muted3,
                                                )
                                            }
                                        }
                                    }
                                    Box(
                                        Modifier.fillMaxWidth().height(1.dp)
                                            .background(Handoff.LineFaint),
                                    )
                                }
                            }
                        }
                    }

                    if (query.length >= 2 && results.isEmpty()) {
                        Text(
                            "No customer matches. Accounts are opened in the back office.",
                            fontSize = 12.5.sp,
                            color = Handoff.Muted3,
                            modifier = Modifier.padding(vertical = 10.dp),
                        )
                    }
                }
            }
        } else {
            Column(
                Modifier.padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // The balance as the server last saw it, under the name it
                // belongs to. Deliberately plain: this is the figure being paid
                // against, and the arithmetic is the only thing that matters.
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
                                customer.fullName,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Handoff.Ink,
                            )
                            Text(
                                if (customer.owes) {
                                    "paying against the tab"
                                } else if (customer.creditBalance < 0) {
                                    "The shop is holding money for them"
                                } else {
                                    "Nothing owed"
                                },
                                fontSize = 12.sp,
                                color = Handoff.Muted3,
                            )
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(
                                formatRs(customer.creditBalance),
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = PlexMono,
                                color = if (customer.owes) Handoff.AccentText else Handoff.InkStrong,
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

                FieldLabel("Amount received")
                HandoffField(
                    value = amount,
                    onValueChange = { next ->
                        val dot = next.indexOf('.')
                        val ok = next.all { it.isDigit() || it == '.' } &&
                            next.count { it == '.' } <= 1 &&
                            (dot < 0 || next.length - dot - 1 <= 2)
                        if (ok && next.length <= 10) amount = next
                    },
                    placeholder = "0.00",
                    keyboard = KeyboardType.Decimal,
                    mono = true,
                    enabled = !busy,
                )

                FieldLabel("How it was paid")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    methods.forEach { candidate ->
                        val selected = method == candidate
                        Surface(
                            onClick = { method = candidate },
                            enabled = !busy,
                            shape = RoundedCornerShape(12.dp),
                            color = if (selected) Handoff.AccentTint else Handoff.Surface,
                            contentColor = if (selected) Handoff.AccentText else Handoff.Ink,
                            border = BorderStroke(
                                1.dp,
                                if (selected) Handoff.AccentSolid else Handoff.LineSoft,
                            ),
                            modifier = Modifier.weight(1f).height(56.dp),
                        ) {
                            Box(Modifier.fillMaxSize(), Alignment.Center) {
                                Text(
                                    methodLabel(candidate),
                                    fontSize = 13.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
                if (!cashable) {
                    Text(
                        "No shift open, so cash cannot be taken — it would have no drawer to be counted in.",
                        fontSize = 12.sp,
                        color = Handoff.Muted3,
                    )
                }

                val typed = amount.toDoubleOrNull() ?: 0.0
                // Shown, never enforced: the server re-checks under a lock. But
                // nobody should have to hit an error for a figure this dialog
                // already knew was wrong.
                val overBalance = customer.owes && typed > customer.creditBalance

                error?.let { Text(it, fontSize = 12.5.sp, color = Handoff.Danger) }

                HandoffButton(
                    label = when {
                        busy -> "Recording…"
                        method == "cash" -> "Take ${formatAmount(round2(typed))} cash"
                        method.isBlank() -> "Choose how it was paid"
                        else -> "Record ${formatAmount(round2(typed))} · ${methodName}"
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !busy && typed > 0 && method.isNotBlank() && !overBalance,
                ) { onSettle(customer.id, round2(typed), method) }

                if (overBalance) {
                    Text(
                        "${customer.fullName} only owes ${formatRs(customer.creditBalance)} — the payment cannot be more than that.",
                        fontSize = 12.5.sp,
                        color = Handoff.Danger,
                    )
                }
            }
        }
    }
}

/** "1234.5" -> "1234.50", without the thousands the entry box dislikes. */
private fun trimZeros(value: Double): String {
    if (value <= 0) return ""
    val whole = value.toLong()
    val cents = Math.round((value - whole) * 100)
    return if (cents == 0L) "$whole" else "$whole.${cents.toString().padStart(2, '0')}"
}
