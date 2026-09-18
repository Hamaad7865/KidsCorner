package mu.kidscorner.till.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.StickyNote2
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.ui.theme.Handoff

private val DrawerWidth = 360.dp

/**
 * The till menu — a left slide-in behind the sell screen's burger key.
 *
 * Was `modalActions`, a 660px centred card behind a "More" key. Same nine
 * actions, new shape: a full-height 360dp rail that slides in from the left
 * over a fading scrim, grouped under small-caps sections so a cashier scans
 * it the way they scan a shop menu. The selling surface keeps nothing but
 * selling; everything else lives here.
 */
@Composable
fun ActionsDialog(
    lastReceiptNo: String?,
    onReprintLast: () -> Unit,
    onOpenHistory: () -> Unit,
    onOpenDrawer: () -> Unit,
    onSaleNote: () -> Unit,
    onSettings: () -> Unit,
    /** A customer settling their account at the counter. */
    onAccountPayment: () -> Unit,
    /** Layaways: what is held for whom. */
    onOpenDeposits: () -> Unit,
    /** The current basket becomes a deposit (needs a customer attached). */
    onTakeDeposit: () -> Unit,
    canTakeDeposit: Boolean,
    onDismiss: () -> Unit,
    /** Shown in the drawer header — the shop and who is on the till. */
    shopName: String? = null,
    cashierName: String? = null,
    /** Product management: prices, barcodes, labels. */
    onOpenProducts: () -> Unit = {},
) {
    val noRipple = remember { MutableInteractionSource() }

    // Enter choreography: the panel slides home on a soft spring while the
    // scrim fades in underneath. Exit is instant (the overlay is removed),
    // so only the open needs to feel expensive — which is the one the
    // cashier sees several times an hour.
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }
    val slide by animateDpAsState(
        targetValue = if (visible) 0.dp else -DrawerWidth,
        animationSpec = spring(stiffness = 320f, dampingRatio = 0.92f),
        label = "menuSlide",
    )
    val scrimAlpha by animateFloatAsState(
        targetValue = if (visible) 1f else 0f,
        animationSpec = spring(stiffness = Spring.StiffnessMediumLow, dampingRatio = 0.9f),
        label = "menuScrim",
    )

    Box(Modifier.fillMaxSize(), Alignment.CenterStart) {
        Box(
            Modifier
                .fillMaxSize()
                .alpha(scrimAlpha)
                .background(Handoff.Scrim)
                .clickable(interactionSource = noRipple, indication = null, onClick = onDismiss),
        )
        Surface(
            shape = RoundedCornerShape(topEnd = 22.dp, bottomEnd = 22.dp),
            color = Handoff.Surface,
            shadowElevation = 16.dp,
            modifier = Modifier
                .offset(x = slide)
                .width(DrawerWidth)
                .fillMaxHeight()
                .shadow(16.dp, RoundedCornerShape(topEnd = 22.dp, bottomEnd = 22.dp))
                .clickable(interactionSource = noRipple, indication = null, onClick = {}),
        ) {
            Column(Modifier.fillMaxSize()) {
                // ── header ────────────────────────────────────────────────
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(Handoff.AccentTint),
                ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 14.dp, top = 18.dp, bottom = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Menu",
                            fontSize = 21.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.42).sp,
                            color = Handoff.Ink,
                        )
                        Text(
                            when {
                                shopName != null && cashierName != null -> "$shopName · $cashierName"
                                shopName != null -> shopName
                                cashierName != null -> cashierName
                                else -> "Everything beyond the sale"
                            },
                            fontSize = 12.sp,
                            color = Handoff.Muted3,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                    Surface(
                        onClick = onDismiss,
                        shape = RoundedCornerShape(12.dp),
                        color = Handoff.Well,
                        contentColor = Handoff.Muted,
                        modifier = Modifier.size(44.dp),
                    ) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Icon(Icons.Default.Close, "Close menu", Modifier.size(19.dp))
                        }
                    }
                }
                }
                HorizontalDivider(color = Handoff.LineFaint, thickness = 1.dp)

                // ── grouped actions ───────────────────────────────────────
                Column(
                    Modifier
                        .weight(1f)
                        .verticalScroll(rememberScrollState())
                        .padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    DrawerSection("Sales")
                    DrawerRow(
                        Action(
                            "Reprint last ticket",
                            lastReceiptNo?.let { "Receipt $it" } ?: "Nothing rung up yet",
                            Icons.Default.Print,
                            Handoff.AccentTint,
                            Handoff.AccentText,
                            enabled = lastReceiptNo != null,
                            onClick = onReprintLast,
                        ),
                    )
                    DrawerRow(
                        Action(
                            "Today's sales & returns",
                            "Search, reprint, refund",
                            Icons.Default.ReceiptLong,
                            Color(0xFFE7F0FA),
                            Color(0xFF2E5F8A),
                            onClick = onOpenHistory,
                        ),
                    )

                    DrawerSection("Money")
                    DrawerRow(
                        Action(
                            "Open cash drawer",
                            "Logged as a no-sale",
                            Icons.Default.Inbox,
                            Color(0xFFFFF3DF),
                            Color(0xFF8A5A12),
                            onClick = onOpenDrawer,
                        ),
                    )
                    DrawerRow(
                        Action(
                            "Payment on account",
                            "A customer paying their tab",
                            Icons.Default.AccountBalanceWallet,
                            Color(0xFFE7F0FA),
                            Color(0xFF2E5F8A),
                            onClick = onAccountPayment,
                        ),
                    )

                    DrawerSection("Layaway")
                    DrawerRow(
                        Action(
                            "Take deposit",
                            if (canTakeDeposit) {
                                "Hold this basket for money down"
                            } else {
                                "Needs items and a customer"
                            },
                            Icons.Default.Savings,
                            Color(0xFFE6F4EA),
                            Color(0xFF2E6B45),
                            enabled = canTakeDeposit,
                            onClick = onTakeDeposit,
                        ),
                    )
                    DrawerRow(
                        Action(
                            "Deposits",
                            "Layaways, top-ups, pickups",
                            Icons.Default.Inventory2,
                            Color(0xFFE6F4EA),
                            Color(0xFF2E6B45),
                            onClick = onOpenDeposits,
                        ),
                    )

                    DrawerSection("Catalogue")
                    DrawerRow(
                        Action(
                            "Products",
                            "Prices, barcodes, labels",
                            Icons.Default.Storefront,
                            Color(0xFFE7F0FA),
                            Color(0xFF2E5F8A),
                            onClick = onOpenProducts,
                        ),
                    )

                    DrawerSection("This sale")
                    // No custom-item row: the scan bar carries its own Custom
                    // key, and this one only closed the drawer — a button
                    // that closes a menu reads as broken.
                    DrawerRow(
                        Action(
                            "Sale note",
                            "Prints on the receipt",
                            Icons.Default.StickyNote2,
                            Handoff.Well,
                            Handoff.Muted,
                            onClick = onSaleNote,
                        ),
                    )
                }

                // ── pinned system row ─────────────────────────────────────
                HorizontalDivider(color = Handoff.LineFaint, thickness = 1.dp)
                Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 12.dp)) {
                    DrawerRow(
                        Action(
                            "Till settings",
                            "Printer, drawer, scanner, terminal",
                            Icons.Default.Settings,
                            Color(0xFFEEEAFA),
                            Color(0xFF5B4B9E),
                            onClick = onSettings,
                        ),
                    )
                }
            }
        }
    }
}

