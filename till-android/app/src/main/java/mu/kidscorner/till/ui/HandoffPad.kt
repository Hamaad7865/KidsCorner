package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * `padKeys` — the handoff's one keypad, drawn at three sizes.
 *
 * `["1".."9","00","0","⌫"]` in a `repeat(3,1fr)` grid on
 * `background:#FFFFFF;border:1px solid #DFE7E8` with `#E4EFEF` / `#B6C9CB`
 * under the thumb. The payment screen fills its column (`repeat(4,1fr)`), open
 * shift uses `grid-auto-rows:60px` at 20px, close shift `52px` at 18px — so the
 * row height and type size are the parameters and everything else is fixed.
 *
 * The one deviation from the handoff is the tenth key. The handoff prints "00"
 * and does whole-rupee arithmetic throughout; Kids Corner's prices carry cents
 * (Rs 565.71 is a real unit price here), so a pad with no decimal point cannot
 * express an exact tender or a drawer that has coins in it. The key is a "."
 * instead. Same grid, same cell, one glyph.
 */
@Composable
fun HandoffPad(
    onKey: (String) -> Unit,
    onBackspace: () -> Unit,
    modifier: Modifier = Modifier,
    rowHeight: Dp? = null,
    fontSize: TextUnit = 21.sp,
    radius: Dp = 12.dp,
    gap: Dp = 8.dp,
    enabled: Boolean = true,
) {
    val rows = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9"),
        listOf(".", "0", "⌫"),
    )

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
        rows.forEach { row ->
            Row(
                // A null row height means "share what is left", which is the
                // handoff's `repeat(4,1fr)`; a value is its `grid-auto-rows`.
                Modifier
                    .fillMaxWidth()
                    .then(if (rowHeight == null) Modifier.weight(1f) else Modifier.height(rowHeight)),
                horizontalArrangement = Arrangement.spacedBy(gap),
            ) {
                row.forEach { key ->
                    PadKey(
                        key = key,
                        enabled = enabled,
                        fontSize = fontSize,
                        radius = radius,
                        onClick = { if (key == "⌫") onBackspace() else onKey(key) },
                        modifier = Modifier.weight(1f).fillMaxSize(),
                    )
                }
            }
        }
    }
}

@Composable
private fun PadKey(
    key: String,
    enabled: Boolean,
    fontSize: TextUnit,
    radius: Dp,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.collectIsPressedAsState()

    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(radius),
        color = if (pressed) Handoff.KeyPressed else Handoff.Surface,
        contentColor = if (pressed) Handoff.InkFigure else Handoff.Ink,
        border = BorderStroke(1.dp, if (pressed) Handoff.KeyPressedLine else Handoff.LineField),
        interactionSource = interactions,
        modifier = modifier,
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            if (key == "⌫") {
                Icon(
                    Icons.AutoMirrored.Filled.Backspace,
                    "Delete last digit",
                    Modifier.height(fontSize.value.dp),
                )
            } else {
                Text(key, fontFamily = PlexMono, fontSize = fontSize, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/**
 * Appending a keystroke to a money entry.
 *
 * Kept here rather than in each screen because "what does '.' do when there is
 * already a dot" is the kind of thing that ends up answered three different
 * ways. One dot, two decimals, ten characters.
 */
fun String.appendPadKey(key: String, maxLength: Int = 10): String {
    if (key == ".") return if (contains('.')) this else if (isEmpty()) "0." else "$this."
    val dot = indexOf('.')
    if (dot >= 0 && length - dot - 1 >= 2) return this
    if (length >= maxLength) return this
    // A leading zero is what an empty field shows, not something to type onto.
    if (this == "0") return key
    return this + key
}
