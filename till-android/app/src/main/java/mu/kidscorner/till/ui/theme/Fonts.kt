@file:OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)

package mu.kidscorner.till.ui.theme

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import mu.kidscorner.till.R

/**
 * The two faces the handoff specifies.
 *
 *     font-family:"Instrument Sans", system-ui, sans-serif   — everything
 *     font-family:'IBM Plex Mono', monospace                 — every figure
 *
 * The monospace is not decoration. Every price, total and quantity in the design
 * is set in it, so a column of figures lines up digit under digit — which is the
 * whole reason a till screen is readable at a glance while a customer waits.
 */

/**
 * Instrument Sans ships as a VARIABLE font — Google publishes no static cuts —
 * so the weight comes from the `wght` axis rather than from separate files.
 * Supported from API 26, which is this app's minimum.
 */
private fun instrument(weight: Int) = Font(
    R.font.instrument_sans,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
    weight = FontWeight(weight),
)

val InstrumentSans = FontFamily(
    instrument(400),
    instrument(500),
    instrument(600),
    instrument(700),
)

/** IBM Plex Mono does ship static cuts, so these are the real files. */
val PlexMono = FontFamily(
    Font(R.font.ibm_plex_mono_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_mono_medium, FontWeight.Medium),
    Font(R.font.ibm_plex_mono_semibold, FontWeight.SemiBold),
)
