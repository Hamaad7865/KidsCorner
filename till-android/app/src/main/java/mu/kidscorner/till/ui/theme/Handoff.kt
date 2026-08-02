package mu.kidscorner.till.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * The handoff's palette, translated once.
 *
 * `design-handoff/project/Kids Corner POS.dc.html` is reproduced exactly —
 * dimensions, spacing, grid shapes, fonts, structure. The ONE permitted
 * deviation is colour: the handoff is teal, Kids Corner is red.
 *
 * Every teal in that file is mapped here, by role, so the translation happens
 * in a single place. Doing it per-component is how three slightly different
 * reds end up on one screen.
 *
 * ── white and red ──
 *
 * The screen is WHITE. Not cream, not a warm near-white: #FFFFFF, the same
 * white as the cards on it. Panels are told apart from the page by a hairline,
 * and the only tinted surfaces left are the ones that are meant to sink — a
 * search field, a keypad well, the slot a photo has not loaded into yet.
 *
 * That leaves a resting till with exactly two colours on it: the brand red,
 * and whatever colour the clothes in the basket happen to be. It is the whole
 * point of the palette, and every token below is chosen to protect it.
 *
 * The neutrals are re-hued to 330 — the plum of the mark's own outline. They
 * used to be warm browns mixed toward the old coral, which against a white
 * page read as dirt rather than as grey. Each one kept its lightness exactly
 * and gave up two thirds of its chroma, so every contrast relationship the
 * handoff drew still holds.
 */
object Handoff {

    // ── accents: teal in the file, the mark's red here ─────────────────────
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

    /** #0C2429 → #123B41 — the near-black scan button. */
    val ScanButton = Color(0xFF1E181D)
    val ScanButtonPressed = Color(0xFF2B252B)
    /** #8FE3D8 — the glyph on it. */
    val ScanGlyph = Brand200

    /** #EAFBF9 — the toast's text on the same near-black. */
    val ToastInk = Color(0xFFF4F1F3)

    // ── the PIN sheet ─────────────────────────────────────────────────────
    //
    // The handoff draws `atPin` on a dark ground. Kids Corner is white and
    // red, so it is drawn light here — the layout, the dimensions and the
    // structure are the design's, the temperature is the shop's.
    //
    // This went through two wrong answers first. Warming the design's darks to
    // the accent gave a muddy brown; taking them literally gave a cool slate
    // that was faithful but not this shop. Light is the third and it is the
    // right one: it matches every other screen, so the till does not change
    // temperature when it locks.
    /** The sheet behind everything — a shade deeper than the canvas. */
    val PinGround = Color(0xFFF2F1F2)
    /** A keypad key. */
    val PinKey = Color(0xFFFFFFFF)
    /** The avatar well on a tile. */
    val PinKeySelected = Color(0xFFEBE8EA)
    /** A key's border. */
    val PinKeyBorder = Color(0xFFE4E1E3)
    /** The heading. */
    val PinText = Color(0xFF272527)
    /** A key's digit, a tile's name. */
    val PinTextBright = Color(0xFF343234)
    /** A hint. */
    val PinMuted = Color(0xFF827D81)
    /** A wrong PIN. The danger red, which on this sheet is the only red that
     *  is not the brand — and it is a different red, deliberately. */
    val PinError = Destructive

    // ── the PIN sheet, v2 ─────────────────────────────────────────────────
    /** The keypad panel and an unselected staff tile. */
    val PinPanel = Color(0xFFFFFFFF)
    /** A selected staff tile. */
    val PinPanelOn = Brand50
    /** The border on both. */
    val PinPanelLine = Color(0xFFE7E4E6)
    /** That border after a wrong PIN. */
    val PinPanelLineError = Color(0xFFFFC6BC)
    /** An unfilled dot's ring. */
    val PinDotEmpty = Color(0xFFCECBCE)
    /** The shop line and "Checking PIN…". Its own value rather than Muted2's:
     *  it sits on PinGround, not on white, where 4.45:1 was a whisker under. */
    val PinTextSoft = Color(0xFF686167)
    /**
     * The "4-digit PIN" hint under the picked name, on the white panel.
     *
     * Was `#827D81`, which measured 4.04:1 there — the same value and the same
     * shortfall `Muted3` was corrected for, spotted the same way once the
     * contrast check was pointed at this screen. The sub-line under the
     * heading, which used to share this, sits on PinGround and now uses
     * PinTextSoft: two grounds want two greys, and one of them was reading as
     * both.
     */
    val PinTextFaint = Color(0xFF736C72)
    /** A staff tile's role, and the welcome sub. */
    val PinTextRole = Color(0xFF928E91)
    /** The ink ON the accent: the KC mark's letters, the success tick. */
    val PinOnAccent = Color(0xFFFFFFFF)

    // ── the change-due panel on `atComplete` ──────────────────────────────
    //
    // #FFF3F0 / #F7D8D0 / #B4402F / #A83A28 — the handoff draws this warm and
    // separate from its accent. Here it IS the accent: change due is the one
    // figure a customer leans over the counter to read, and the brand red is
    // the loudest thing the palette owns. It cannot be mistaken for an error
    // because errors are the other red, and they never appear on this screen.
    val ChangeTint = Brand50
    val ChangeLine = Color(0xFFFCC8C9)
    val ChangeLabel = Brand600
    val ChangeFigure = Brand700
    /** #B07568 — the line under the change figure. */
    val ChangeNote = Color(0xFFA77879)

    // ── neutrals ──────────────────────────────────────────────────────────
    /** The screen behind everything. White, and that is the palette. */
    val Canvas = Color(0xFFFFFFFF)

