package mu.kidscorner.till.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.KeyboardCapslock
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

import mu.kidscorner.till.ui.theme.Handoff

/**
 * The till's own on-screen keyboard.
 *
 * The system IME is a problem on the wall tablet: whenever a field gains focus
 * the soft keyboard slides up and squeezes the whole screen to whatever space
 * is left, at whatever height the device's default input method happens to be.
 * So the till draws its own. Fields using it are read-only to the IME — the
 * system keyboard never appears — and key presses go straight into the field's
 * value.
 *
 * Two layouts: text (QWERTY with shift/caps) and numeric (a calculator grid
 * for amounts). Which one shows follows the field, not the user: a price field
 * opens numbers, a search bar opens letters.
 */
enum class KcKeyboardLayout { TEXT, NUMERIC }

@Composable
fun KcKeyboard(
    layout: KcKeyboardLayout,
    visible: Boolean,
    onKey: (String) -> Unit,
    onBackspace: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var shift by remember { mutableStateOf(false) }
    var caps by remember { mutableStateOf(false) }

    if (!visible) return

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color(0xFFE8EEEF),
        shadowElevation = 12.dp,
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            when (layout) {
                KcKeyboardLayout.TEXT -> TextRows(
                    shift = shift,
                    caps = caps,
                    onShift = {
                        if (caps) caps = false else shift = !shift
                    },
                    onCaps = {
                        caps = !caps
                        shift = false
                    },
                    onKey = { ch ->
                        onKey(if (shift || caps) ch.uppercase() else ch)
                        if (shift) shift = false
                    },
                )
                KcKeyboardLayout.NUMERIC -> NumericRows(onKey = onKey)
            }
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                KeyCap(
                    label = "",
                    icon = Icons.AutoMirrored.Filled.Backspace,
                    modifier = Modifier.weight(2f),
                    onClick = onBackspace,
                )
                Box(Modifier.weight(4f).padding(horizontal = 5.dp)) {
                    KeyCap(
                        label = "space",
                        onClick = { onKey(" ") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                KeyCap(
                    label = "Done",
                    filled = true,
                    modifier = Modifier.weight(2f),
                    onClick = {
                        shift = false
                        caps = false
                        onDone()
                    },
                )
            }
        }
    }
}

@Composable
private fun TextRows(
    shift: Boolean,
    caps: Boolean,
    onShift: () -> Unit,
    onCaps: () -> Unit,
    onKey: (String) -> Unit,
) {
    listOf("qwertyuiop", "asdfghjkl").forEach { row ->
        Row(
            Modifier.fillMaxWidth().padding(vertical = 3.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            row.forEach { ch ->
                KeyCap(
                    label = if (shift || caps) ch.uppercase() else ch.toString(),
                    modifier = Modifier.padding(horizontal = 2.5.dp),
                    onClick = { onKey(ch.toString()) },
                )
            }
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KeyCap(
            label = "",
            icon = Icons.Default.KeyboardCapslock,
            active = caps,
            modifier = Modifier.padding(horizontal = 2.5.dp),
            onClick = onCaps,
        )
        "zxcvbnm".forEach { ch ->
            KeyCap(
                label = if (shift || caps) ch.uppercase() else ch.toString(),
                modifier = Modifier.padding(horizontal = 2.5.dp),
                onClick = { onKey(ch.toString()) },
            )
        }
        KeyCap(
            label = if (shift || caps) "⇧" else "⇧",
            active = shift,
            modifier = Modifier.padding(horizontal = 2.5.dp),
            onClick = onShift,
        )
    }
}

@Composable
private fun NumericRows(onKey: (String) -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        listOf(
            listOf("7", "8", "9"),
            listOf("4", "5", "6"),
            listOf("1", "2", "3"),
            listOf(".", "0", "-"),
        ).forEach { row ->
            Row {
                row.forEach { ch ->
                    KeyCap(
                        label = ch,
                        modifier = Modifier.padding(3.dp),
                        onClick = { onKey(ch) },
                    )
                }
            }
        }
    }
}

/** A single keycap — `radius:10px`, white on the well background, no ripple. */
@Composable
private fun KeyCap(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    active: Boolean = false,
    icon: ImageVector? = null,
) {
    val bg = when {
        active -> Handoff.Accent
        filled -> Handoff.Ink
        else -> Color.White
    }
    val fg = if (active || filled) Color.White else Handoff.Ink
    Box(
        modifier
            .defaultMinSize(minWidth = 40.dp)
            .height(46.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(bg)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) {
            Icon(
                icon,
                contentDescription = label.ifEmpty { "key" },
                tint = fg,
                modifier = Modifier.size(22.dp),
            )
        } else {
            Text(label, fontSize = 17.sp, fontWeight = FontWeight.Medium, color = fg)
        }
    }
}
