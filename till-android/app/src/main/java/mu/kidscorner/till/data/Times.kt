package mu.kidscorner.till.data

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/**
 * The two clock formats the handoff prints, and nothing else.
 *
 * `"Sunday 26 July, 08:58"` on the open-shift card and
 * `"Sunday 26 July 2026 · Priya Ramdin · opened 09:02"` at the end of day.
 *
 * Locale is pinned to English rather than the device's: the shop's paperwork,
 * receipts and Z reports are all in English, and a tablet someone set to French
 * should not start printing "dimanche" onto one screen and "Sunday" onto the
 * next.
 */
private val DAY_MONTH = DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.ENGLISH)
private val DAY_MONTH_YEAR = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy", Locale.ENGLISH)
private val CLOCK = DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH)

/** `Sunday 26 July, 08:58` — the open-shift subtitle. */
fun nowDayAndClock(): String =
    LocalDateTime.now().let { "${DAY_MONTH.format(it)}, ${CLOCK.format(it)}" }

/** `Sunday 26 July 2026` — the end-of-day heading. */
fun todayLong(): String = DAY_MONTH_YEAR.format(LocalDateTime.now())

/**
 * `09:02` from whatever the server sent.
 *
 * Postgres hands back `timestamptz` as an offset string; PostgREST sometimes
 * renders it without the `T`. Both are tried, and an unparseable stamp returns
 * null rather than a wrong time — a header that omits "opened 09:02" is a much
 * smaller problem than one that claims the wrong hour.
 */
fun clockOf(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    return try {
        CLOCK.format(Instant.parse(iso).atZone(ZoneId.systemDefault()))
    } catch (_: DateTimeParseException) {
        try {
            CLOCK.format(
                java.time.OffsetDateTime.parse(iso.replace(' ', 'T'))
                    .atZoneSameInstant(ZoneId.systemDefault()),
            )
        } catch (_: DateTimeParseException) {
            null
        }
    }
}
