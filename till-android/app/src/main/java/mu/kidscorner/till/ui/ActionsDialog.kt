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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.StickyNote2
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.ui.theme.Handoff

/**
 * `modalActions` — a 660px card behind the sell screen's "More" key.
 *
 * `repeat(2,1fr); gap:9px` of 74px rows, each a tinted icon well beside a label
 * and a sub-line. Everything a till does that is not ringing up a sale lives
 * here rather than on the sell screen, which is the design keeping the selling
 * surface for selling.
 */
@Composable
fun ActionsDialog(
    lastReceiptNo: String?,
    onReprintLast: () -> Unit,
    onOpenHistory: () -> Unit,
    onOpenDrawer: () -> Unit,
    onCustomItem: () -> Unit,
    onSaleNote: () -> Unit,
    onSettings: () -> Unit,
    onDismiss: () -> Unit,
) {
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
                .width(660.dp)
                .clickable(interactionSource = noRipple, indication = null, onClick = {}),
        ) {
            Column {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 20.dp, top = 17.dp, bottom = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(
                        "Till actions",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.36).sp,
                        color = Handoff.Ink,
                        modifier = Modifier.weight(1f),
                    )
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

                val actions = listOf(
                    Action(
                        "Reprint last ticket",
                        lastReceiptNo?.let { "Receipt $it" } ?: "Nothing rung up yet",
                        Icons.Default.Print,
                        Handoff.AccentTint,
                        Handoff.AccentText,
                        enabled = lastReceiptNo != null,
                        onClick = onReprintLast,
                    ),
                    Action(
                        "Today's sales & returns",
                        "Search, reprint, refund",
                        Icons.Default.ReceiptLong,
                        Color(0xFFE7F0FA),
                        Color(0xFF2E5F8A),
                        onClick = onOpenHistory,
                    ),
                    Action(
                        "Open cash drawer",
                        "Logged as a no-sale",
                        Icons.Default.Inbox,
                        Color(0xFFFFF3DF),
                        Color(0xFF8A5A12),
                        // No drawer-kick in the ESC/POS builder yet, so this
                        // would do nothing. Shown as the design draws it,
                        // disabled rather than lying.
                        enabled = false,
                        onClick = onOpenDrawer,
                    ),
                    Action(
                        "Custom item",
                        "Wrap, alteration, no-label stock",
                        Icons.Default.Add,
                        Color(0xFFFDECE6),
                        Color(0xFFB4552F),
                        onClick = onCustomItem,
                    ),
                    Action(
                        "Sale note",
                        "Prints on the receipt",
                        Icons.Default.StickyNote2,
                        Handoff.Well,
                        Handoff.Muted,
                        onClick = onSaleNote,
                    ),
                    Action(
                        "Till settings",
                        "Printer, drawer, scanner, terminal",
                        Icons.Default.Settings,
                        Color(0xFFEEEAFA),
                        Color(0xFF5B4B9E),
                        onClick = onSettings,
                    ),
                )

                Column(Modifier.padding(start = 20.dp, end = 20.dp, bottom = 20.dp)) {
                    actions.chunked(2).forEach { pair ->
                        Row(
                            Modifier.fillMaxWidth().padding(bottom = 9.dp),
                            horizontalArrangement = Arrangement.spacedBy(9.dp),
                        ) {
                            pair.forEach { action ->
                                ActionKey(action, Modifier.weight(1f))
                            }
                            if (pair.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
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

/** `height:74px; padding:0 15px; radius:13; gap:12` */
@Composable
private fun ActionKey(action: Action, modifier: Modifier = Modifier) {
    Surface(
        onClick = action.onClick,
        enabled = action.enabled,
        shape = RoundedCornerShape(13.dp),
        color = Handoff.Surface,
        contentColor = if (action.enabled) Handoff.Ink else Handoff.Faint,
        border = BorderStroke(1.dp, Handoff.LineSoft),
        modifier = modifier.height(74.dp),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 15.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(11.dp)).background(action.tint),
                Alignment.Center,
            ) {
                Icon(action.icon, null, tint = action.ink, modifier = Modifier.size(20.dp))
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
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
                    color = Handoff.Muted3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
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
                                        color = Handoff.Faint,
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
