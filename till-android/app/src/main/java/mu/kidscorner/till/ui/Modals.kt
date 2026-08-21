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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import mu.kidscorner.till.data.AppliedDiscountLocal
import mu.kidscorner.till.data.Cashier
import mu.kidscorner.till.data.Customer
import mu.kidscorner.till.data.DiscountRule
import mu.kidscorner.till.data.HeldSale
import mu.kidscorner.till.data.formatAmount
import mu.kidscorner.till.data.formatQty
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.heldAgo
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * `modalCustomer` — 580px.
 *
 * A 56px search field on `#F7FAFA`, then results as borderless rows with an
 * avatar, separated by hairlines rather than boxed. The design keeps the list
 * quiet because it is scanned, not read.
 *
 * Searched on the server rather than from a cached list: a shop's customers are
 * names and phone numbers, and there is no reason for all of them to sit on a
 * tablet that lives on a counter.
 */
@Composable
fun CustomerDialog(
    results: List<Customer>,
    searching: Boolean,
    error: String?,
    attachedCustomerId: Int?,
    onSearch: (String) -> Unit,
    onPick: (Customer) -> Unit,
    onCreate: (String, String?, Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var adding by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }
    var newPhone by remember { mutableStateOf("") }
    var openAccount by remember { mutableStateOf(false) }
    var createRequested by remember { mutableStateOf(false) }

    // Debounced: a scanner-speed typist would otherwise fire a query per
    // keystroke at a server the shop reaches over a shaky line.
    LaunchedEffect(query) {
        delay(300)
        onSearch(query)
    }

    // A successful "Add and attach" changes which customer is attached, so a
    // change in that id — but only one this dialog itself asked for — is the
    // signal to close. Keying on the id rather than closing unconditionally on
    // any non-null value means reopening this dialog on a sale that already
    // has a customer attached doesn't instantly close it again.
    LaunchedEffect(attachedCustomerId) {
        if (createRequested && attachedCustomerId != null) onDismiss()
    }

    HandoffDialog(
        title = "Attach customer",
        width = 580,
        maxHeight = 660,
        divided = false,
        onDismiss = onDismiss,
    ) {
        if (!adding) {
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
                        query.length < 2 -> "RECENT"
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
                    LazyColumn(Modifier.heightIn(max = 300.dp)) {
                        items(results, key = { it.id }) { customer ->
                            Surface(
                                onClick = { onPick(customer) },
                                color = Color.Transparent,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column {
                                    Row(
                                        Modifier.padding(horizontal = 10.dp, vertical = 11.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    ) {
                                        Avatar(
                                            customer.fullName,
                                            size = 40,
                                            tint = Handoff.AvatarTint,
                                            ink = Handoff.AvatarInk,
                                        )
                                        Column(Modifier.weight(1f)) {
                                            Text(
                                                customer.fullName,
                                                fontSize = 15.sp,
                                                fontWeight = FontWeight.SemiBold,
                                                color = Handoff.Ink,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                            )
                                            customer.phone?.let {
                                                Text(
                                                    it,
                                                    fontFamily = PlexMono,
                                                    fontSize = 12.5.sp,
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
                            "No customer matches. Add them below.",
                            fontSize = 12.5.sp,
                            color = Handoff.Muted3,
                            modifier = Modifier.padding(vertical = 10.dp),
                        )
                    }
                }
            }
        } else {
            Column(
                Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                FieldLabel("Name")
                HandoffField(newName, { newName = it }, "e.g. Marie Appadoo")
                FieldLabel("Mobile")
                HandoffField(
                    newPhone,
                    { newPhone = it },
                    "5xxx xxxx",
                    keyboard = KeyboardType.Phone,
                    mono = true,
                )

                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(11.dp))
                        .background(Handoff.FieldWell)
                        .border(1.dp, Handoff.LineIdle, RoundedCornerShape(11.dp))
                        .padding(horizontal = 13.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(11.dp),
                ) {
                    HandoffToggle(openAccount) { openAccount = !openAccount }
                    Column {
                        Text(
                            "Open a credit account",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.Ink,
                        )
                        Text(
                            // No ceiling any more, so this really does mean "any
                            // amount" — the cashier should read it out as such.
                            "Lets them buy on account. No limit, so a manager has to approve it.",
                            fontSize = 11.5.sp,
                            color = Handoff.Muted3,
                        )
                    }
                }

                error?.let {
                    Text(it, fontSize = 12.5.sp, color = Handoff.Danger)
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(20.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            HandoffButton(
                label = if (adding) "Back to search" else "Add a new customer",
                modifier = Modifier.weight(1f),
                primary = false,
                onClick = { adding = !adding },
            )
            if (adding) {
                HandoffButton(
                    label = if (searching) "Adding…" else "Add and attach",
                    modifier = Modifier.weight(1f),
                    enabled = newName.trim().length >= 2 && !searching,
                    onClick = {
                        createRequested = true
                        onCreate(newName.trim(), newPhone.trim().ifBlank { null }, openAccount)
                    },
                )
            }
        }
    }
}

/**
 * `modalHeld` — 640px.
 *
 * Rows of `padding:14px 0` separated by hairlines: avatar, who and meta, the
 * total in mono, then a solid Resume key. The subtitle is the design's own and
 * is worth keeping — "Parked carts stay on this till until the end of the
 * shift" is exactly the thing a cashier needs told.
 */
@Composable
fun HeldSalesDialog(
    held: List<HeldSale>,
    cartBusy: Boolean,
    onResume: (String) -> Unit,
    onDiscard: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    /**
     * Which sale's bin has been tapped once.
     *
     * Discarding is instant and there is no undo: the parked basket is gone
     * and the customer who is off finding another size comes back to nothing.
     * The bin sat directly beside Resume, both under a thumb. Arming it on the
     * first tap is the same answer "Clear sale?" already uses on the sell
     * screen, and it costs a deliberate second tap rather than a dialog.
     *
     * Holding the id rather than a boolean means arming one row disarms any
     * other by construction.
     */
    var arming by remember { mutableStateOf<String?>(null) }

    HandoffDialog(
        title = "Held sales",
        subtitle = "Parked carts stay on this till until the end of the shift.",
        width = 640,
        maxHeight = 620,
        onDismiss = onDismiss,
    ) {
        if (held.isEmpty()) {
            Box(
                Modifier.fillMaxWidth().height(160.dp).padding(20.dp),
                Alignment.Center,
            ) {
                Text(
                    "No held sales. Tap Hold on the cart to park one.",
                    fontSize = 13.5.sp,
                    color = Handoff.Muted3,
                )
            }
        } else {
            if (cartBusy) {
                Text(
                    "Finish or park the current basket before resuming another.",
                    fontSize = 12.5.sp,
                    color = Handoff.Danger,
                    modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 10.dp),
                )
            }
            LazyColumn(
                Modifier.heightIn(max = 420.dp)
                    .padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 16.dp),
            ) {
                items(held, key = { it.id }) { sale ->
                    Column {
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            Avatar(
                                sale.label,
                                size = 42,
                                tint = Handoff.AvatarTint,
                                ink = Handoff.AvatarInk,
                            )
                            Column(Modifier.weight(1f)) {
                                Text(
                                    sale.label,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    letterSpacing = (-0.15).sp,
                                    color = Handoff.Ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    // `h.meta` — "4 items · held 6 min ago"
                                    "${formatQty(sale.itemCount)} " +
                                        (if (sale.itemCount == 1) "item" else "items") +
                                        " · held ${heldAgo(sale.heldAt)}",
                                    fontSize = 12.5.sp,
                                    color = Handoff.Muted3,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(top = 3.dp),
                                )
                            }
                            Text(
                                formatAmount(sale.total),
                                fontFamily = PlexMono,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Handoff.InkFigure,
                            )
                            HandoffButton(
                                label = "Resume",
                                enabled = !cartBusy,
                                onClick = {
                                    arming = null
                                    onResume(sale.id)
                                },
                            )
                            val armed = arming == sale.id
                            Surface(
                                onClick = {
                                    if (armed) {
                                        arming = null
                                        onDiscard(sale.id)
                                    } else {
                                        arming = sale.id
                                    }
                                },
                                shape = RoundedCornerShape(11.dp),
                                color = if (armed) Handoff.DangerTint else Color.Transparent,
                                contentColor =
                                    if (armed) Handoff.Danger else Handoff.Muted4,
                                border =
                                    if (armed) BorderStroke(1.dp, Handoff.DangerLine) else null,
                                modifier =
                                    if (armed) Modifier.height(48.dp) else Modifier.size(48.dp),
                            ) {
                                Box(
                                    Modifier.fillMaxHeight()
                                        .padding(horizontal = if (armed) 14.dp else 0.dp),
                                    Alignment.Center,
                                ) {
                                    if (armed) {
                                        Text(
                                            "Discard?",
                                            fontSize = 13.5.sp,
                                            fontWeight = FontWeight.Bold,
                                        )
                                    } else {
                                        Icon(
                                            Icons.Default.Delete,
                                            "Discard",
                                            Modifier.size(17.dp),
                                        )
                                    }
                                }
                            }
                        }
                        Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineFaint))
                    }
                }
            }
        }
    }
}

/**
 * A manager typing their PIN to authorise a discount.
 *
 * The PIN goes with the sale rather than being exchanged for a token here. Any
 * approval this device mints can be forged by whoever holds it, which on a
 * shared till is every cashier — so the only thing that counts is knowledge of
 * the PIN, checked server-side at the moment money moves.
 */
@Composable
fun ManagerApprovalDialog(
    managers: List<Cashier>,
    reason: String,
    busy: Boolean,
    onApprove: (String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var selected by remember(managers) { mutableStateOf(managers.firstOrNull { it.hasPin }) }
    var pin by remember { mutableStateOf("") }

    HandoffDialog(
        title = "Manager approval",
        subtitle = reason,
        width = 580,
        maxHeight = 600,
        onDismiss = onDismiss,
    ) {
        Column(
            Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (managers.none { it.hasPin }) {
                Text(
                    "No owner or manager has a PIN set. An owner sets one in Settings → Staff.",
                    fontSize = 13.sp,
                    color = Handoff.Danger,
                )
            }

            managers.filter { it.hasPin }.forEach { manager ->
                val isSelected = selected?.id == manager.id
                Surface(
                    onClick = { selected = manager; pin = "" },
                    shape = RoundedCornerShape(12.dp),
                    color = if (isSelected) Handoff.AccentTint else Handoff.Surface,
                    contentColor = if (isSelected) Handoff.AccentText else Handoff.Ink,
                    border = BorderStroke(
                        1.dp,
                        if (isSelected) Handoff.AccentSolid else Handoff.LineSoft,
                    ),
                    modifier = Modifier.fillMaxWidth().height(60.dp),
                ) {
                    Row(
                        Modifier.padding(horizontal = 14.dp).fillMaxHeight(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(manager.fullName, size = 34, solid = isSelected)
                        Text(
                            manager.fullName,
                            Modifier.weight(1f),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(manager.role, fontSize = 12.sp, color = Handoff.Muted3)
                    }
                }
            }

            FieldLabel("4-digit PIN")
            HandoffField(
                value = pin,
                onValueChange = { if (it.length <= 4 && it.all(Char::isDigit)) pin = it },
                placeholder = "····",
                keyboard = KeyboardType.NumberPassword,
                mono = true,
                enabled = selected != null && !busy,
            )

            HandoffButton(
                label = if (busy) "Checking…" else "Approve",
                modifier = Modifier.fillMaxWidth(),
                enabled = selected != null && pin.length == 4 && !busy,
            ) { selected?.let { onApprove(it.id, pin) } }
        }
    }
}

/**
 * Petty cash in or out of the drawer.
 *
 * Two big buttons rather than a signed amount. Asking someone at a till to type
 * a minus sign to take money out is how a pay-out gets recorded as a pay-in,
 * and the drawer then reconciles wrong by twice the amount.
 */
@Composable
fun MovementDialog(
    busy: Boolean,
    error: String?,
    done: Boolean,
    onRecord: (Double, Boolean, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var amount by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var payIn by remember { mutableStateOf(false) }

    // Closes itself once the server has taken it, so there is no "it worked,
    // now press Close" step to leave hanging on a busy counter.
    LaunchedEffect(done) { if (done) onDismiss() }

    val value = amount.toDoubleOrNull() ?: 0.0

    HandoffDialog(title = "Cash in or out", width = 580, maxHeight = 600, onDismiss = onDismiss) {
        Column(
            Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf(false to "Take out", true to "Pay in").forEach { (isIn, label) ->
                    val selected = payIn == isIn
                    Surface(
                        onClick = { payIn = isIn },
                        enabled = !busy,
                        shape = RoundedCornerShape(12.dp),
                        color = if (selected) Handoff.AccentTint else Handoff.Surface,
                        contentColor = if (selected) Handoff.AccentText else Handoff.Ink,
                        border = BorderStroke(
                            1.dp,
                            if (selected) Handoff.AccentSolid else Handoff.LineSoft,
                        ),
                        modifier = Modifier.weight(1f).height(68.dp),
                    ) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }

            FieldLabel("Amount")
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

            FieldLabel("Reason")
            HandoffField(
                value = reason,
                onValueChange = { if (it.length <= 200) reason = it },
                placeholder = "e.g. paid the bread supplier",
                enabled = !busy,
            )

            error?.let { Text(it, fontSize = 12.5.sp, color = Handoff.Danger) }

            HandoffButton(
                label = when {
                    busy -> "Saving…"
                    payIn -> "Pay in ${formatAmount(value)}"
                    else -> "Take out ${formatAmount(value)}"
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = !busy && value > 0 && reason.trim().length >= 3,
            ) { onRecord(value, payIn, reason.trim()) }
        }
    }
}

// ────────────────────────────────────────────────────── shared field + key

/** `height:56px; background:#F7FAFA; border:1px solid #DFE7E8; radius:12px`. */
@Composable
fun HandoffField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    keyboard: KeyboardType = KeyboardType.Text,
    mono: Boolean = false,
    enabled: Boolean = true,
    imeAction: ImeAction = ImeAction.Default,
    onImeAction: (() -> Unit)? = null,
    masked: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    var focused by remember { mutableStateOf(false) }

    Row(
        Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (focused) Handoff.Surface else Handoff.Well2)
            .border(
                1.dp,
                if (focused) Handoff.Accent else Handoff.LineField,
                RoundedCornerShape(12.dp),
            )
            .padding(start = 16.dp, end = if (trailing == null) 16.dp else 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            enabled = enabled,
            singleLine = true,
            visualTransformation = if (masked) {
                PasswordVisualTransformation()
            } else {
                VisualTransformation.None
            },
            textStyle = LocalTextStyle.current.copy(
                fontSize = 15.5.sp,
                color = Handoff.Ink,
                fontFamily = if (mono) PlexMono else null,
            ),
            cursorBrush = SolidColor(Handoff.Accent),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = imeAction),
            keyboardActions = KeyboardActions(
                onDone = { onImeAction?.invoke() },
                onGo = { onImeAction?.invoke() },
                onSearch = { onImeAction?.invoke() },
            ),
            modifier = Modifier.weight(1f).onFocusChangedCompat { focused = it },
            decorationBox = { inner ->
                if (value.isEmpty()) {
                    Text(
                        placeholder,
                        fontSize = 15.5.sp,
                        color = Handoff.Muted3,
                        fontFamily = if (mono) PlexMono else null,
                    )
                }
                inner()
            },
        )
        trailing?.invoke()
    }
}

@Composable
fun FieldLabel(text: String) {
    Text(
        text.uppercase(),
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.1.sp,
        color = Handoff.Muted3,
    )
}

/**
 * `height:48px; padding:0 18px; radius:11px` — solid accent, or bordered white.
 *
 * The inner box fills the HEIGHT only. `fillMaxSize()` here would expand the
 * button to whatever width the row offered, because Material's `Surface`
 * propagates min constraints — which is exactly what makes the same call
 * centre the label when a caller does ask for `fillMaxWidth()`.
 */
@Composable
fun HandoffButton(
    label: String,
    modifier: Modifier = Modifier,
    primary: Boolean = true,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(11.dp),
        // `primaryBlocked` — a flat well, not a dimmed accent.
        color = when {
            !enabled -> Handoff.Blocked
            primary -> Handoff.AccentSolid
            else -> Handoff.Surface
        },
        contentColor = when {
            !enabled -> Handoff.BlockedText
            primary -> Color.White
            else -> Handoff.InkStrong
        },
        border = if (primary || !enabled) null else BorderStroke(1.dp, Handoff.Line),
        modifier = modifier.height(48.dp),
    ) {
        Box(Modifier.fillMaxHeight().padding(horizontal = 18.dp), Alignment.Center) {
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        }
    }
}

/**
 * The square icon key the handoff puts everywhere: back arrows, close keys,
 * the reprint and gift keys on a sale row.
 *
 * `width:size; height:size; radius:11px; background:#F5F8F8` with a `#E4EDEE`
 * hairline. Square rather than round because at 48px a circle reads as an
 * avatar, and the handoff already spends circles on people.
 *
 * The inner box fills the height only, for the reason on [HandoffButton].
 */
@Composable
fun SquareKey(
    onClick: () -> Unit,
    size: Int = 48,
    enabled: Boolean = true,
    tint: Color = Handoff.Muted,
    content: @Composable () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(11.dp),
        color = if (enabled) Handoff.Well else Handoff.Blocked,
        contentColor = if (enabled) tint else Handoff.BlockedText,
        border = BorderStroke(1.dp, Handoff.LineIdle),
        modifier = Modifier.size(size.dp),
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) { content() }
    }
}

/** Kept local so the field does not need the focus import in every caller. */
private fun Modifier.onFocusChangedCompat(onChanged: (Boolean) -> Unit): Modifier =
    this.onFocusChanged { onChanged(it.isFocused) }
