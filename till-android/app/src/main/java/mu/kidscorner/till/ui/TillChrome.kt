package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
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
    reconnecting: Boolean = false,
    onReconnect: () -> Unit = {},
    /** The newer version's name once the server has announced it. */
    updateVersionName: String? = null,
    /**
     * Whether that update has actually finished downloading. `updateVersionName`
     * alone only means the server announced one — offering to install before
     * the file exists left "Install now" doing nothing, silently, because
     * installUpdate() itself already refuses to start with no file ready.
     */
    downloadReady: Boolean = false,
    /** Whether the basket is empty right now — installing only offers then. */
    basketEmpty: Boolean = true,
    /** Opens the "Update to vX?" confirmation. Only called when ready AND empty. */
    onOfferUpdate: () -> Unit = {},
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
                        color = Handoff.Muted3,
                    )
                }
            }

            Box(Modifier.width(1.dp).height(26.dp).background(Handoff.LineIdle))

            // ── the shift pill ──────────────────────────────────────────────
            //
            // This was the wrong way round. An open shift — the normal state,
            // the one the till is in all day — got a red dot on a red tint,
            // and a CLOSED till, which is the one that stops the shop selling,
            // was drawn quiet and grey. A round status light is read as a
            // status light: red means down. It was saying "down" about the
            // healthy state and nothing at all about the broken one.
            //
            // Quiet when open, amber when closed. Amber is what this palette
            // uses for "look at this and decide" everywhere else, and a till
            // that cannot take money is exactly that.
            Row(
                Modifier
                    .height(30.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (tillOpen) Color.Transparent else Handoff.WarnTint)
                    .border(
                        1.dp,
                        if (tillOpen) Color.Transparent else Handoff.WarnLine,
                        RoundedCornerShape(8.dp),
                    )
                    .padding(horizontal = if (tillOpen) 2.dp else 11.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                if (!tillOpen) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(Handoff.WarnDot))
                }
                Text(
                    if (tillOpen) "Shift open" else "Till closed",
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (tillOpen) Handoff.Muted3 else Handoff.WarnText,
                )
            }

            Spacer(Modifier.weight(1f))

            ConnectionPill(
                online = online,
                queuedCount = queuedCount,
                reconnecting = reconnecting,
                onReconnect = onReconnect,
                updateVersionName = updateVersionName,
                downloadReady = downloadReady,
                basketEmpty = basketEmpty,
                onOfferUpdate = onOfferUpdate,
            )

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
private fun ConnectionPill(
    online: Boolean,
    queuedCount: Int,
    reconnecting: Boolean,
    onReconnect: () -> Unit,
    updateVersionName: String?,
    downloadReady: Boolean,
    basketEmpty: Boolean,
    onOfferUpdate: () -> Unit,
) {
    val waiting = queuedCount > 0
    // Offered only once there is nothing to interrupt: a problem (offline,
    // queued, mid-sync) always outranks it, and so does a basket with
    // anything in it — installing is exactly the kind of thing that must
    // never land on a cashier mid-sale with a customer at the counter.
    // `downloadReady` too: the server can announce a version before the file
    // has finished fetching, and offering install before then is a button
    // that silently does nothing when tapped.
    val updateReady =
        updateVersionName != null && downloadReady && online && !waiting && !reconnecting

    // One control, always tappable: sync everything now — roster, catalogue
    // (prices and shelf), and the VAT policy — and, when the line is down, the
    // same tap is how a cashier tells the till to go and find the shop again.
    // When an update is ready and the basket is empty, the same tap instead
    // offers to install it — the pill still has exactly one job at a time.
    // Disabled only while a sync is already in flight, so a double tap cannot
    // stack two.
    val tappable = Modifier
        .height(32.dp)
        .clip(RoundedCornerShape(8.dp))
        .clickable(
            enabled = !reconnecting,
            onClick = if (updateReady && basketEmpty) onOfferUpdate else onReconnect,
        )

    if (updateReady) {
        // `AccentTint/AccentText/AccentSolid` — the brand's own coral, not the
        // amber reserved for something wrong. An update is good news.
        Row(
            tappable
                .background(Handoff.AccentTint)
                .border(1.dp, Handoff.AccentSolid, RoundedCornerShape(8.dp))
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                Icons.Default.Refresh,
                contentDescription = null,
                tint = Handoff.AccentText,
                modifier = Modifier.size(13.dp),
            )
            Text(
                // Mid-sale, this only hints — the basket has to clear before
                // the pill will actually offer to install anything.
                if (basketEmpty) "Update ready" else "Update waiting",
                fontSize = 11.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.AccentText,
            )
        }
    } else if (online && !waiting && !reconnecting) {
        // The good state stays quiet — no alarm-red dot — but now carries a
        // small refresh mark so the word reads as the button it is.
        Row(
            tappable.padding(horizontal = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Icon(
                Icons.Default.Refresh,
                contentDescription = "Sync now",
                tint = Handoff.Muted3,
                modifier = Modifier.size(13.dp),
            )
            Text("Online", fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = Handoff.Muted3)
        }
    } else {
        // `#FFF6EC / #F5D9B4 / #E8A33D / #9A5B12` — already warm in the
        // handoff, so these are its own values.
        Row(
            tappable
                .background(Handoff.WarnTint)
                .border(1.dp, Handoff.WarnLine, RoundedCornerShape(8.dp))
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (reconnecting) {
                CircularProgressIndicator(
                    Modifier.size(12.dp),
                    strokeWidth = 1.5.dp,
                    color = Handoff.WarnText,
                )
            } else {
                Box(Modifier.size(6.dp).clip(CircleShape).background(Handoff.WarnDot))
            }
            Text(
                when {
                    reconnecting -> "Syncing…"
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
