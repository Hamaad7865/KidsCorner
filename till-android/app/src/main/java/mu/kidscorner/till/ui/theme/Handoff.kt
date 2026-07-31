package mu.kidscorner.till.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The handoff's palette, translated once.
 *
 * `design-handoff/project/Kids Corner POS.dc.html` is reproduced exactly —
 * dimensions, spacing, grid shapes, fonts, structure. The ONE permitted
 * deviation is colour: the handoff is teal, Kids Corner is coral.
 *
 * Every teal in that file is mapped here, by role, so the translation happens
 * in a single place. Doing it per-component is how three slightly different
 * corals end up on one screen.
 *
 * The neutrals are NOT remapped. The handoff's greys are cool (#16333A, #7A8C90,
 * #E3E9EA) and reading them as "close enough" to the app's warm greys would
 * change the whole screen's temperature. They are taken literally, because only
 * the accent was ever the thing to change.
 */
object Handoff {

    // ── accents: teal in the file, coral here ──────────────────────────────
    /** #14B8A6 — the primary accent: focus rings, active chips. */
    val Accent = Brand500

    /** #0E8F87 — solid fills that carry white text: the + button, links. */
    val AccentSolid = Brand600

    /** #0A736D / #0A6E68 — accent text on a tinted ground. */
    val AccentText = Brand800

    /** #E9F6F4 / #F1FAF8 / #EAF6F4 — the tint behind an accent. */
    val AccentTint = Brand50

    /** #CFE8E3 — the border of a tinted accent panel: the balanced drawer. */
    val AccentLine = Brand100

    /** #0C2429 → #123B41 — the near-black scan button. Deep coral-black. */
    val ScanButton = Color(0xFF2A1310)
    val ScanButtonPressed = Color(0xFF3D1D18)
    /** #8FE3D8 — the glyph on it. */
    val ScanGlyph = Brand200

    /** #EAFBF9 — the toast's text on the same near-black, warmed to match. */
    val ToastInk = Color(0xFFFBEFEC)

    // ── the PIN sheet ─────────────────────────────────────────────────────
    //
    // The handoff draws `atPin` on a dark ground. Kids Corner is off-white and
    // red, so it is drawn light here — the layout, the dimensions and the
    // structure are the design's, the temperature is the shop's.
    //
    // This went through two wrong answers first. Warming the design's darks to
    // coral gave a muddy brown; taking them literally gave a cool slate that
    // was faithful but not this shop. Light is the third and it is the right
    // one: it matches every other screen, so the till does not change
    // temperature when it locks.
    /** The sheet behind everything — a shade deeper than the canvas. */
    val PinGround = Color(0xFFF5F0ED)
    /** A keypad key. */
    val PinKey = Color(0xFFFFFFFF)
    /** The avatar well on a tile. */
    val PinKeySelected = Color(0xFFF0E7E3)
    /** A key's border. */
    val PinKeyBorder = Color(0xFFE9E0DC)
    /** The heading. */
    val PinText = Color(0xFF2B2422)
    /** A key's digit, a tile's name. */
    val PinTextBright = Color(0xFF3A302D)
    /** A hint. */
    val PinMuted = Color(0xFF8B7B76)
    /** A wrong PIN. Red, and the only red on the sheet that is not the accent. */
    val PinError = Color(0xFFB4402F)

    // ── the PIN sheet, v2 ─────────────────────────────────────────────────
    /** The keypad panel and an unselected staff tile. */
    val PinPanel = Color(0xFFFFFFFF)
    /** A selected staff tile. */
    val PinPanelOn = Color(0xFFFFF2F1)
    /** The border on both. */
    val PinPanelLine = Color(0xFFECE3DF)
    /** That border after a wrong PIN. */
    val PinPanelLineError = Color(0xFFF5D2CB)
    /** An unfilled dot's ring. */
    val PinDotEmpty = Color(0xFFD6C9C4)
    /** The shop line and "Checking PIN…". */
    val PinTextSoft = Color(0xFF7A6C67)
    /** The sub-line under the heading. */
    val PinTextFaint = Color(0xFF8B7B76)
    /** A staff tile's role, and the welcome sub. */
    val PinTextRole = Color(0xFF9C8B85)
    /** The ink ON the accent: the KC mark's letters, the success tick. */
    val PinOnAccent = Color(0xFFFFFFFF)

