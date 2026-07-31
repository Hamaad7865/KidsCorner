package mu.kidscorner.till.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The web app's brand ramp, converted from its oklch tokens to sRGB.
 *
 * Not matched by eye: `--brand-500: oklch(0.678 0.174 26)` converts to exactly
 * #F0645C, the coral named in the spec, which is how the rest of the ramp is
 * known to be right too. A few of the light tints sit fractionally outside sRGB
 * and are clamped — the browser clamps them identically, so the till and the
 * back office render the same colour.
 */

val Brand50 = Color(0xFFFFF2F1)
val Brand100 = Color(0xFFFFE4E0)
val Brand200 = Color(0xFFFFCDC7)
val Brand300 = Color(0xFFFFAFA6)
val Brand400 = Color(0xFFFE877D)
val Brand500 = Color(0xFFF0645C)
val Brand600 = Color(0xFFC94A44)
val Brand700 = Color(0xFFA83A35)
val Brand800 = Color(0xFF89302C)
val Brand900 = Color(0xFF712B27)

val LightBackground = Color(0xFFFDFAFA)
val LightForeground = Color(0xFF1B1615)
val LightCard = Color(0xFFFFFFFF)
val LightMuted = Color(0xFFF8F3F2)
val LightMutedForeground = Color(0xFF736968)
val LightBorder = Color(0xFFE7E3E1)

val DarkBackground = Color(0xFF110C0B)
val DarkCard = Color(0xFF1D1817)
val DarkForeground = Color(0xFFF9F6F5)
val DarkMuted = Color(0xFF2D2727)
val DarkMutedForeground = Color(0xFFABA2A1)
val DarkBorder = Color(0xFF322C2B)

/**
 * Material 3's five surface-container tones, warmed to match the ramp above.
 *
 * These are not optional. `Card`, `AlertDialog` and the rest resolve their
 * fill from `surfaceContainerHighest` and friends, and a scheme that leaves
 * them unset gets Material's baseline neutrals — which are tinted violet and
 * read as visibly wrong next to coral.
 */
val LightSurfaceLowest = Color(0xFFFFFFFF)
val LightSurfaceLow = Color(0xFFFDFAFA)
val LightSurface = Color(0xFFF8F3F2)
val LightSurfaceHigh = Color(0xFFF3EDEC)
val LightSurfaceHighest = Color(0xFFEEE7E5)
val LightSurfaceDim = Color(0xFFE4DDDB)

val DarkSurfaceLowest = Color(0xFF0B0808)
val DarkSurfaceLow = Color(0xFF171211)
val DarkSurface = Color(0xFF1D1817)
val DarkSurfaceHigh = Color(0xFF262020)
val DarkSurfaceHighest = Color(0xFF322C2B)
val DarkSurfaceBright = Color(0xFF393231)

val Destructive = Color(0xFFC02349)
val Success = Color(0xFF298646)
val Warning = Color(0xFFB67700)
