package mu.kidscorner.till.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.ui.theme.Brand500
import mu.kidscorner.till.ui.theme.Handoff

/**
 * The card every modal in the handoff is built on.
 *
 * `position:absolute; inset:0; background:rgba(9,28,32,.44)` behind a card at
 * `border-radius:18px` with `box-shadow:0 24px 60px rgba(9,28,32,.28)`, and a
 * header of `padding:18px 20px 14px` carrying a 48px close key on `#F5F8F8`.
 *
 * The width differs per modal — 940px for the variant matrix, 640px for held
 * sales, 580px for the customer — so it is a parameter and everything else is
 * fixed. Written once because three near-identical copies is how three modals
 * end up with three slightly different headers.
 */
@Composable
fun HandoffDialog(
    title: String,
    width: Int,
    onDismiss: () -> Unit,
    subtitle: String? = null,
    maxHeight: Int = 660,
    divided: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
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
                .width(width.dp)
                .heightIn(max = maxHeight.dp)
                // Swallowed, so a tap inside the card does not dismiss it.
                .clickable(interactionSource = noRipple, indication = null, onClick = {}),
        ) {
            Column {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            title,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold,
                            letterSpacing = (-0.36).sp,
                            color = Handoff.Ink,
                        )
                        subtitle?.let {
                            Text(
                                it,
                                fontSize = 12.5.sp,
                                color = Handoff.Muted3,
                                modifier = Modifier.padding(top = 3.dp),
                            )
                        }
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

                if (divided) {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineSoft))
                }

                content()
            }
        }
    }
}

/**
 * The round initials the handoff puts beside a person or a held sale.
 *
 * `avatar(tint, ink, size)` in the handoff: a circle at `size`, initials at
 * `round(size * .37)` and weight 700. Tinted rather than solid, so a list of
 * them reads as a column of names and not as a row of buttons.
 *
 * The handoff gives the list avatars a neutral `#EDF3F3` / `#4A6165` and the
 * *person on the till* the accent tint. Both are offered here rather than
 * baking one in, because using the accent for everyone turns a quiet list of
 * names into a row of buttons — which is the thing the tint was avoiding.
 */
@Composable
fun Avatar(
    name: String,
    size: Int = 40,
    solid: Boolean = false,
    tint: Color = Handoff.AccentTint,
    ink: Color = Handoff.AccentText,
) {
    Box(
        Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(if (solid) Brand500 else tint),
        Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            fontSize = kotlin.math.round(size * 0.37f).sp,
            fontWeight = FontWeight.Bold,
            color = if (solid) Color.White else ink,
        )
    }
}
