package mu.kidscorner.till.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Density
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val LightColors = lightColorScheme(
    primary = Brand600,
    onPrimary = LightCard,
    primaryContainer = Brand50,
    onPrimaryContainer = Brand800,
    secondary = Brand500,
    onSecondary = LightCard,
    background = LightBackground,
    onBackground = LightForeground,
    surface = LightCard,
    onSurface = LightForeground,
    surfaceVariant = LightMuted,
    onSurfaceVariant = LightMutedForeground,
    surfaceContainerLowest = LightSurfaceLowest,
    surfaceContainerLow = LightSurfaceLow,
    surfaceContainer = LightSurface,
    surfaceContainerHigh = LightSurfaceHigh,
    surfaceContainerHighest = LightSurfaceHighest,
    surfaceBright = LightCard,
    surfaceDim = LightSurfaceDim,
    outline = LightBorder,
    outlineVariant = LightBorder,
    error = Destructive,
    onError = LightCard,
)

private val DarkColors = darkColorScheme(
    primary = Brand500,
    onPrimary = Brand900,
    primaryContainer = Brand800,
    onPrimaryContainer = Brand100,
    secondary = Brand400,
    onSecondary = Brand900,
    background = DarkBackground,
    onBackground = DarkForeground,
    surface = DarkCard,
    onSurface = DarkForeground,
    surfaceVariant = DarkMuted,
    onSurfaceVariant = DarkMutedForeground,
    surfaceContainerLowest = DarkSurfaceLowest,
    surfaceContainerLow = DarkSurfaceLow,
    surfaceContainer = DarkSurface,
    surfaceContainerHigh = DarkSurfaceHigh,
    surfaceContainerHighest = DarkSurfaceHighest,
    surfaceBright = DarkSurfaceBright,
    surfaceDim = DarkBackground,
    outline = DarkBorder,
    outlineVariant = DarkBorder,
    error = Destructive,
    onError = DarkForeground,
)

/**
 * Type scaled up from Material's defaults.
 *
 * This is read at arm's length on a wall-mounted tablet by someone who is also
 * looking at a customer, not held 30cm from the face. Material's 16sp body is
 * sized for a phone in the hand.
 */
private val TillTypography = Typography(
    displayLarge = TextStyle(fontSize = 57.sp, lineHeight = 64.sp, fontWeight = FontWeight.Bold),
    headlineLarge = TextStyle(fontSize = 36.sp, lineHeight = 44.sp, fontWeight = FontWeight.Bold),
    headlineMedium = TextStyle(fontSize = 30.sp, lineHeight = 38.sp, fontWeight = FontWeight.SemiBold),
    headlineSmall = TextStyle(fontSize = 25.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 23.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 19.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium),
    bodyLarge = TextStyle(fontSize = 19.sp, lineHeight = 28.sp),
    bodyMedium = TextStyle(fontSize = 17.sp, lineHeight = 24.sp),
    labelLarge = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
)

/**
 * The logical width every till screen is laid out against.
 *
 * A 15" shop panel reports 2048dp across at its native density, so a 96dp key
 * lands at about 0.6" — too small to hit without looking down, which is the one
 * thing a cashier facing a customer cannot do. Rather than sizing each control
 * per device, the density is scaled so the window is always about this many dp
 * wide, and every dp in the app becomes a fixed fraction of the panel.
 *
 * Same idea as the web till's `clamp()` on the root font size, and the same
 * reason: one number to tune instead of a breakpoint per screen.
 *
 * 1400 puts a keypad key at roughly 0.9" and body text at about 4.4mm on that
 * 15" panel — well past the ~9mm touch-target floor, while still fitting enough
 * of the catalog on screen to be worth tapping through. 1000 was the first try
 * and was visibly too large: correct for the thumb, wrong for the eye.
 */
private const val TARGET_WIDTH_DP = 1400f

@Composable
fun KidsCornerTillTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val window = LocalWindowInfo.current
    val base = LocalDensity.current

    val scaled = remember(window.containerSize.width, base.density, base.fontScale) {
        val widthDp = window.containerSize.width / base.density
        // Never shrinks. On a phone-sized screen this is already 1f, and scaling
        // below it would make a till unreadable rather than merely cramped.
        val factor = (widthDp / TARGET_WIDTH_DP).coerceIn(1f, 2.5f)
        // fontScale is left alone so the device's accessibility text setting
        // still applies on top of this.
        Density(base.density * factor, base.fontScale)
    }

    // Deliberately not `dynamicColor`. A shop's till should look like Kids
    // Corner on every tablet it is installed on, not like whatever wallpaper
    // the device happens to have.
    CompositionLocalProvider(LocalDensity provides scaled) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColors else LightColors,
            typography = TillTypography,
            content = content,
        )
    }
}
