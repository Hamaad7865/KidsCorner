package mu.kidscorner.till

import mu.kidscorner.till.data.Bootstrap
import mu.kidscorner.till.data.CartLine
import mu.kidscorner.till.data.Cashier
import mu.kidscorner.till.data.DeviceInfo
import mu.kidscorner.till.data.OpenShift
import mu.kidscorner.till.data.cartTotals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/**
 * Folding a fresh VAT policy into a live basket, mid-trade.
 *
 * This is the pure reducer [applyBootstrapPolicy] the checkout refresh runs
 * through. What it must defend: a policy that changes under a cashier's hands
 * updates the contained-VAT display and the current policy id, but never the
 * shift they are trading on, the basket they have built, or the total the
 * customer is about to pay — prices are VAT-inclusive, so the total is the same
 * figure whether or not VAT is charged inside it.
 */
class VatPolicySyncTest {

    private val cashier = Cashier("s1", "Priya", "owner", hasPin = true)

    private fun shop(
        enabled: Boolean,
        rate: Double,
        policyId: Long,
        withShift: Boolean = true,
        roster: List<Cashier> = listOf(cashier),
        latestVersionCode: Long? = null,
        latestVersionName: String? = null,
        apkUrl: String? = null,
    ) = Bootstrap(
        device = DeviceInfo("d1", "Till 1", "owner"),
        shopName = "Kids Corner",
        vatRate = 0.15,
        vatEnabled = enabled,
        effectiveVatRate = rate,
        vatPolicyId = policyId,
        paymentMethods = listOf("cash"),
        shift = if (withShift) OpenShift(id = 42, openedAt = "2026-08-18T05:00:00Z", openingFloat = 1000.0) else null,
        cashiers = roster,
        latestVersionCode = latestVersionCode,
        latestVersionName = latestVersionName,
        apkUrl = apkUrl,
    )

    private val line = CartLine(
        variantId = 1,
        productName = "Denim jeans",
        variantLabel = "",
        colourHex = null,
        sku = "DJ",
        unitPrice = 642.64,
        qty = 1,
        qtyOnHand = 9,
    )

    private fun stateEnabled() = TillState(
        shop = shop(enabled = true, rate = 0.15, policyId = 6),
        lines = listOf(line),
        totals = cartTotals(listOf(line), 0.0, 0.15),
    )

    @Test
    fun `disabling mid-basket keeps the total but zeroes the contained VAT`() {
        val fresh = shop(enabled = false, rate = 0.0, policyId = 7, withShift = false, roster = emptyList())
        val applied = applyBootstrapPolicy(stateEnabled(), fresh)

        // The policy moved.
        assertEquals(false, applied.shop?.vatEnabled)
        assertEquals(7L, applied.shop?.vatPolicyId)
        // The display recalculated: same total, no VAT.
        assertEquals(642.64, applied.totals.total, 0.0)
        assertEquals(0.0, applied.totals.vat, 0.0)
    }

    @Test
    fun `enabling mid-basket surfaces the contained VAT without moving the total`() {
        val disabled = TillState(
            shop = shop(enabled = false, rate = 0.0, policyId = 7),
            lines = listOf(line),
            totals = cartTotals(listOf(line), 0.0, 0.0),
        )
        val fresh = shop(enabled = true, rate = 0.15, policyId = 8, withShift = false, roster = emptyList())
        val applied = applyBootstrapPolicy(disabled, fresh)

        assertEquals(true, applied.shop?.vatEnabled)
        assertEquals(642.64, applied.totals.total, 0.0)
        assertEquals(83.82, applied.totals.vat, 0.0)
    }

    @Test
    fun `the active shift is preserved, never taken from the fresh answer`() {
        // getOpenShift is shop-scoped, so a two-till shop's fresh bootstrap can
        // name the other drawer. The reducer keeps the shift the till is on.
        val fresh = shop(enabled = false, rate = 0.0, policyId = 7, withShift = false, roster = emptyList())
        val applied = applyBootstrapPolicy(stateEnabled(), fresh)

        assertNotNull(applied.shop?.shift)
        assertEquals(42, applied.shop?.shift?.id)
    }

    @Test
    fun `the basket lines and the cashier roster survive a policy change`() {
        val fresh = shop(enabled = false, rate = 0.0, policyId = 7, withShift = false, roster = emptyList())
        val applied = applyBootstrapPolicy(stateEnabled(), fresh)

        // Lines untouched.
        assertEquals(1, applied.lines.size)
        assertEquals(642.64, applied.lines[0].unitPrice, 0.0)
        // The roster is held over even though the fresh answer's was empty — a
        // separate roster re-pull owns that, not the policy refresh.
        assertEquals(1, applied.shop?.cashiers?.size)
    }

    @Test
    fun `a first policy on a shopless state is simply adopted`() {
        val applied = applyBootstrapPolicy(TillState(), shop(enabled = true, rate = 0.15, policyId = 6))
        assertEquals(6L, applied.shop?.vatPolicyId)
    }

    @Test
    fun `a round reporting an update names it in state`() {
        val fresh = shop(
            enabled = true,
            rate = 0.15,
            policyId = 8,
            latestVersionCode = (BuildConfig.VERSION_CODE + 1).toLong(),
            latestVersionName = "Till v0.2.0",
            apkUrl = "https://example.test/till-v2.apk",
        )
        val applied = applyBootstrapPolicy(TillState(), fresh)
        assertEquals("Till v0.2.0", applied.updateVersionName)
    }

    @Test
    fun `a round reporting nothing new does not forget an update already found`() {
        val knowsAboutUpdate = TillState(updateVersionName = "Till v0.2.0")
        // This round's check found nothing — no latestVersionCode at all —
        // which must not erase what an earlier round already reported.
        val fresh = shop(enabled = true, rate = 0.15, policyId = 9)
        val applied = applyBootstrapPolicy(knowsAboutUpdate, fresh)
        assertEquals("Till v0.2.0", applied.updateVersionName)
    }
}
