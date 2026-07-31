package mu.kidscorner.till.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import mu.kidscorner.till.data.Cashier
import mu.kidscorner.till.ui.theme.Brand500
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

private const val PIN_LENGTH = 4

/**
 * `atPin` — POS **v2**.
 *
 * The design was rebuilt between v1 and v2 and this follows the new one:
 * An 820px radial aura behind two columns at `gap:38px` — a `392px` staff
 * column beside a `314px` keypad panel at `padding:20px; border-radius:20px`.
 *
 * Staff are a `repeat(2,1fr)` grid of 72px tiles rather than v1's single row,
 * each with a 40px avatar that gains a ring when picked. The panel has three
 * phases — entry, checking, ok — and the last two are a fixed `434px` tall so
 * the panel does not resize under the cashier's hand between them.
 *
 * Keys are `1-9, C, ⌫` on `64px` rows at `gap:9px`, radius **13**, in IBM Plex
 * Mono at 21px. The C key is new in v2: v1 had only a backspace, and clearing
 * four wrong digits one at a time is four taps nobody wants at a counter.
 *
 * The design draws this sheet dark. Kids Corner is off-white and red, so it is
 * drawn light — the dimensions and structure are the design's, the temperature
 * is the shop's. See `Handoff`.
 */
@Composable
fun LockScreen(
    shopName: String,
    cashiers: List<Cashier>,
    busy: Boolean,
    error: String?,
    lockedFor: Int,
    onSubmit: (Cashier, String) -> Unit,
    onErrorShown: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val withPin = remember(cashiers) { cashiers.filter { it.hasPin } }
    var selected by remember(withPin) { mutableStateOf(withPin.firstOrNull()) }
    var pin by remember { mutableStateOf("") }
    var wait by remember { mutableIntStateOf(lockedFor) }

    LaunchedEffect(lockedFor) { wait = lockedFor }
    LaunchedEffect(wait) {
        if (wait > 0) { delay(1_000); wait -= 1 }
    }

    // Cleared on a wrong PIN so the next attempt starts from empty rather than
    // from four digits the cashier has to delete first.
    LaunchedEffect(error) { if (error != null) pin = "" }

    val locked = wait > 0
    val canType = !busy && !locked && selected != null

    fun press(key: String) {
        when {
            key == "back" -> if (pin.isNotEmpty()) pin = pin.dropLast(1)
            key == "clear" -> pin = ""
            pin.length < PIN_LENGTH -> {
                onErrorShown()
                pin += key
                if (pin.length == PIN_LENGTH) selected?.let { onSubmit(it, pin) }
            }
        }
    }

    Box(modifier.fillMaxSize().background(Handoff.PinGround), Alignment.Center) {

        // `width:820px;height:820px;radial-gradient(rgba(20,184,166,.16) → 0 at 62%)`
        Box(
            Modifier
                .size(820.dp)
                .background(
                    Brush.radialGradient(
                        // The stop at 62% is the design's; past it the aura is
                        // fully transparent and the ground shows through.
                        colorStops = arrayOf(
                            0f to Brand500.copy(alpha = 0.16f),
                            0.62f to Color.Transparent,
                            1f to Color.Transparent,
                        ),
                    ),
                ),
        )

        Row(
            horizontalArrangement = Arrangement.spacedBy(38.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // ═══════════════════════════════════ the staff column, 392px ═══
            Column(Modifier.width(392.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.padding(bottom = 22.dp),
                ) {
                    Box(
                        Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(Brand500),
                        Alignment.Center,
                    ) {
                        Text(
                            "KC",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = Handoff.PinOnAccent,
                        )
                    }
                    Text(
                        "$shopName · Till 1",
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = 0.27.sp,
                        color = Handoff.PinTextSoft,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                Text(
                    "Who's on the till?",
                    fontSize = 27.sp,
                    lineHeight = 32.4.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.68).sp,
                    color = Handoff.PinText,
                )
                Text(
                    "Tap your name, then key in your 4-digit PIN. " +
                        "Switching takes about three seconds.",
                    fontSize = 13.5.sp,
                    lineHeight = 20.25.sp,
                    color = Handoff.PinTextFaint,
                    modifier = Modifier.padding(top = 7.dp, bottom = 20.dp),
                )

                // `repeat(2,1fr); gap:10px`
                withPin.chunked(2).forEach { pair ->
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        pair.forEach { cashier ->
                            CashierTile(
                                cashier = cashier,
                                selected = selected?.id == cashier.id,
                                enabled = !busy,
                                modifier = Modifier.weight(1f),
                            ) {
                                selected = cashier
                                pin = ""
                                onErrorShown()
                            }
                        }
                        // Keeps a lone tile on the last row at half width rather
                        // than letting it stretch across both columns.
                        if (pair.size == 1) Spacer(Modifier.weight(1f))
                    }
                }

                if (withPin.isEmpty()) {
                    Text(
                        "Nobody has a PIN set yet. An owner sets them in Settings.",
                        fontSize = 13.sp,
                        color = Handoff.PinTextFaint,
                    )
                }
            }

            // ═══════════════════════════════════ the keypad panel, 314px ═══
            val errored = error != null
            Column(
                Modifier
                    .width(314.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Handoff.PinPanel)
                    .border(
                        1.dp,
                        if (errored) Handoff.PinPanelLineError else Handoff.PinPanelLine,
                        RoundedCornerShape(20.dp),
                    )
                    .padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                when {
                    busy -> PinPhase {
                        CircularProgressIndicator(
                            Modifier.size(52.dp),
                            color = Brand500,
                            trackColor = Handoff.PinPanelLine,
                            strokeWidth = 3.dp,
                        )
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "Checking PIN…",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Handoff.PinTextSoft,
                        )
                    }

                    else -> {
                        val who = selected
                        // `avatar(tint, ink, 54)` with a `0 0 0 3px` ring.
                        Box(
                            Modifier
                                .size(54.dp)
                                .border(3.dp, Brand500.copy(alpha = 0.22f), CircleShape)
                                .clip(CircleShape)
                                .background(Handoff.PinKeySelected),
                            Alignment.Center,
                        ) {
                            Text(
                                who?.let { initialsOf(it.fullName) } ?: "—",
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Bold,
                                color = Handoff.PinTextBright,
                            )
                        }
                        Text(
                            who?.fullName ?: "Pick a name",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.16).sp,
                            color = Handoff.PinText,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 11.dp),
                        )
                        Text(
                            when {
                                locked -> "Locked · ${wait}s"
                                errored -> error
                                else -> "4-digit PIN"
                            },
                            fontSize = 12.sp,
                            fontWeight = if (errored || locked) {
                                FontWeight.SemiBold
                            } else {
                                FontWeight.Normal
                            },
                            color = if (errored || locked) Handoff.PinError else Handoff.PinTextFaint,
                            modifier = Modifier.padding(top = 3.dp),
                        )

                        // `gap:16px; margin:16px 0 18px` — 18px dots.
                        Row(
                            Modifier.padding(top = 16.dp, bottom = 18.dp),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            repeat(PIN_LENGTH) { i -> PinDot(filled = i < pin.length, next = i == pin.length) }
                        }

                        // `repeat(3,1fr); grid-auto-rows:64px; gap:9px`
                        listOf(
                            listOf("1", "2", "3"),
                            listOf("4", "5", "6"),
                            listOf("7", "8", "9"),
                            listOf("C", "0", "⌫"),
                        ).forEach { row ->
                            Row(
                                Modifier.fillMaxWidth().padding(bottom = 9.dp),
                                horizontalArrangement = Arrangement.spacedBy(9.dp),
                            ) {
                                row.forEach { key ->
                                    PinKey(
                                        enabled = when (key) {
                                            "⌫", "C" -> !busy && pin.isNotEmpty()
                                            else -> canType
                                        },
                                        modifier = Modifier.weight(1f),
                                        onClick = {
                                            press(
                                                when (key) {
                                                    "⌫" -> "back"
                                                    "C" -> "clear"
                                                    else -> key
                                                },
                                            )
                                        },
                                    ) {
                                        if (key == "⌫") {
                                            Icon(
                                                Icons.AutoMirrored.Filled.Backspace,
                                                "Delete last digit",
                                                Modifier.size(21.dp),
                                            )
                                        } else {
                                            Text(
                                                key,
                                                fontFamily = PlexMono,
                                                fontSize = 21.sp,
                                                fontWeight = FontWeight.Medium,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** The checking and ok phases are both `height:434px`, so the panel holds still. */
@Composable
private fun PinPhase(content: @Composable () -> Unit) {
    Column(
        Modifier.height(434.dp).fillMaxWidth(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

/**
 * `height:72px; padding:0 13px; border-radius:14px`, bordered `#1B4249` and
 * filled `#0F3138` — or `#14B8A6` / `#123B41` when this is who is signing in.
 */
@Composable
private fun CashierTile(
    cashier: Cashier,
    selected: Boolean,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        color = if (selected) Handoff.PinPanelOn else Handoff.PinPanel,
        contentColor = Handoff.PinTextBright,
        border = BorderStroke(1.dp, if (selected) Brand500 else Handoff.PinPanelLine),
        modifier = modifier.height(72.dp),
    ) {
        Box {
            Row(
                Modifier.fillMaxSize().padding(horizontal = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(11.dp),
            ) {
                Box(
                    Modifier
                        .size(40.dp)
                        .then(
                            // `0 0 0 2px #14B8A6, 0 0 0 6px rgba(...,.16)` — the
                            // ring only appears on the picked tile.
                            if (selected) {
                                Modifier
                                    .border(6.dp, Brand500.copy(alpha = 0.16f), CircleShape)
                                    .border(2.dp, Brand500, CircleShape)
                            } else {
                                Modifier
                            },
                        )
                        .clip(CircleShape)
                        .background(Handoff.PinKeySelected),
                    Alignment.Center,
                ) {
                    Text(
                        initialsOf(cashier.fullName),
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = Handoff.PinTextBright,
                    )
                }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        cashier.fullName.substringBefore(' '),
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.14).sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(cashier.role, fontSize = 11.sp, color = Handoff.PinTextRole)
                }
            }

            if (selected) {
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(10.dp)
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(Brand500),
                    Alignment.Center,
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        tint = Handoff.PinOnAccent,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
        }
    }
}

/**
 * `width:18px;height:18px` — a 2px inset ring when empty, filled and glowing
 * when typed.
 *
 * The dot waiting for the next digit pulses, which is the design's `kcDotWait`.
 * It is the only motion on the panel, and it is pointing at where the next tap
 * lands.
 */
@Composable
private fun PinDot(filled: Boolean, next: Boolean) {
    val pulse = rememberInfiniteTransition(label = "dot")
    val alpha by pulse.animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(750, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "dotAlpha",
    )

    Box(
        Modifier
            .size(18.dp)
            .alpha(if (filled) 1f else if (next) alpha else 0.55f)
            .clip(CircleShape)
            .then(
                if (filled) {
                    Modifier.background(Brand500)
                } else {
                    Modifier.border(2.dp, Handoff.PinDotEmpty, CircleShape)
                },
            ),
    )
}

/** `background:#16383E; border:1px solid #1F4A50; radius:13px` at 64px. */
@Composable
private fun PinKey(
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(13.dp),
        color = Handoff.PinKey,
        contentColor = Handoff.PinTextBright,
        border = BorderStroke(1.dp, Handoff.PinKeyBorder),
        modifier = modifier.height(64.dp),
    ) {
        Box(Modifier.fillMaxSize(), Alignment.Center) { content() }
    }
}