private data class Action(
    val label: String,
    val sub: String,
    val icon: ImageVector,
    val tint: Color,
    val ink: Color,
    val enabled: Boolean = true,
    val onClick: () -> Unit,
)

/** A small-caps group label — the menu scans like a shop menu. */
@Composable
private fun DrawerSection(title: String) {
    Text(
        title.uppercase(),
        fontSize = 10.5.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 1.1.sp,
        color = Handoff.Muted4,
        modifier = Modifier.padding(start = 10.dp, top = 10.dp, bottom = 4.dp),
    )
}

/**
 * One 64dp menu row: tinted icon well, label over sub-line, faint chevron.
 * Full-bleed rows (no card borders) so the drawer reads as one list, not
 * nine buttons — the tinted wells carry the colour instead.
 */
@Composable
private fun DrawerRow(action: Action) {
    val content = if (action.enabled) Handoff.Ink else Handoff.Faint
    Surface(
        onClick = action.onClick,
        enabled = action.enabled,
        shape = RoundedCornerShape(14.dp),
        color = Color.Transparent,
        contentColor = content,
        modifier = Modifier.fillMaxWidth().height(64.dp),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (action.enabled) action.tint else Handoff.Well)
                    .alpha(if (action.enabled) 1f else 0.6f),
                Alignment.Center,
            ) {
                Icon(
                    action.icon,
                    null,
                    tint = if (action.enabled) action.ink else Handoff.Faint,
                    modifier = Modifier.size(20.dp),
                )
            }
            Column(
                Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    action.label,
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.145).sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    action.sub,
                    fontSize = 11.5.sp,
                    color = if (action.enabled) Handoff.Muted3 else Handoff.Faint,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                null,
                tint = Handoff.Ghost,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/**
 * `modalNote` — a 540px card for the sale note.
 *
 * A 60px field over four preset chips, then Cancel and Save. The note prints on
 * the receipt and travels with a held sale, which is what the subtitle promises
 * and what the cart's amber chip shows once one is set.
 */
