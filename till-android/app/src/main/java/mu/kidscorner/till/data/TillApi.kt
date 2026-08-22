package mu.kidscorner.till.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import mu.kidscorner.till.BuildConfig
import okhttp3.Dns
import java.net.Inet6Address
import java.net.InetAddress

/**
 * The till's client for `/api/till`.
 *
 * Everything about money goes through here rather than to Supabase directly.
 * That is not a style preference: `complete_sale_keyed` takes `unit_price` per
 * line and trusts it, and the re-pricing that makes that safe lives in the Next
 * app. A till talking straight to PostgREST could ring anything up at zero.
 *
 * So the contract is: post variant ids and quantities, and let the server say
 * what they cost. Prices held on this device are for display only.
 */

@Serializable
data class DeviceInfo(val id: String, val name: String, val role: String)

@Serializable
data class Cashier(
    val id: String,
    val fullName: String,
    val role: String,
    val hasPin: Boolean,
    /**
     * The hash this tablet checks a PIN against when there is no line — see
     * [PinHasher]. Served only to a signed-in device, and null for somebody
     * the server cannot vouch for offline yet: no PIN, or a PIN not used
     * online since the shop grew this column.
     *
     * Not `profiles.pin_code`. That one never leaves the server.
     */
    val verifier: String? = null,
) {
    /**
     * The same person with nothing secret attached.
     *
     * Screen state is held for the life of the ViewModel and read by every
     * composable; a verifier has no business being in there. This is what the
     * UI carries — the roster keeps the full record.
     */
    fun withoutSecret(): Cashier = if (verifier == null) this else copy(verifier = null)

    /** So a stray log line or crash report cannot print the verifier. */
    override fun toString(): String = "Cashier($fullName, $role, hasPin=$hasPin)"
}

@Serializable
data class OpenShift(
    val id: Int,
    val openedAt: String,
    val openingFloat: Double,
    val openedBy: String? = null,
)

@Serializable
data class Bootstrap(
    val ok: Boolean = true,
    val device: DeviceInfo,
    /** This till's row in the shop's device registry. Null if it did not register. */
    val deviceId: Int? = null,
    val shopName: String,
    /** Receipt header. Null where the shop has not filled the setting in. */
    val shopAddress: String? = null,
    val shopPhone: String? = null,
    val vatNumber: String? = null,
    /**
     * The CONFIGURED rate, kept for display and for the resolver below.
     *
     * Defaulted to 0.15 for one reason only: a bootstrap cached by a build from
     * before this feature has no `vatEnabled`/`effectiveVatRate` keys, and such
     * a cache must decode as VAT-enabled at the shop's historical rate — never
     * as disabled. See [resolvedVatRate].
     */
    val vatRate: Double = 0.15,
    /**
     * Is the shop VAT registered right now. Default true is mandatory: a legacy
     * cache without this key was written while the till only ever charged VAT.
     */
    val vatEnabled: Boolean = true,
    /** What a sale rung up now actually uses: zero while disabled. Null on a legacy cache. */
    val effectiveVatRate: Double? = null,
    /** The immutable policy id the till stamps on each sale. Null on a legacy cache. */
    val vatPolicyId: Long? = null,
    val paymentMethods: List<String>,
    val shift: OpenShift? = null,
    val cashiers: List<Cashier> = emptyList(),
    /**
     * The newest published till release, or null when there is nothing to
     * offer — no matching GitHub release, or the server's own check failed
     * this round. All three travel together; a decoded [updateAvailable]
     * check only needs `latestVersionCode`, but `apkUrl` is what is actually
     * downloaded and `latestVersionName` is what the prompt names.
     */
    val latestVersionCode: Long? = null,
    val latestVersionName: String? = null,
    val apkUrl: String? = null,
) {
    /** Newer than the build actually running, per [BuildConfig.VERSION_CODE]. */
    val updateAvailable: Boolean
        get() = latestVersionCode != null && apkUrl != null &&
            latestVersionCode > BuildConfig.VERSION_CODE

    /**
     * The rate the basket should apply.
     *
     * Prefers the server's explicit effective rate; falls back to the configured
     * rate only when the shop is enabled, and to zero when disabled. A legacy
     * cache (no effective rate, enabled defaulting true) therefore resolves to
     * its cached configured rate — the pre-feature behaviour, exactly.
     */
    val resolvedVatRate: Double
        get() = effectiveVatRate ?: if (vatEnabled) vatRate else 0.0
}

@Serializable
data class PinRequest(
    val profileId: String,
    val pin: String,
    /** From bootstrap, so the sign-in lands on this till in the audit trail.
     *  Null before the first successful bootstrap — the server accepts that. */
    val deviceId: Int? = null,
)