    /** #FFFFFF — cards, tiles, the search field. The same white as the page:
     *  a panel is a panel because of its hairline, not because of its fill. */
    val Surface = Color(0xFFFFFFFF)

    /** #16333A — body text. */
    val Ink = Color(0xFF272527)

    /** #0F2E33 — figures, a shade darker than body text. */
    val InkFigure = Color(0xFF201E20)

    /** #22383C — text on a secondary button. */
    val InkStrong = Color(0xFF343234)

    /** #4A6165 — secondary text. */
    val Muted = Color(0xFF545154)

    /** #6B7E82 — tertiary text. */
    val Muted2 = Color(0xFF726E71)

    /**
     * #7A8C90 — labels under a heading, and the most-used muted tone on the
     * till by a distance.
     *
     * Darkened from #827D81, which measured 4.04:1 on a card and 3.62:1
     * inside an inset well. This carries plain label text on a screen read
     * across a counter, so it has less margin to spare than a desktop page,
     * not more. Now 5.10 and 4.57.
     */
    val Muted3 = Color(0xFF736C72)

    /** #8A9DA1 — the search icon, the sizes label. */
    val Muted4 = Color(0xFF928E91)

    /** #9BABAE — placeholder text, a struck-through price. */
    val Faint = Color(0xFFA39EA2)

    /** #A3B2B5 — the IMG slot's own label. */
    val Fainter = Color(0xFFABA6AA)

    /** #C4D2D4 — the empty-cart glyph. */
    val Ghost = Color(0xFFCAC7CA)

    // ── lines ─────────────────────────────────────────────────────────────
    //
    // These do more work than they did. On a cream page a panel was visible
    // before its border was; on a white one the border IS the panel, so every
    // line below is a structural element rather than a finishing touch.
    /** #DAE3E4 — the search field and secondary buttons. */
    val Line = Color(0xFFDFDCDF)

    /** #E3E9EA — tiles and result rows. */
    val LineSoft = Color(0xFFE7E4E6)

    /** #E1E8E9 — the chrome bar's underline. */
    val LineChrome = Color(0xFFE5E2E4)

    /** #F1F4F5 — between cart lines. */
    val LineFaint = Color(0xFFF1F0F1)

    /** #C9D6D8 — the Hold button, which is bordered more strongly. */
    val LineStrong = Color(0xFFCECBCE)

    /** #DFE7E8 — keypad keys and the amount wells they type into. */
    val LineField = Color(0xFFE4E1E3)

    /** #E7EDEE — a panel that is waiting for input: the uncounted drawer. */
    val LineIdle = Color(0xFFEBE9EB)

    /** #F1F5F5 / #F3F7F7 — an inset well: the clear button, the IMG slot. */
    val Well = Color(0xFFF3F2F3)
    val Well2 = Color(0xFFF5F4F5)
    val WellPressed = Color(0xFFE8E6E8)

    /** #F7FAFA — the well a figure is typed into: the float, the drawer count. */
    val FieldWell = Color(0xFFF9F7F8)

    /**
     * #EDF3F3 / #4A6165 — a list avatar.
     *
     * The handoff gives the accent tint only to the person ON the till and to
     * the customer attached to the sale. Everyone in a list gets this neutral,
     * so a column of names reads as names rather than as a row of buttons.
     */
    val AvatarTint = Color(0xFFF0EEF0)
    val AvatarInk = Color(0xFF545154)

    /** #E4EFEF / #B6C9CB — a keypad key under the thumb. */
    val KeyPressed = Color(0xFFEBE8EA)
    val KeyPressedLine = Color(0xFFC1BCC0)

    // ── states ────────────────────────────────────────────────────────────
    /**
     * #B4402F — destructive: "Clear sale?", a discount badge.
     *
     * A red on a screen whose brand is also a red. That only works because the
     * two are never the same shape: the brand is a solid fill under white
     * text, danger is this colour as text on its own tint. Hue 30 against the
     * brand's 17 is the difference between fire and wine.
     */
    val Danger = Destructive
    /** #FDECEA / #F5D2CB — its tint and border. */
    val DangerTint = Color(0xFFFFEAE6)
    val DangerLine = Color(0xFFFFC6BC)

    /**
     * #FFF1DE / #9A5B12 — anything the shop should look at but need not fix
     * now: the held-sales badge, the offline pill, a hand-typed price.
     *
     * One amber, four uses. There used to be four ambers — #FFF1DE, #FFF6EC,
     * #FFF3DF and #FFF9EF — each within a couple of points of the others and
     * each written out as a literal at the place it was needed, which is
     * exactly the failure this file exists to prevent. The dot is the mark's
     * own tan, so even the warning colour comes from the logo.
     */
    val WarnTint = Color(0xFFFFF1DE)
    val WarnLine = Color(0xFFF3DCBB)
    val WarnDot = Color(0xFFECA65B)
    val WarnText = Color(0xFF9A5B12)

    /**
     * The scrim behind a dialog.
     *
     * Plum at 44%, matching the ink. It was a cool near-black (#091C20) held
     * over from the handoff, and a cool scrim over a warm page tints the
     * whole screen green for as long as the dialog is up.
     */
    val Scrim = Color(0x70241B23)

    /**
     * #EFF3F3 / #A3B2B5 — `primaryBlocked`.
     *
     * The handoff does not dim the accent for an action that is not ready; it
     * replaces the button with a flat well. Worth copying: a pale red button
     * still reads as a button, and a cashier taps it and waits.
     */
    val Blocked = Color(0xFFF0EFF0)
    val BlockedText = Color(0xFFABA6AA)
}