@Composable
fun SaleNoteDialog(
    note: String,
    onSave: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var draft by remember { mutableStateOf(note) }
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
                .width(540.dp)
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
                            "Sale note",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.34).sp,
                            color = Handoff.Ink,
                        )
                        Text(
                            "Prints on the receipt and stays with a held sale.",
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
                    // `height:60px; padding:0 16px; radius:12`
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(60.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Handoff.FieldWell)
                            .border(1.dp, Handoff.LineField, RoundedCornerShape(12.dp))
                            .padding(horizontal = 16.dp),
                        Alignment.CenterStart,
                    ) {
                        BasicTextField(
                            value = draft,
                            onValueChange = { if (it.length <= 200) draft = it },
                            singleLine = true,
                            textStyle = LocalTextStyle.current.copy(
                                fontSize = 15.5.sp,
                                color = Handoff.Ink,
                            ),
                            cursorBrush = SolidColor(Handoff.Accent),
                            modifier = Modifier.fillMaxWidth(),
                            decorationBox = { inner ->
                                if (draft.isEmpty()) {
                                    Text(
                                        "e.g. Coming back Saturday for the second pair",
                                        fontSize = 15.5.sp,
                                        color = Handoff.Muted3,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                inner()
                            },
                        )
                    }

                    val presets = listOf(
                        "Coming back for a second pair",
                        "Exchange if size wrong",
                        "Gift — no prices",
                        "School uniform order",
                    )
                    Column(Modifier.padding(top = 11.dp, bottom = 14.dp)) {
                        presets.chunked(2).forEach { pair ->
                            Row(
                                Modifier.fillMaxWidth().padding(bottom = 6.dp),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                pair.forEach { preset ->
                                    Surface(
                                        onClick = { draft = preset },
                                        shape = RoundedCornerShape(11.dp),
                                        color = Handoff.Surface,
                                        contentColor = Handoff.Muted,
                                        border = BorderStroke(1.dp, Handoff.LineField),
                                        modifier = Modifier.weight(1f).height(48.dp),
                                    ) {
                                        Box(
                                            Modifier.fillMaxSize().padding(horizontal = 14.dp),
                                            Alignment.Center,
                                        ) {
                                            Text(
                                                preset,
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
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Surface(
                            onClick = onDismiss,
                            shape = RoundedCornerShape(12.dp),
                            color = Handoff.Surface,
                            contentColor = Handoff.InkStrong,
                            border = BorderStroke(1.dp, Handoff.Line),
                            modifier = Modifier.weight(1f).height(56.dp),
                        ) {
                            Box(Modifier.fillMaxSize(), Alignment.Center) {
                                Text("Cancel", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                            }
                        }
                        Surface(
                            onClick = { onSave(draft.trim()) },
                            shape = RoundedCornerShape(12.dp),
                            color = Handoff.AccentSolid,
                            contentColor = Color.White,
                            modifier = Modifier.weight(1.4f).height(56.dp),
                        ) {
                            Box(Modifier.fillMaxSize(), Alignment.Center) {
                                Text(
                                    if (draft.isBlank() && note.isNotBlank()) {
                                        "Clear note"
                                    } else {
                                        "Save note"
                                    },
                                    fontSize = 15.5.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