@Serializable
data class PinResult(
    val ok: Boolean,
    val cashier: Cashier? = null,
    val error: String? = null,
    val lockedFor: Int = 0,
    /**
     * The four digits were wrong — as opposed to the account being locked out,
     * deactivated, or having no PIN. Only this drops a held verifier, because
     * `lockedFor` is above zero either way once a miss trips the lockout.
     */
    val wrongPin: Boolean = false,
    /**
     * This answer came from the tablet, not the shop. Never sent by the
     * server; set by [TillRepository] when it falls back to [OfflineGate], so
     * the screen can say the till is running on its own for now.
     */
    val offline: Boolean = false,
)

@Serializable
data class StockCheckQuantity(
    val variantId: Int,
    val qty: Int,
)

@Serializable
data class StockCheckLocation(
    val id: Int,
    val name: String,
    val quantities: List<StockCheckQuantity> = emptyList(),
)

@Serializable
data class StockCheckResponse(
    val ok: Boolean = true,
    val productId: Int = 0,
    val locations: List<StockCheckLocation> = emptyList(),
)

@Serializable
private data class ApiError(
    val ok: Boolean = false,
    val error: String? = null,
    /** Set by the server when the account itself is finished — see below. */
    val sessionEnded: Boolean = false,
)

// ------------------------------------------------------------------- sale

@Serializable
data class SaleItem(
    /** Null on a custom line — gift wrap, an alteration, unlabelled stock. */
    val variantId: Int? = null,
    val qty: Int,
    /** Money off this line. Clamped server-side to the line's own value. */
    val discount: Double = 0.0,
    /** Set only on a custom line; it is what the receipt calls the line. */
    val description: String? = null,
    /**
     * Read by the server ONLY for a custom line, where there is no catalogue
     * row to price from. A catalogue line's price is always reloaded there.
     */
    val unitPrice: Double? = null,
)

@Serializable
data class SalePayment(
    val method: String,
    val amount: Double,
    val tendered: Double? = null,
)

/**
 * A named discount on the whole sale.
 *
 * Every field is re-derived server-side from the `discounts` row — label, kind
 * and value included, because those are what the receipt and the discount
 * report are built from. Sent anyway so the shape matches the web till's
 * payload exactly; the till's discount UI is not built yet, so this is
 * currently always empty.
 */
@Serializable
data class AppliedDiscount(
    val discountId: Int? = null,
    val label: String,
    val kind: String,
    val value: Double,
    val amount: Double,
    val approvedBy: String? = null,
)

/**
 * What the till posts to complete a sale.
 *
 * Note what is absent: no unit prices, and no sale total. Both are re-derived
 * on the server from `product_variants`, so there is nothing here for a
 * tampered build to lie about.
 */
@Serializable
data class SaleRequest(
    val shiftId: Int,
    val customerId: Int? = null,
    val cashierId: String? = null,
    val items: List<SaleItem>,
    val payments: List<SalePayment>,
    val discounts: List<AppliedDiscount> = emptyList(),
    /**
     * A manager's PIN, when the basket carries a discount that needs one.
     *
     * Sent with the sale rather than exchanged for a token earlier, because any
     * approval the *device* mints can be forged by whoever holds the device —
     * which on a shared till is every cashier. Knowing the PIN is the only
     * thing that cannot be, so it is checked at the moment money is committed.
     */
    val approval: Approval? = null,
    /** Names this attempt so a retry replays instead of charging again. */
    val idempotencyKey: String,
    /**
     * The immutable VAT policy this attempt was checked out under.
     *
     * Frozen once, at checkout, and sent byte-identical on every retry and every
     * queued replay — the server resolves exactly this policy rather than
     * applying whatever is current when the sale finally lands. Null is the
     * legacy spelling: a payload from before this feature, which the server maps
     * to the immutable legacy policy.
     */
    val vatPolicyId: Long? = null,
    /** The local checkout instant, ISO-8601. Generated once and never regenerated on retry. */
    val checkedOutAt: String? = null,
)

@Serializable
data class Approval(val managerId: String, val pin: String)

@Serializable
data class SaleResult(
    val ok: Boolean,
    val saleId: Int? = null,
    val error: String? = null,
    /** The basket carries a discount only an owner or manager may authorise. */
    val needsApproval: Boolean = false,
    /**
     * The sale may have committed without the till hearing so. Retrying is safe
     * — the idempotency key replays it — but only if the basket has not changed.
     */
    val uncertain: Boolean = false,
)

/** A 401 specifically — the caller refreshes and retries rather than giving up. */
class UnauthorizedException(message: String) : Exception(message)

/**
 * The account is gone, not the token.
 *
 * An owner deactivating a member of staff in the back office is a 403, and so
 * is "that shift is not reachable" from shift/close — the same status for a
 * thing that ends the session and a thing that does not. The server marks the
 * first kind, so this is thrown only for that.
 *
 * Separate from UnauthorizedException on purpose: refreshing would succeed
 * (Supabase does not know the profile was switched off) and the retry would
 * come back 403 again. There is nothing to retry.
 */