    // ── the change-due panel on `atComplete` ──────────────────────────────
    //
    // #FFF3F0 / #F7D8D0 / #B4402F / #A83A28 — the handoff is ALREADY warm here,
    // so these are its own values, untouched.
    val ChangeTint = Color(0xFFFFF3F0)
    val ChangeLine = Color(0xFFF7D8D0)
    val ChangeLabel = Color(0xFFB4402F)
    val ChangeFigure = Color(0xFFA83A28)
    /** #B07568 — the line under the change figure. */
    val ChangeNote = Color(0xFFB07568)

    // ── neutrals: taken from the handoff literally ─────────────────────────
    /** #F3F6F6 — the screen behind everything. */
    val Canvas = Color(0xFFFAF7F5)

    /** #FFFFFF — cards, tiles, the search field. */
    val Surface = Color(0xFFFFFFFF)

    /** #E9EEEF — the page ground outside the frame. */
    val Ground = Color(0xFFF0EBE8)

    /** #16333A — body text. */
    val Ink = Color(0xFF2B2422)

    /** #0F2E33 — figures, a shade darker than body text. */
    val InkFigure = Color(0xFF241D1B)

    /** #22383C — text on a secondary button. */
    val InkStrong = Color(0xFF3A302D)

    /** #4A6165 — secondary text. */
    val Muted = Color(0xFF5C4F4B)

    /** #6B7E82 — tertiary text. */
    val Muted2 = Color(0xFF7A6C67)

    /** #7A8C90 — labels under a heading. */
    val Muted3 = Color(0xFF8B7B76)

    /** #8A9DA1 — the search icon, the sizes label. */
    val Muted4 = Color(0xFF9C8B85)

    /** #9BABAE — placeholder text, a struck-through price. */
    val Faint = Color(0xFFAC9C96)

    /** #A3B2B5 — the IMG slot's own label. */
    val Fainter = Color(0xFFB4A49E)

    /** #C4D2D4 — the empty-cart glyph. */
    val Ghost = Color(0xFFD2C5C0)

    // ── lines ─────────────────────────────────────────────────────────────
    /** #DAE3E4 — the search field and secondary buttons. */
    val Line = Color(0xFFE5DBD7)

    /** #E3E9EA — tiles and result rows. */
    val LineSoft = Color(0xFFECE3DF)

    /** #E1E8E9 — the chrome bar's underline. */
    val LineChrome = Color(0xFFEAE1DD)

    /** #F1F4F5 — between cart lines. */
    val LineFaint = Color(0xFFF5EFEC)

    /** #C9D6D8 — the Hold button, which is bordered more strongly. */
    val LineStrong = Color(0xFFD6C9C4)

    /** #DFE7E8 — keypad keys and the amount wells they type into. */
    val LineField = Color(0xFFE9E0DC)

    /** #E7EDEE — a panel that is waiting for input: the uncounted drawer. */
    val LineIdle = Color(0xFFF0E8E5)

    /** #F1F5F5 / #F3F7F7 — an inset well: the clear button, the IMG slot. */
    val Well = Color(0xFFF6F1EE)
    val Well2 = Color(0xFFF8F3F0)
    val WellPressed = Color(0xFFEDE5E1)

    /** #F7FAFA — the well a figure is typed into: the float, the drawer count. */
    val FieldWell = Color(0xFFFBF7F5)

    /**
     * #EDF3F3 / #4A6165 — a list avatar.
     *
     * The handoff gives the accent tint only to the person ON the till and to
     * the customer attached to the sale. Everyone in a list gets this neutral,
     * so a column of names reads as names rather than as a row of buttons.
     */
    val AvatarTint = Color(0xFFF4EDEA)
    val AvatarInk = Color(0xFF5C4F4B)

    /** #E4EFEF / #B6C9CB — a keypad key under the thumb. */
    val KeyPressed = Color(0xFFF0E7E3)
    val KeyPressedLine = Color(0xFFCBBAB4)

    // ── states ────────────────────────────────────────────────────────────
    /** #B4402F — destructive: "Clear sale?", a discount badge. */
    val Danger = Color(0xFFB4402F)
    /** #FDECEA / #F5D2CB — its tint and border. */
    val DangerTint = Color(0xFFFDECEA)
    val DangerLine = Color(0xFFF5D2CB)

    /** #FFF1DE / #9A5B12 — the held-sales count badge. */
    val WarnTint = Color(0xFFFFF1DE)
    val WarnText = Color(0xFF9A5B12)

    /**
     * #EFF3F3 / #A3B2B5 — `primaryBlocked`.
     *
     * The handoff does not dim the accent for an action that is not ready; it
     * replaces the button with a flat well. Worth copying: a pale coral button
     * still reads as a button, and a cashier taps it and waits.
     */
    val Blocked = Color(0xFFF4EEEB)
    val BlockedText = Color(0xFFB4A49E)
}
