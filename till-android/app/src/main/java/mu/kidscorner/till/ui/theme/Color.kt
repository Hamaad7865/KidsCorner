package mu.kidscorner.till.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The web app's brand ramp, converted from its oklch tokens to sRGB.
 *
 * Not matched by eye: `--brand-600: oklch(0.473 0.174 17)` converts to exactly
 * #A71936 — the red inside `kids-corner-favicon.svg`, which is the whole reason
 * the ramp sits where it does. The shop's mark is the source; the app follows
 * it, rather than the two agreeing to differ. Hue is held at 17 the whole way
 * down so no tint drifts pink or orange.
 *
 * A few of the light tints sit fractionally outside sRGB and are clamped — the
 * browser clamps them identically, so the till and the back office render the
 * same colour.
 */

val Brand50 = Color(0xFFFFF2F3)
val Brand100 = Color(0xFFFEE3E3)
val Brand200 = Color(0xFFFFCACB)
val Brand300 = Color(0xFFFFA5A9)
val Brand400 = Color(0xFFF2707B)
val Brand500 = Color(0xFFD2354E)
val Brand600 = Color(0xFFA71936)
val Brand700 = Color(0xFF88132B)
val Brand800 = Color(0xFF6C0F21)
val Brand900 = Color(0xFF560E1A)

/**
 * Neutrals, re-hued to 330 — the plum of the mark's outline (#3F2E3D).
 *
 * They were warm browns, mixed towards the old coral. Against a pure white
 * page a warm grey reads as dirt, so the whole neutral column was moved to a
 * whisper of plum at a third of the chroma: still not grey by measurement,
 * still grey to the eye, and it agrees with the ink instead of fighting it.
 */
val LightBackground = Color(0xFFFFFFFF)
val LightForeground = Color(0xFF241B23)
val LightCard = Color(0xFFFFFFFF)
val LightMuted = Color(0xFFF6F4F5)
val LightMutedForeground = Color(0xFF696268)
val LightBorder = Color(0xFFE3E1E3)

val DarkBackground = Color(0xFF100B10)
val DarkCard = Color(0xFF1D171C)
val DarkForeground = Color(0xFFF8F6F8)
val DarkMuted = Color(0xFF2C272C)
val DarkMutedForeground = Color(0xFFA8A2A8)
val DarkBorder = Color(0xFF373136)

/**
 * Material 3's five surface-container tones, matched to the ramp above.
 *
 * These are not optional. `Card`, `AlertDialog` and the rest resolve their
 * fill from `surfaceContainerHighest` and friends, and a scheme that leaves
 * them unset gets Material's baseline neutrals — which are tinted violet and
 * read as visibly wrong next to the brand red.
 */
val LightSurfaceLowest = Color(0xFFFFFFFF)
val LightSurfaceLow = Color(0xFFFDFBFC)
val LightSurface = Color(0xFFF6F4F5)
val LightSurfaceHigh = Color(0xFFEEECEE)
val LightSurfaceHighest = Color(0xFFE7E4E7)
val LightSurfaceDim = Color(0xFFDCD9DC)

val DarkSurfaceLowest = Color(0xFF080507)
val DarkSurfaceLow = Color(0xFF140F13)
val DarkSurface = Color(0xFF1D171C)
val DarkSurfaceHigh = Color(0xFF262126)
val DarkSurfaceHighest = Color(0xFF373136)
val DarkSurfaceBright = Color(0xFF413B40)

/**
 * Danger is a red on a screen whose brand is also a red, which only works
 * because the two are never the same SHAPE: a primary action is a solid
 * brand fill, a destructive one is this colour as text on its own tint.
 * Hue 30 against the brand's 17 is the difference between fire and wine.
 */
val Destructive = Color(0xFFDC2D1D)
val Success = Color(0xFF298646)
val Warning = Color(0xFFB16D10)