class SessionEndedException(message: String) : Exception(message)

class TillApi(private val http: HttpClient) {

    private val origin = BuildConfig.API_ORIGIN

    /**
     * Announces this till and fetches everything it needs to draw.
     *
     * The device details ride along as query parameters. Fire-and-forget by
     * design: a till that cannot register still gets its catalogue and can
     * still sell — the registry is for the back office to look at, and losing
     * a heartbeat must never stop a shop trading.
     */
    suspend fun bootstrap(
        token: String,
        deviceCode: String? = null,
        model: String? = null,
        appVersion: String? = null,
    ): Bootstrap =
        http.get("$origin/api/till/bootstrap") {
            bearer(token)
            deviceCode?.let { parameter("device", it) }
            model?.let { parameter("model", it) }
            appVersion?.let { parameter("version", it) }
        }.decode()

    suspend fun verifyPin(
        token: String,
        profileId: String,
        pin: String,
        deviceId: Int? = null,
    ): PinResult =
        http.post("$origin/api/till/pin") {
            bearer(token)
            contentType(ContentType.Application.Json)
            setBody(PinRequest(profileId, pin, deviceId))
        }.decode()

    suspend fun catalog(token: String): CatalogResponse =
        http.get("$origin/api/till/catalog") { bearer(token) }.decode()

    suspend fun stockCheck(token: String, productId: Int): StockCheckResponse =
        http.get("$origin/api/till/stock-check") {
            bearer(token)
            parameter("productId", productId)
        }.decode()

    suspend fun completeSale(token: String, sale: SaleRequest): SaleResult =
        http.post("$origin/api/till/sale") {
            bearer(token)
            contentType(ContentType.Application.Json)
            setBody(sale)
        }.decode()

    suspend fun shift(token: String): ShiftState =
        http.get("$origin/api/till/shift") { bearer(token) }.decode()

    suspend fun openShift(
        token: String,
        openingFloat: Double,
        deviceId: Int? = null,
    ): OpenShiftResponse =
        http.post("$origin/api/till/shift") {
            bearer(token)
            contentType(ContentType.Application.Json)
            setBody(OpenShiftRequest(openingFloat, deviceId))
        }.decode()

    /** Live figures for a trading drawer — an X-read, not a fiscal record. */
    suspend fun xRead(token: String): ZResponse =
        http.get("$origin/api/till/z") { bearer(token) }.decode()

    /** A stored Z, read from the frozen snapshot rather than recomputed. */
    suspend fun zReport(token: String, zId: Int): ZResponse =
        http.get("$origin/api/till/z") {
            bearer(token)
            parameter("z", zId)
        }.decode()

    suspend fun recordMovement(token: String, body: MovementRequest): MovementResponse =
        http.post("$origin/api/till/shift/movement") {
            bearer(token)
            contentType(ContentType.Application.Json)
            setBody(body)
        }.decode()

    suspend fun closeShift(token: String, body: CloseShiftRequest): CloseShiftResponse =
        http.post("$origin/api/till/shift/close") {
            bearer(token)
            contentType(ContentType.Application.Json)
            setBody(body)
        }.decode()

    suspend fun searchCustomers(token: String, query: String): CustomersResponse =
        http.get("$origin/api/till/customers") {
            bearer(token)
            parameter("q", query)
        }.decode()

    suspend fun createCustomer(token: String, request: CreateCustomerRequest): CreateCustomerResponse =
        http.post("$origin/api/till/customers") {
            bearer(token)
            contentType(ContentType.Application.Json)
            setBody(request)
        }.decode()

    /**
     * Money handed over against an account.
     *
     * Never queued offline, unlike a sale. A sale has already happened when the
     * goods leave the counter, so replaying it later is recording history; a
     * payment on account is refused or accepted against a balance that only the
     * server knows, and a queued one could be accepted twice or accepted after
     * the debt was already settled elsewhere.
     */
    suspend fun settleCredit(token: String, body: SettleCreditRequest): SettleCreditResponse =
        http.post("$origin/api/till/credit") {
            bearer(token)
            contentType(ContentType.Application.Json)
            setBody(body)
        }.decode()

    /** The sales behind a customer's tab, so the till can show what is owed. */
    suspend fun creditStatement(token: String, customerId: Int): CreditStatementResponse =
        http.get("$origin/api/till/credit") {
            bearer(token)
            parameter("customerId", customerId)
        }.decode()

    suspend fun discounts(token: String): DiscountsResponse =
        http.get("$origin/api/till/discounts") { bearer(token) }.decode()

    suspend fun sales(token: String, query: String): SalesListResponse =
        http.get("$origin/api/till/sales") {
            bearer(token)
            if (query.isNotBlank()) parameter("q", query)
        }.decode()

