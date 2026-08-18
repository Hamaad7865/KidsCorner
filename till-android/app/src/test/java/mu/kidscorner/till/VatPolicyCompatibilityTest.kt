package mu.kidscorner.till

import kotlinx.serialization.json.Json
import mu.kidscorner.till.data.Bootstrap
import mu.kidscorner.till.data.SaleDetail
import mu.kidscorner.till.data.SaleItem
import mu.kidscorner.till.data.SalePayment
import mu.kidscorner.till.data.SaleRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The VAT policy fields, decoded across the version boundary.
 *
 * The tablet keeps an encrypted cache of the last bootstrap and a queue of
 * frozen sale payloads. Both survive an app update, so JSON written by the
 * build before this feature must still decode — and it must decode as
 * VAT-ENABLED at the cached rate, because that is the only behaviour those
 * builds ever had. A cache that silently defaulted to disabled would stop a
 * VAT-registered shop charging VAT on the first sale after an update.
 */
class VatPolicyCompatibilityTest {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    // ----------------------------------------------------------- bootstrap

    @Test
    fun `a legacy bootstrap without VAT keys decodes enabled at its cached rate`() {
        // No vatEnabled, no effectiveVatRate, no vatPolicyId — exactly what an
        // older build wrote to the offline-gate cache.
        val legacy = """
            {"device":{"id":"d1","name":"Till 1","role":"owner"},
             "shopName":"Kids Corner","vatRate":0.15,
             "paymentMethods":["cash"]}
        """.trimIndent()

        val shop = json.decodeFromString<Bootstrap>(legacy)

        assertTrue(shop.vatEnabled)
        assertEquals(0.15, shop.resolvedVatRate, 0.0)
        assertNull(shop.effectiveVatRate)
        assertNull(shop.vatPolicyId)
    }

    @Test
    fun `a disabled bootstrap resolves a zero effective rate but keeps the configured rate`() {
        val disabled = """
            {"device":{"id":"d1","name":"Till 1","role":"owner"},
             "shopName":"Kids Corner","vatRate":0.15,"vatEnabled":false,
             "effectiveVatRate":0.0,"vatPolicyId":5,"paymentMethods":["cash"]}
        """.trimIndent()

        val shop = json.decodeFromString<Bootstrap>(disabled)

        assertEquals(false, shop.vatEnabled)
        assertEquals(0.0, shop.resolvedVatRate, 0.0)
        assertEquals(0.15, shop.vatRate, 0.0)
        assertEquals(5L, shop.vatPolicyId)
    }

    @Test
    fun `an enabled bootstrap uses the server effective rate and policy id`() {
        val enabled = """
            {"device":{"id":"d1","name":"Till 1","role":"owner"},
             "shopName":"Kids Corner","vatRate":0.15,"vatEnabled":true,
             "effectiveVatRate":0.15,"vatPolicyId":6,"vatNumber":"VAT20123456",
             "paymentMethods":["cash"]}
        """.trimIndent()

        val shop = json.decodeFromString<Bootstrap>(enabled)

        assertTrue(shop.vatEnabled)
        assertEquals(0.15, shop.resolvedVatRate, 0.0)
        assertEquals(6L, shop.vatPolicyId)
        assertEquals("VAT20123456", shop.vatNumber)
    }

    // --------------------------------------------------------- sale request

    @Test
    fun `an old queued sale payload decodes with null policy and timestamp`() {
        val legacyPayload = """
            {"shiftId":1,"items":[{"variantId":1,"qty":1}],
             "payments":[{"method":"cash","amount":100.0}],
             "idempotencyKey":"abcdef12"}
        """.trimIndent()

        val sale = json.decodeFromString<SaleRequest>(legacyPayload)

        assertNull(sale.vatPolicyId)
        assertNull(sale.checkedOutAt)
    }

    @Test
    fun `a new sale payload round-trips its frozen policy id and checkout time`() {
        val sale = SaleRequest(
            shiftId = 1,
            items = listOf(SaleItem(variantId = 1, qty = 1)),
            payments = listOf(SalePayment(method = "cash", amount = 100.0)),
            idempotencyKey = "abcdef12",
            vatPolicyId = 42L,
            checkedOutAt = "2026-08-18T08:30:00.000Z",
        )

        val encoded = json.encodeToString(SaleRequest.serializer(), sale)
        val decoded = json.decodeFromString<SaleRequest>(encoded)

        assertEquals(42L, decoded.vatPolicyId)
        assertEquals("2026-08-18T08:30:00.000Z", decoded.checkedOutAt)
        // encodeDefaults is on, so the frozen fields are actually present on the
        // wire — a queued replay must be byte-identical, keys included.
        assertTrue(encoded.contains("\"vatPolicyId\":42"))
        assertTrue(encoded.contains("\"checkedOutAt\":\"2026-08-18T08:30:00.000Z\""))
    }

    // ---------------------------------------------------------- sale detail

    @Test
    fun `an old sale detail without VAT policy fields defaults to enabled legacy rendering`() {
        val legacy = """
            {"id":7,"saleNo":"S0007","saleDate":"2026-07-01T09:00:00Z",
             "subtotal":230.0,"vatAmount":30.0,"total":230.0}
        """.trimIndent()

        val detail = json.decodeFromString<SaleDetail>(legacy)

        assertTrue(detail.vatEnabled)
        assertEquals(0.15, detail.vatRate, 0.0)
        assertNull(detail.vatNumber)
    }

    @Test
    fun `frozen sale detail fields round-trip independently of bootstrap`() {
        val disabledSale = """
            {"id":8,"saleNo":"S0008","saleDate":"2026-08-18T09:00:00Z",
             "subtotal":120.0,"vatAmount":0.0,"total":120.0,
             "vatPolicyId":2,"vatEnabled":false,"vatRate":0.0,"vatNumber":null}
        """.trimIndent()

        val detail = json.decodeFromString<SaleDetail>(disabledSale)

        assertEquals(false, detail.vatEnabled)
        assertEquals(0.0, detail.vatRate, 0.0)
        assertNull(detail.vatNumber)
        assertEquals(2L, detail.vatPolicyId)
    }
}
