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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
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
import mu.kidscorner.till.data.Cashier
import mu.kidscorner.till.ui.theme.Handoff

/**
 * `hasChrome` — the 56px bar across the top of every working screen.
 *
 * `height:56px; background:#FFFFFF; border-bottom:1px solid #E1E8E9;
 * gap:12px; padding:0 12px 0 14px` — a 30px mark, the shop over its till name,
 * a hairline, the shift pill, then the connection state, End of day and the
 * cashier at the right.
 *
 * The connection pill earns its place. Without it, a shop whose line has
 * dropped finds out at close, when the drawer and the day's report disagree by
 * however many sales queued up unnoticed.
 */
@Composable
fun TillChrome(
    shopName: String,
    cashier: Cashier,
    online: Boolean,
    queuedCount: Int,
    onSwitchCashier: () -> Unit,
    onLock: () -> Unit,
    modifier: Modifier = Modifier,
    tillOpen: Boolean = true,
    onCloseTill: (() -> Unit)? = null,
) {
    Column(modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(56.dp)
                .background(Handoff.Surface)
                .padding(start = 14.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // ── the mark and the shop ───────────────────────────────────────
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                KcMark(size = 30)
                Column {
                    Text(
                        shopName,
                        fontSize = 13.5.sp,
                        lineHeight = 15.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.14).sp,
                        color = Handoff.Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        "TILL 1",
                        fontSize = 9.5.sp,
                        lineHeight = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 0.95.sp,
                        color = Handoff.Muted4,
                    )
                }
            }

            Box(Modifier.width(1.dp).height(26.dp).background(Handoff.LineIdle))

            // ── the shift pill ──────────────────────────────────────────────
            Row(
                Modifier
                    .height(30.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (tillOpen) Handoff.AccentTint else Handoff.Well)
                    .border(
                        1.dp,
                        if (tillOpen) Handoff.AccentLine else Handoff.LineSoft,
                        RoundedCornerShape(8.dp),
                    )
                    .padding(horizontal = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Box(
                    Modifier
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(if (tillOpen) Handoff.Accent else Handoff.Faint),
                )
                Text(
                    if (tillOpen) "Shift open" else "Till closed",
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (tillOpen) Handoff.AccentText else Handoff.Muted3,
                )
            }

            Spacer(Modifier.weight(1f))

            ConnectionPill(online = online, queuedCount = queuedCount)

            // ── End of day: `height:40px; padding:0 13px; radius:10px` ───────
            if (onCloseTill != null && tillOpen) {
                Surface(
                    onClick = onCloseTill,
                    shape = RoundedCornerShape(10.dp),
                    color = Handoff.Surface,
                    contentColor = Handoff.InkStrong,
                    border = BorderStroke(1.dp, Handoff.Line),
                    modifier = Modifier.height(40.dp),
                ) {
                    Box(Modifier.fillMaxHeight().padding(horizontal = 13.dp), Alignment.Center) {
                        Text("End of day", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            // ── the cashier: `height:44px; padding:0 12px 0 6px; radius:11px`
            //
            // Tapping switches cashier, with "Switch cashier" written under the
            // name so it is not something a new member of staff has to be told.
            Surface(
                onClick = onSwitchCashier,
                shape = RoundedCornerShape(11.dp),
                color = Handoff.Well,
                contentColor = Handoff.Ink,
                border = BorderStroke(1.dp, Handoff.LineIdle),
                modifier = Modifier.height(44.dp),
            ) {
                Row(
                    Modifier.fillMaxHeight().padding(start = 6.dp, end = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                ) {
                    Avatar(cashier.fullName, size = 32)
                    Column {
                        Text(
                            cashier.fullName,
                            fontSize = 12.5.sp,
                            lineHeight = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            "Switch cashier",
                            fontSize = 10.5.sp,
                            lineHeight = 12.5.sp,
                            color = Handoff.Muted3,
                        )
                    }
                }
            }

            Surface(
                onClick = onLock,
                shape = RoundedCornerShape(11.dp),
                color = Handoff.Well,
                contentColor = Handoff.Muted,
                border = BorderStroke(1.dp, Handoff.LineIdle),
                modifier = Modifier.size(44.dp),
            ) {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Icon(Icons.Default.Lock, "Lock till", Modifier.size(18.dp))
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineChrome))
    }
}

/**
 * `online` / `offline` — a dot and a word, or an amber count.
 *
 * The queued count comes first when there is one: "3 sales queued" is the
 * actionable fact, and it stays true after the line comes back and while the
 * queue is still draining.
 */
@Composable
private fun ConnectionPill(online: Boolean, queuedCount: Int) {
    val waiting = queuedCount > 0

    if (online && !waiting) {
        // `background:transparent;border:none` — the good state is quiet.
        Row(
            Modifier.height(32.dp).padding(horizontal = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(Handoff.Accent))
            Text("Online", fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = Handoff.Muted4)
        }
    } else {
        // `#FFF6EC / #F5D9B4 / #E8A33D / #9A5B12` — already warm in the
        // handoff, so these are its own values.
        Row(
            Modifier
                .height(32.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Handoff.WarnTint)
                .border(1.dp, Handoff.WarnLine, RoundedCornerShape(8.dp))
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(Handoff.WarnDot))
            Text(
                when {
                    waiting && queuedCount == 1 -> "1 sale queued"
                    waiting && online -> "$queuedCount sales sending"
                    waiting -> "Offline · $queuedCount sales queued"
                    else -> "Offline"
                },
                fontSize = 11.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.WarnText,
            )
        }
    }
}

/**
 * "Marie Appadoo" -> "MA", "boodoo.sheik786" -> "BO".
 *
 * Falls back to the first two characters when a name has no second word, which
 * covers the shop accounts named after an email address.
 */
internal fun initialsOf(name: String): String {
    val words = name.trim().split(Regex("[\\s.]+")).filter { it.isNotEmpty() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words[0].take(2).uppercase()
        else -> (words[0].take(1) + words[1].take(1)).uppercase()
    }
}