    suspend fun saleDetail(token: String, saleId: Int): SaleDetailResponse =
        http.get("$origin/api/till/sales/$saleId") { bearer(token) }.decode()

    suspend fun recordPrint(token: String, saleId: Int): PrintResponse =
        http.post("$origin/api/till/sales/$saleId/print") { bearer(token) }.decode()

    suspend fun refund(token: String, request: RefundRequest): RefundResponse =
        http.post("$origin/api/till/refund") {
            bearer(token)
            contentType(ContentType.Application.Json)
            setBody(request)
        }.decode()

    /**
     * `expectSuccess` is off, so Ktor hands back every status rather than
     * throwing. That is what a wrong PIN needs — it arrives as 200 with
     * `ok:false` and has to reach the keypad intact, not as an exception.
     *
     * Which leaves the two statuses that genuinely are not answers: 401, meaning
     * refresh the token and try once more, and everything else. The body is read
     * as text only on those paths, so it is never consumed twice.
     */
    private suspend inline fun <reified T> HttpResponse.decode(): T {
        if (status.isSuccess()) return body()
        // Read once, then decide. bodyAsText() on an already-consumed body is
        // how the "never consumed twice" note above stops being true.
        val text = bodyAsText()
        val message = readError(status, text)
        if (sessionIsOver(text)) throw SessionEndedException(message)
        if (status == HttpStatusCode.Unauthorized) throw UnauthorizedException(message)
        throw IllegalStateException(message)
    }

    private fun HttpRequestBuilder.bearer(token: String) {
        header("Authorization", "Bearer $token")
    }

    companion object {
        /**
         * One client for the app's life. Ktor holds a connection pool, and
         * building one per call would open a new TCP+TLS handshake for every
         * scan — the opposite of what a till on a shop's connection needs.
         */
        fun httpClient(): HttpClient = HttpClient(OkHttp) {
            expectSuccess = false
            engine {
                // Some networks — the Android emulator, and shop routers that
                // advertise IPv6 without a working uplink — return AAAA records
                // that black-hole. OkHttp tries the returned addresses in order,
                // so an IPv6-first list burns the whole 5s connect budget (twice,
                // once per AAAA) before it ever reaches the reachable IPv4 route,
                // and the till shows Offline against a server that is actually up.
                // Handing OkHttp IPv4 first makes it connect on the first try;
                // genuine IPv6-only networks still work, as IPv6 stays in the list.
                config { dns(Ipv4FirstDns) }
            }
            install(ContentNegotiation) {
                json(
                    Json {
                        ignoreUnknownKeys = true
                        // Both ON, and both matter.
                        //
                        // kotlinx omits a property equal to its DEFAULT unless
                        // encodeDefaults is set — so `discount = 0.0` on a line
                        // with no discount vanished from the payload, and the
                        // server refused the sale with "expected number,
                        // received undefined". Sixteen retries, all identical.
                        //
                        // explicitNulls does the same for nulls. A walk-in sale
                        // lost its `customerId` key the same way.
                        //
                        // The queue's own serialiser already sets
                        // encodeDefaults; leaving it off here meant a live send
                        // and its queued replay disagreed about what a complete
                        // payload was, which is exactly the kind of difference
                        // that only shows up once money is involved.
                        encodeDefaults = true
                        explicitNulls = true
                    },
                )
            }
            install(HttpTimeout) {
                // Short on purpose. A cashier with a customer waiting needs to
                // be told the network is down in seconds, not after a minute of
                // a spinner, so the sale can go to the offline queue instead.
                connectTimeoutMillis = 5_000
                requestTimeoutMillis = 15_000
                socketTimeoutMillis = 15_000
            }
        }

        /**
         * Resolves like the system, but orders IPv4 ahead of IPv6 so OkHttp
         * tries a reachable route first on networks whose IPv6 black-holes.
         * A stable sort keeps the server's own ordering within each family.
         */
        private object Ipv4FirstDns : Dns {
            override fun lookup(hostname: String): List<InetAddress> =
                Dns.SYSTEM.lookup(hostname).sortedBy { it is Inet6Address }
        }

        /** Built once — a Json instance is expensive enough not to make per call. */
        private val errorJson = Json { ignoreUnknownKeys = true }

        fun readError(status: HttpStatusCode, body: String): String {
            val parsed = runCatching { errorJson.decodeFromString<ApiError>(body) }.getOrNull()
            return parsed?.error ?: "The till server answered ${status.value}."
        }

        /** Whether the body carries the server's `sessionEnded` marker. */
        fun sessionIsOver(body: String): Boolean =
            runCatching { errorJson.decodeFromString<ApiError>(body) }
                .getOrNull()?.sessionEnded == true
    }
}
