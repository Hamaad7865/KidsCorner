package mu.kidscorner.till.data

import android.content.Context
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/**
 * Provisional offline sale references: `OFF-07-260914-012`.
 *
 * WHY NOT `S...`.
 *
 * `sale_no` (`SYYMMDD-N`) is allocated inside the sale transaction by
 * `next_doc_no('sale')` (migration 027). A row lock makes it gapless: an abort
 * gives the number back, two tills serialise on the day row. A tablet that
 * mints `S...` offline cannot do any of that — two tills mint the same number,
 * an aborted offline sale burns one forever, midnight rolls the day prefix.
 * On sync the second insert hits `sales.sale_no UNIQUE` and fails, after the
 * customer has already left with duplicate paper.
 *
 * So an offline sale gets an `OFF-` ref that can never collide with a final
 * number: per-device, per-day, monotonic. The server still assigns the final
 * `S...` on drain; the till keeps `OFF-... -> S...` for the badge and toast so
 * the shop can see what sent as what.
 *
 * Format: `OFF-<deviceTag>-<YYMMDD>-<NNN>`.
 * - `deviceTag`: 2-digit registry id (`07`), `00` when unknown. Uniqueness
 *   across tills comes from here; two tills never share a tag while both have
 *   bootstrapped (registry ids are unique per shop).
 * - `YYMMDD`: shop day of checkout (system zone — tablets live on Mauritius
 *   time, same assumption as `localDateOf`).
 * - `NNN`: per-device per-day sequence, zero-padded to 3, persisted. Resets
 *   each day. Monotonic, never reused, even if the sale later fails to queue
 *   (a burned OFF number is harmless — unlike a burned S number, nobody audits
 *   OFF gaps).
 *
 * CODE39-safe by construction: A-Z, 0-9 and `-` only, which is also what the
 * receipt barcode needs.
 */
object OfflineRefs {
    private val DAY_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyMMdd")
    private const val PREFIX = "OFF"

    /** Pure format, testable without a device. */
    fun format(deviceTag: String, dayYyMmDd: String, seq: Int): String {
        val tag = deviceTag.filter { it.isDigit() }.takeLast(2).padStart(2, '0')
            .ifEmpty { "00" }
        val day = dayYyMmDd.filter { it.isDigit() }.take(6).padStart(6, '0')
        return "$PREFIX-$tag-$day-${seq.toString().padStart(3, '0')}"
    }

    /** `07` from registry id 7, `00` when the till does not know itself yet. */
    fun deviceTag(deviceId: Int?): String =
        if (deviceId == null) "00" else (deviceId % 100).toString().padStart(2, '0')

    fun dayOf(date: LocalDate): String = date.format(DAY_FMT)

    /** `S260914-12` must never be mistaken for provisional (and vice versa). */
    fun isProvisional(ref: String?): Boolean =
        ref?.startsWith("$PREFIX-") == true

    fun isFinalSaleNo(ref: String?): Boolean =
        ref != null && Regex("^S\\d{6}-\\d+$").matches(ref)
}

/**
 * Per-device per-day sequence, persisted in plain prefs (not a secret).
 *
 * Synchronized: `confirmSale` and `parkFrozenSale` both allocate, and two
 * rapid confirms must not mint the same ref. Day rollover resets to 1.
 */
class OfflineRefAllocator(context: Context) {
    private val prefs = context.getSharedPreferences("till-offline-refs", Context.MODE_PRIVATE)

    @Synchronized
    fun next(deviceId: Int?, todayYyMmDd: String): String {
        val storedDay = prefs.getString(KEY_DAY, null)
        val nextSeq = if (storedDay == todayYyMmDd) {
            prefs.getInt(KEY_SEQ, 0) + 1
        } else {
            1
        }
        prefs.edit().putString(KEY_DAY, todayYyMmDd).putInt(KEY_SEQ, nextSeq).apply()
        return OfflineRefs.format(OfflineRefs.deviceTag(deviceId), todayYyMmDd, nextSeq)
    }

    private companion object {
        const val KEY_DAY = "day"
        const val KEY_SEQ = "seq"
    }
}
