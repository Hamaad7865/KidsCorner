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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Label
import androidx.compose.material.icons.filled.Monitor
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.ui.theme.Handoff

/**
 * `atSettings` — new in POS v2.
 *
 * `padding:13px 18px 8px` header over a scroller at `padding:4px 18px 20px`:
 * six peripheral cards in a `repeat(2,1fr)` grid at `gap:11px`, then a "Till
 * behaviour" card holding the switches in their own `repeat(2,1fr)` grid.
 *
 * Peripherals the till has no driver for are drawn exactly as the design draws
 * them but read "Not set up" with the switch disabled. A switch that flips and
 * changes nothing is worse than no switch: a cashier turns the cash drawer
 * "on", nothing opens, and now they distrust the whole screen.
 *
 * That was written about the peripherals and was quietly untrue of the
 * switches beside them. All six flipped, persisted across restarts, and were
 * read by nothing. Two of them now work — "Print receipt automatically" and
 * "Beep on scan". The two drawer switches and cash rounding say on the row
 * why they cannot be used. "Ask print / email / none" is gone: the complete
 * screen always offers Print and Gift receipt, and the till cannot email.
 */
@Composable
fun SettingsScreen(
    printerConfigured: Boolean,
    printerLabel: String,
    paper: PaperWidth,
    autoPrint: Boolean,
    drawerOnCash: Boolean,
    drawerOnCard: Boolean,
    beepOnScan: Boolean,
    roundCash: Boolean,
    onBack: () -> Unit,
    onOpenPrinter: () -> Unit,
    onTestPrint: () -> Unit,
    onSetPaper: (PaperWidth) -> Unit,
    onSetPref: (String, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize().background(Handoff.Canvas)) {

        // ── header: `padding:13px 18px 8px; gap:12px` ───────────────────────
        Row(
            Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 13.dp, bottom = 8.dp),
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
                    "Till settings",
                    fontSize = 18.sp,
                    lineHeight = 22.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.36).sp,
                    color = Handoff.Ink,
                )
                Text(
                    "Peripherals and receipt behaviour for this till only.",
                    fontSize = 12.5.sp,
                    lineHeight = 15.6.sp,
                    color = Handoff.Muted3,
                )
            }
            Spacer(Modifier.weight(1f))

            // `height:48px; padding:0 16px; background:#0C2429; radius:11`
            //
            // The last thing on this screen that was blocked without saying
            // why. The three switches below now name their reason and the
            // peripheral cards say "No driver on this till yet"; this sat at
            // the far corner, greyed, next to none of them. It says it itself
            // until there is a drawer to open.
            Surface(
                onClick = { },
                enabled = false,
                shape = RoundedCornerShape(11.dp),
                color = Handoff.Blocked,
                contentColor = Handoff.BlockedText,
                modifier = Modifier.height(48.dp),
            ) {
                Row(
                    Modifier.fillMaxHeight().padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Default.Inbox, null, Modifier.size(17.dp))
                    Text(
                        "Open drawer — none connected",
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(start = 18.dp, end = 18.dp, top = 4.dp, bottom = 20.dp),
        ) {
            // ── peripherals: `repeat(2,1fr); gap:11px` ──────────────────────
            val cards = listOf(
                Periph(
                    title = "Receipt printer",
                    icon = Icons.Default.Print,
                    tint = Handoff.AccentTint,
                    ink = Handoff.AccentText,
                    live = true,
                    on = printerConfigured,
                    model = printerLabel,
                    testLabel = "Test print",
                ),
                Periph("Cash drawer", Icons.Default.Inbox, Color(0xFFFFF3DF), Color(0xFF8A5A12)),
                Periph("Barcode scanner", Icons.Default.QrCodeScanner, Color(0xFFE7F0FA), Color(0xFF2E5F8A)),
                Periph("Card terminal", Icons.Default.CreditCard, Color(0xFFEEEAFA), Color(0xFF5B4B9E)),
                Periph("Customer display", Icons.Default.Monitor, Handoff.Well, Handoff.Muted),
                Periph("Label printer", Icons.Default.Label, Color(0xFFFDECE6), Color(0xFFB4552F)),
            )

            cards.chunked(2).forEach { pair ->
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 11.dp),
                    horizontalArrangement = Arrangement.spacedBy(11.dp),
                ) {
                    pair.forEach { card ->
                        PeripheralCard(
                            card = card,
                            paper = paper,
                            modifier = Modifier.weight(1f),
                            onToggle = onOpenPrinter,
                            onTest = onTestPrint,
                            onSetPaper = onSetPaper,
                        )
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }

            // ── till behaviour: `padding:14px 16px 4px` ─────────────────────
            Surface(
                shape = RoundedCornerShape(13.dp),
                color = Handoff.Surface,
                border = BorderStroke(1.dp, Handoff.LineSoft),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 4.dp)) {
                    Text(
                        "Till behaviour",
                        fontSize = 14.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.145).sp,
                        color = Handoff.Ink,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )

                    // "Ask print / email / none" is gone. The complete screen
                    // always offers Print and Gift receipt, so asking was not
                    // optional — and it promised an email the till cannot send.
                    val prefs = listOf(
                        Pref(
                            "autoPrint",
                            "Print receipt automatically",
                            if (printerConfigured) "Every completed sale, no prompt"
                            else "Set up the receipt printer first",
                            autoPrint,
                            blockedBecause =
                                if (printerConfigured) null else "No printer on this till yet",
                        ),
                        Pref("beep", "Beep on scan", "Audible confirm when a barcode lands", beepOnScan),
                        Pref(
                            "drawerOnCash", "Pop drawer on cash sales",
                            "Opens as the sale completes", drawerOnCash,
                            blockedBecause = "No cash drawer on this till yet",
                        ),
                        Pref(
                            "drawerOnCard", "Pop drawer on card sales",
                            "Off for card-only tills", drawerOnCard,
                            blockedBecause = "No cash drawer on this till yet",
                        ),
                        Pref(
                            "roundCash", "Round cash to nearest Rs 5",
                            "Coins under Rs 5 are scarce", roundCash,
                            blockedBecause = "Not built yet — it would change what customers pay",
                        ),
                    )

                    Column(Modifier.padding(top = 8.dp, bottom = 14.dp)) {
                        prefs.chunked(2).forEach { pair ->
                            Row(
                                Modifier.fillMaxWidth().padding(bottom = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                pair.forEach { pref ->
                                    PrefRow(pref, Modifier.weight(1f)) { onSetPref(pref.key, !pref.on) }
                                }
                                if (pair.size == 1) Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                }
            }
        }
    }
}

