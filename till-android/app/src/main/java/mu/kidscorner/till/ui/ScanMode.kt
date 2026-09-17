package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.Success

/**
 * Scan mode, shared by every screen that takes a gun.
 *
 * One arming for all of them (held in MainActivity): the toggle swaps the
 * search field for a status pill and bursts arrive below focus on a flow, so
 * no field, no focus, and the keyboard is never summoned. Which screen owns
 * the gun is decided by [mu.kidscorner.till.ui.ScanRoute], never by focus.
 */

/** The scan-mode toggle: the same 56px key, lit accent while scan mode owns the gun. */
@Composable
internal fun ScanModeToggle(active: Boolean, onToggle: () -> Unit) {
    Surface(
        onClick = onToggle,
        shape = RoundedCornerShape(12.dp),
        color = if (active) Handoff.AccentSolid else Handoff.Surface,
        contentColor = if (active) Color.White else Handoff.InkStrong,
        border = BorderStroke(1.dp, if (active) Handoff.AccentSolid else Handoff.Line),
        modifier = Modifier.size(56.dp),
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Icon(Icons.Default.QrCodeScanner, "Scan mode", Modifier.size(22.dp))
        }
    }
}

/**
 * What the search field becomes in scan mode: a status pill, never a textbox.
 * Ready, the last code a scan landed, or the code that matched nothing — the
 * gun's whole conversation with the cashier, with nothing typed on screen.
 */
@Composable
internal fun ScanModePill(
    lastScan: String?,
    error: String?,
    modifier: Modifier = Modifier,
    /** "Added" on the sell screen, "Found" where a scan looks up. */
    okPrefix: String = "Added",
    idleText: String = "Scan mode · ready",
) {
    val(err, msg) = when {
        error != null -> true to "No match — $error"
        lastScan != null -> false to "$okPrefix · $lastScan"
        else -> false to idleText
    }
    Row(
        modifier
            .height(56.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (err) Handoff.DangerTint else Handoff.FieldWell)
            .border(1.dp, if (err) Handoff.Danger else Handoff.Line, RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(if (err) Handoff.Danger else Success),
        )
        Text(
            msg,
            fontSize = 15.sp,
            fontWeight = FontWeight.SemiBold,
            color = if (err) Handoff.Danger else Handoff.Ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
