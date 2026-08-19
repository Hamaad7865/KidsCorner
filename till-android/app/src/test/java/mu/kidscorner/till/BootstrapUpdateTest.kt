package mu.kidscorner.till

import mu.kidscorner.till.data.Bootstrap
import mu.kidscorner.till.data.DeviceInfo
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `Bootstrap.updateAvailable` — the sole rule deciding whether the pill and
 * [mu.kidscorner.till.data.AppUpdater] ever hear about a published release.
 *
 * Deliberately strict: it takes a positive published versionCode, a genuinely
 * newer one than this build, AND an apkUrl to download from. Missing any one
 * of the three means there is nothing to safely offer.
 */
class BootstrapUpdateTest {

    private fun bootstrap(latestVersionCode: Long?, apkUrl: String?) = Bootstrap(
        device = DeviceInfo("d1", "Till 1", "owner"),
        shopName = "Kids Corner",
        paymentMethods = listOf("cash"),
        latestVersionCode = latestVersionCode,
        latestVersionName = "Till v0.2.0",
        apkUrl = apkUrl,
    )

    @Test
    fun `newer than the running build, with a download url, counts as available`() {
        val fresh = bootstrap(
            latestVersionCode = (BuildConfig.VERSION_CODE + 1).toLong(),
            apkUrl = "https://example.test/till.apk",
        )
        assertTrue(fresh.updateAvailable)
    }

    @Test
    fun `the same versionCode as the running build is not an update`() {
        val fresh = bootstrap(
            latestVersionCode = BuildConfig.VERSION_CODE.toLong(),
            apkUrl = "https://example.test/till.apk",
        )
        assertFalse(fresh.updateAvailable)
    }

    @Test
    fun `an older versionCode than the running build is not an update`() {
        // Reachable if a bad release ever got published, or a device sits on
        // a debug build ahead of what GitHub has — either way, never offer
        // to install something older than what is already running.
        val fresh = bootstrap(
            latestVersionCode = maxOf(0, BuildConfig.VERSION_CODE - 1).toLong(),
            apkUrl = "https://example.test/till.apk",
        )
        assertFalse(fresh.updateAvailable)
    }

    @Test
    fun `no versionCode at all is not an update`() {
        assertFalse(bootstrap(latestVersionCode = null, apkUrl = "https://example.test/till.apk").updateAvailable)
    }

    @Test
    fun `a versionCode with no download url is not an update`() {
        // Never reachable through the real bootstrap contract (the two travel
        // together), but the property must not crash or offer a null URL.
        assertFalse(
            bootstrap(
                latestVersionCode = (BuildConfig.VERSION_CODE + 1).toLong(),
                apkUrl = null,
            ).updateAvailable,
        )
    }
}
