package mu.kidscorner.till.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.ui.theme.Handoff

/**
 * The design's toast — `left:14px; bottom:14px; padding:12px 16px; radius:12`
 * on `#0C2429`, a 17px tick and the line at 13.5px/500, capped at 560px.
 *
 * Not a Material `Snackbar`: that one docks to the bottom edge, spans the
 * width, and brings its own shape and timing. The design puts a small pill in
 * the corner precisely so it does not sit over the cart, which on this screen
 * is where the cashier is looking.
 *
 * The ViewModel owns the 2.2-second life. Timing a disappearance from a
 * composable would restart it on every recomposition — and the sell screen
 * recomposes on every keystroke.
 */
@Composable
fun ToastPill(message: String?, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().padding(14.dp), Alignment.BottomStart) {
        AnimatedVisibility(
            visible = message != null,
            enter = fadeIn() + slideInVertically { it / 2 },
            exit = fadeOut() + slideOutVertically { it / 2 },
        ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Handoff.ScanButton,
                shadowElevation = 10.dp,
                modifier = Modifier.widthIn(max = 560.dp),
            ) {
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        tint = Handoff.ScanGlyph,
                        modifier = Modifier.size(17.dp),
                    )
                    // Held after the message clears so the pill fades out with
                    // its text intact rather than emptying first.
                    Text(
                        message ?: "",
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = Handoff.ToastInk,
                    )
                }
            }
        }
    }
}
