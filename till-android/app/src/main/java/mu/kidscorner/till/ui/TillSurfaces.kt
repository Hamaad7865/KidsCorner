package mu.kidscorner.till.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * The shop-wide surface language.
 *
 * Every working screen shares one ground: a light plum ([Handoff.PinGround])
 * with a soft brand wash fading down from the top, and white cards floating
 * on it. Dialogs share one header band. Anything new should reach for these
 * rather than inventing its own background — a screen that looks different
 * reads as a different app, and at a counter that reads as broken.
 */

/** Full-screen ground with the brand wash up top. The content draws over it. */
@Composable
fun TillGround(
    wash: Color = Handoff.AccentTint,
    washHeight: Int = 300,
    content: @Composable () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Handoff.PinGround)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(washHeight.dp)
                .background(Brush.verticalGradient(listOf(wash, Color.Transparent))),
        )
        content()
    }
}

/** One figure in a stat band: value over a small-caps label, centred. */
@Composable
fun HeroStat(value: String, label: String, modifier: Modifier = Modifier, mono: Boolean = false) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            value,
            fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Handoff.InkFigure,
            fontFamily = if (mono) PlexMono else null,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Text(
            label,
            fontSize = 9.5.sp, fontWeight = FontWeight.Bold,
            letterSpacing = 0.9.sp, color = Handoff.Muted3,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

/**
 * The dark accent card: a near-black panel for the screen's machine —
 * printers, drawers, totals.
 *
 * Dark in exactly one place per screen. Two dark cards argue about which one
 * is the machine, and the answer is always the one the money or the paper
 * comes out of.
 */
@Composable
fun DarkCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = Handoff.ScanButton,
        shadowElevation = 4.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(4.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Handoff.ScanButtonPressed),
                    Alignment.Center,
                ) {
                    Icon(icon, null, tint = Handoff.ScanGlyph, modifier = Modifier.size(20.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        title,
                        fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.32).sp, color = Color.White,
                    )
                    Text(subtitle, fontSize = 12.sp, color = Handoff.ScanGlyph)
                }
            }
            content()
        }
    }
}