private data class Periph(
    val title: String,
    val icon: ImageVector,
    val tint: Color,
    val ink: Color,
    /** Whether this till has a driver for it at all. */
    val live: Boolean = false,
    val on: Boolean = false,
    val model: String = "",
    val testLabel: String = "",
)

private data class Pref(
    val key: String,
    val label: String,
    val sub: String,
    val on: Boolean,
    /**
     * Why this switch cannot be flipped, or null when it can.
     *
     * Every one of these was live, persisted across restarts, and read by
     * nothing — the shopkeeper flipped it, it stayed flipped, and the till
     * behaved identically. A switch with a memory and no effect is worse than
     * no switch, because it looks like it worked. The ones that cannot work
     * yet now say so on the row, the way the peripheral cards already say
     * "No driver on this till yet".
     */
    val blockedBecause: String? = null,
)

/** `background:#FFFFFF;border:1px solid #E3E9EA;radius:13;padding:14px 15px 12px` */
@Composable
private fun PeripheralCard(
    card: Periph,
    paper: PaperWidth,
    modifier: Modifier = Modifier,
    onToggle: () -> Unit,
    onTest: () -> Unit,
    onSetPaper: (PaperWidth) -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(13.dp),
        color = Handoff.Surface,
        border = BorderStroke(1.dp, Handoff.LineSoft),
        modifier = modifier,
    ) {
        Column(Modifier.padding(start = 15.dp, end = 15.dp, top = 14.dp, bottom = 12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(11.dp)) {
                Box(
                    Modifier.size(40.dp).clip(RoundedCornerShape(11.dp)).background(card.tint),
                    Alignment.Center,
                ) {
                    Icon(card.icon, null, tint = card.ink, modifier = Modifier.size(20.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        card.title,
                        fontSize = 14.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.145).sp,
                        color = Handoff.Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Row(
                        Modifier.padding(top = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        // No status light. "Connected" carried a red dot — the
                        // same inversion the chrome bar had, where the healthy
                        // state was drawn in the colour every status light on
                        // earth uses for down. There is nothing to replace it
                        // with either: five of these six cards say "Not set up"
                        // and none of them CAN be set up, so a dot on each
                        // would be five lights flagging a state nobody can act
                        // on. The word does the work, and a live card is
                        // already the only one with a Test print button and a
                        // paper width under it.
                        Text(
                            when {
                                !card.live -> "Not set up"
                                card.on -> "Connected"
                                else -> "Off"
                            },
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (card.live && card.on) Handoff.Ink else Handoff.Muted4,
                        )
                        if (card.model.isNotBlank()) {
                            Text(
                                card.model,
                                fontSize = 11.5.sp,
                                color = Handoff.Faint,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
                Toggle(on = card.live && card.on, enabled = card.live, onClick = onToggle)
            }

            Row(
                Modifier.padding(top = 11.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                if (card.live) {
                    Surface(
                        onClick = onTest,
                        shape = RoundedCornerShape(11.dp),
                        color = Handoff.Surface,
                        contentColor = Handoff.InkStrong,
                        border = BorderStroke(1.dp, Handoff.Line),
                        modifier = Modifier.height(48.dp),
                    ) {
                        Box(Modifier.fillMaxHeight().padding(horizontal = 14.dp), Alignment.Center) {
                            Text(
                                card.testLabel,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                            )
                        }
                    }
                    // The paper choice belongs to the printer alone.
                    if (card.title == "Receipt printer") {
                        PaperWidth.entries.forEach { option ->
                            Chip(option.label, paper == option) { onSetPaper(option) }
                        }
                    }
                } else {
                    Text(
                        "No driver on this till yet.",
                        fontSize = 12.sp,
                        color = Handoff.Faint,
                        modifier = Modifier.padding(top = 14.dp),
                    )
                }
            }
        }
    }
}

/** `padding:10px 12px; background:#F7FAFA; border:1px solid #E7EDEE; radius:11` */
@Composable
private fun PrefRow(pref: Pref, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val blocked = pref.blockedBecause != null
    Row(
        modifier
            .clip(RoundedCornerShape(11.dp))
            .background(if (blocked) Handoff.Blocked else Handoff.FieldWell)
            .border(1.dp, Handoff.LineIdle, RoundedCornerShape(11.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        // A blocked switch reads off and stays off. Showing its stored value
        // would be the old lie in a new colour.
        Toggle(on = !blocked && pref.on, enabled = !blocked, onClick = onClick)
        Column(Modifier.weight(1f)) {
            Text(
                pref.label,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (blocked) Handoff.BlockedText else Handoff.Ink,
            )
            Text(
                // The reason wins over the description: "No cash drawer on
                // this till yet" is what the cashier needs, and "Opens as the
                // sale completes" is a promise nothing can keep.
                pref.blockedBecause ?: pref.sub,
                fontSize = 11.5.sp,
                lineHeight = 16.1.sp,
                color = if (blocked) Handoff.Fainter else Handoff.Muted3,
            )
        }
    }
}

/**
 * `width:52px;height:30px;border-radius:999px` with a 12px knob.
 *
 * The design draws it as a background-image gradient that slides; here it is a
 * circle offset to one end, which is the same picture with less arithmetic.
 */
@Composable
private fun Toggle(on: Boolean, enabled: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(999.dp),
        color = when {
            !enabled -> Handoff.Blocked
            on -> Handoff.AccentSolid
            else -> Handoff.Ghost
        },
        modifier = Modifier.size(width = 52.dp, height = 30.dp),
    ) {
        Box(Modifier.fillMaxSize().padding(horizontal = 3.dp), Alignment.CenterStart) {
            Box(
                Modifier
                    .padding(start = if (on) 22.dp else 0.dp)
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(if (enabled) Color.White else Handoff.Surface),
            )
        }
    }
}

/** `height:48px;padding:0 13px;radius:11` — accent when picked. */
@Composable
private fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(11.dp),
        color = if (on) Handoff.AccentTint else Handoff.Surface,
        contentColor = if (on) Handoff.AccentText else Handoff.Muted,
        border = BorderStroke(1.dp, if (on) Handoff.AccentSolid else Handoff.LineField),
        modifier = Modifier.height(48.dp),
    ) {
        Box(Modifier.fillMaxHeight().padding(horizontal = 13.dp), Alignment.Center) {
            Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}
