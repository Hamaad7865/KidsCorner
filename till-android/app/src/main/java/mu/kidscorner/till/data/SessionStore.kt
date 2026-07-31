package mu.kidscorner.till.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Where the device's Supabase tokens live between launches.
 *
 * Encrypted, with the key held in the Android Keystore rather than in the file.
 * The refresh token is the shop's standing credential — anything holding it can
 * mint access tokens indefinitely — and a till is a device that sits unattended
 * in a shop all day. Plain SharedPreferences would put it in a world-readable-
 * to-root XML file that survives a backup.
 *
 * `allowBackup="false"` in the manifest is the other half of that: without it,
 * an ADB backup would carry these off the device.
 *
 * On the deprecation: Google retired androidx.security-crypto without shipping
 * a replacement — the suggested path is hand-rolling Keystore-wrapped AES-GCM,
 * which is the same thing with more places to get it wrong. It is kept, and
 * kept behind this one class, so replacing it later touches nothing else.
 */
@Suppress("DEPRECATION")
class SessionStore(context: Context) {

    /**
     * This install's device code, generated once and kept for good.
     *
     * Not the Android ID or the serial: both are either unavailable without
     * privileged permissions or shared across a factory reset, and neither is
     * what the shop means by "this till". A UUID minted on first run is stable
     * for exactly as long as the app is installed, which is the right lifetime
     * — a wiped tablet is a new till, and should appear as one.
     */
    val deviceCode: String
        get() = prefs.getString(KEY_DEVICE_CODE, null) ?: java.util.UUID.randomUUID()
            .toString()
            .also { prefs.edit().putString(KEY_DEVICE_CODE, it).apply() }

    private val prefs: SharedPreferences = run {
        val key = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "till-session",
            key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    var accessToken: String?
        get() = prefs.getString(KEY_ACCESS, null)
        set(value) = prefs.edit().putString(KEY_ACCESS, value).apply()

    var refreshToken: String?
        get() = prefs.getString(KEY_REFRESH, null)
        set(value) = prefs.edit().putString(KEY_REFRESH, value).apply()

    /** Epoch seconds. Used to refresh a little early rather than on a 401. */
    var expiresAt: Long
        get() = prefs.getLong(KEY_EXPIRES, 0L)
        set(value) = prefs.edit().putLong(KEY_EXPIRES, value).apply()

    val isSignedIn: Boolean get() = !refreshToken.isNullOrBlank()

    fun save(session: AuthSession) {
        prefs.edit()
            .putString(KEY_ACCESS, session.accessToken)
            .putString(KEY_REFRESH, session.refreshToken)
            .putLong(KEY_EXPIRES, session.expiresAt)
            .apply()
    }

    fun clear() = prefs.edit().clear().apply()

    private companion object {
        const val KEY_DEVICE_CODE = "device_code"
        const val KEY_ACCESS = "access_token"
        const val KEY_REFRESH = "refresh_token"
        const val KEY_EXPIRES = "expires_at"
    }
}
