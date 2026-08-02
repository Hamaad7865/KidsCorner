package mu.kidscorner.till.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.R
import mu.kidscorner.till.ui.theme.Handoff

/** Shown while the app decides whether this device has been set up. */
@Composable
fun StartingScreen(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(Handoff.Canvas), Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            KcMark()
            CircularProgressIndicator(Modifier.size(24.dp), Handoff.AccentSolid, 2.dp)
        }
    }
}

/**
 * Shown when the device is signed in but the server could not be reached.
 *
 * Retry is the only action, deliberately. Signing out here would take a shop
 * whose internet dropped and lock it out of its own till until the owner turned
 * up with a password.
 */
@Composable
fun OfflineScreen(
    message: String,
    busy: Boolean,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier.fillMaxSize().background(Handoff.Canvas).padding(20.dp), Alignment.Center) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = Handoff.Surface,
            border = androidx.compose.foundation.BorderStroke(1.dp, Handoff.LineSoft),
            shadowElevation = 12.dp,
            modifier = Modifier.width(520.dp),
        ) {
            Column(
                Modifier.padding(start = 26.dp, end = 26.dp, top = 24.dp, bottom = 26.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                KcMark()

                Text(
                    "Can't reach the till server",
                    fontSize = 19.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.38).sp,
                    color = Handoff.Ink,
                    modifier = Modifier.padding(top = 18.dp),
                )
                Text(
                    message,
                    fontSize = 12.5.sp,
                    color = Handoff.Muted3,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 4.dp, bottom = 18.dp),
                )

                Surface(
                    onClick = onRetry,
                    enabled = !busy,
                    shape = RoundedCornerShape(14.dp),
                    color = if (busy) Handoff.Blocked else Handoff.AccentSolid,
                    contentColor = if (busy) Handoff.BlockedText else Color.White,
                    modifier = Modifier.fillMaxWidth().height(68.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        if (busy) {
                            CircularProgressIndicator(
                                Modifier.size(24.dp),
                                Handoff.BlockedText,
                                2.dp,
                            )
                        } else {
                            Text("Try again", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }

                Text(
                    "Sales already rung up are safe on this tablet and will send " +
                        "themselves when the line comes back.",
                    fontSize = 11.5.sp,
                    color = Handoff.Muted4,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 11.dp),
                )
            }
        }
    }
}

/**
 * The shop's mark, wherever the till needs to say which shop it is.
 *
 * This drew the letters "KC" in a rounded coral square until the real artwork
 * arrived — `res/drawable/kc_mark.xml`, converted from the same
 * `kids-corner-favicon.svg` the browser tab uses. No plate behind it: the
 * monogram brings its own three colours and sits on the white page directly,
 * which is also why it needs no `contentDescription` — every use of it is
 * beside the shop's name in text.
 */
@Composable
internal fun KcMark(size: Int = 44) {
    Image(
        painter = painterResource(R.drawable.kc_mark),
        contentDescription = null,
        modifier = Modifier.size(size.dp),
    )
}
