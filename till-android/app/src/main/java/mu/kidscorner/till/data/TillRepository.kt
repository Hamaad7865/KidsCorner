package mu.kidscorner.till.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The one place that knows how to get a usable access token.
 *
 * Refresh is serialised behind a mutex. Without it, the bootstrap call and a
 * PIN check firing together on a stale token would both refresh, and GoTrue
 * rotates refresh tokens — the second exchange would present one the server has
 * already retired and sign the till out mid-shift.
 */
class TillRepository(
    private val api: TillApi,
    private val auth: AuthClient,
    private val store: SessionStore,
    private val gate: OfflineGate,
    private val catalog: CatalogDao,
    private val queue: SaleQueueDao,
) {

    private val refreshLock = Mutex()

    /**
     * Whether the till can currently reach its server.
     *
     * Derived from whether calls actually succeed, not from ConnectivityManager.
     * A tablet joined to a shop's router with a dead uplink reports a perfectly
     * good network and cannot sell — and "Online" on the screen while sales
     * silently queue is worse than no indicator at all.
     *
     * Only transport failures flip this. A 401 or a refused sale means the
     * server answered, which is the definition of reachable.
     */
    private val _online = MutableStateFlow(true)
    val online: StateFlow<Boolean> = _online.asStateFlow()

    val isSignedIn: Boolean get() = store.isSignedIn

    suspend fun signIn(email: String, password: String): Result<Unit> =
        auth.signIn(email, password).map { store.save(it) }

    /**
     * Forget this device entirely.
     *
     * Takes the offline gate with it: a tablet that is no longer this shop's
     * till must not go on admitting its staff. Whether it is ALLOWED to happen
     * is decided above — a queue still holding sales has nothing to replay
     * under once the session is gone.
     */
    suspend fun signOut() {
        store.clear()
        gate.clear()
    }

    /** The last bootstrap the server served, for a start with no line. */
    suspend fun cachedShop(): Bootstrap? = gate.cachedShop()

    suspend fun bootstrap(): Result<Bootstrap> = authed {
        api.bootstrap(
            it,
            deviceCode = store.deviceCode,
            model = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim(),
            appVersion = mu.kidscorner.till.BuildConfig.VERSION_NAME,
        )
    }.onSuccess {
        // The only thing that fetches the roster, so it is also the only thing
        // that can keep one. Remembered whole, verifiers included.
        gate.remember(it)
    }

    /**
     * Check a PIN, falling back to the tablet when the shop cannot be reached.
     *
     * The order is the point. The server is asked FIRST and its answer is
     * final either way — a wrong PIN, a locked-out cashier, an account switched
     * off in the back office are all decisions only it can make, and a stale
     * verifier must never be allowed to overrule one. The local check happens
     * only when nothing answered at all.
     */
    suspend fun verifyPin(profileId: String, pin: String, deviceId: Int? = null): Result<PinResult> {
        val attempt = authed { api.verifyPin(it, profileId, pin, deviceId) }
        val answer = attempt.getOrNull()

        if (answer != null) {
            if (answer.ok) {
                // The server has spoken, so the offline miss count is spent.
                gate.noteOnlineSuccess(profileId)
            } else if (answer.wrongPin) {
                // Refused digits that this tablet still accepts means the PIN
                // was changed in the back office while it was not looking.
                //
                // `wrongPin`, not `!ok`: a locked-out or deactivated cashier is
                // also refused, and their PIN may be perfectly correct —
                // dropping the verifier then would cost them offline sign-in
                // for nothing.
                //
                // This costs one PBKDF2 at the shipped iteration count, so a
                // mistyped PIN takes about half a second longer to say so. Paid
                // deliberately: it only lands on the wrong-PIN path, only when
                // a verifier is actually held, and the alternative is a stale
                // PIN that goes on opening this till.
                gate.noteServerRefusal(profileId, pin)
            }
            return attempt
        }

        // Nothing answered. Either the line is down or the token could not be
        // renewed — and an UnauthorizedException reaching here has already
        // survived one refresh, so there is no session to sell under anyway.
        if (attempt.exceptionOrNull() is UnauthorizedException) return attempt

        return Result.success(
            when (val local = gate.unlock(profileId, pin)) {
                is OfflineGate.Unlock.Ok ->
                    PinResult(ok = true, cashier = local.cashier, offline = true)

                OfflineGate.Unlock.WrongPin ->
                    PinResult(ok = false, error = "Wrong PIN.", wrongPin = true, offline = true)

                is OfflineGate.Unlock.Locked -> PinResult(
                    ok = false,
                    error = PinThrottle.waitMessage(local.remainingMs),
                    // Rounded UP, so a keypad counting this down never re-opens
                    // a moment before the gate actually will.
                    lockedFor = ((local.remainingMs + 999) / 1000).toInt(),
                    offline = true,
                )

                // Short on purpose: it lands in the keypad's one-line caption,
                // and the lock screen has already greyed this name out with
                // the full reason underneath the tiles. Reaching this at all
                // means the offline flag had not flipped yet when the tile was
                // tapped.
                OfflineGate.Unlock.Unknown -> PinResult(
                    ok = false,
                    error = "No connection — this till can't check that PIN yet.",
                    offline = true,
                )
            },
        )
    }

    suspend fun completeSale(sale: SaleRequest): Result<SaleResult> =
        authed { api.completeSale(it, sale) }

    suspend fun shift(): Result<ShiftState> = authed { api.shift(it) }

    suspend fun openShift(
        openingFloat: Double,
        deviceId: Int? = null,
    ): Result<OpenShiftResponse> = authed { api.openShift(it, openingFloat, deviceId) }

    suspend fun closeShift(body: CloseShiftRequest): Result<CloseShiftResponse> =
        authed { api.closeShift(it, body) }

    suspend fun recordMovement(body: MovementRequest): Result<MovementResponse> =
        authed { api.recordMovement(it, body) }

    suspend fun xRead(): Result<ZResponse> = authed { api.xRead(it) }

    suspend fun zReport(zId: Int): Result<ZResponse> = authed { api.zReport(it, zId) }

    suspend fun searchCustomers(query: String): Result<CustomersResponse> =
        authed { api.searchCustomers(it, query) }

    suspend fun createCustomer(name: String, phone: String?): Result<CreateCustomerResponse> =
        authed { api.createCustomer(it, name, phone) }

    suspend fun discounts(): Result<DiscountsResponse> = authed { api.discounts(it) }

    suspend fun sales(query: String): Result<SalesListResponse> = authed { api.sales(it, query) }

    suspend fun saleDetail(saleId: Int): Result<SaleDetailResponse> =
        authed { api.saleDetail(it, saleId) }

    suspend fun recordPrint(saleId: Int): Result<PrintResponse> = authed { api.recordPrint(it, saleId) }

    /**
     * A return. Never queued offline, unlike a sale.
     *
     * A sale can be parked because the till already knows everything about it —
     * the prices came off the catalogue it holds. A return cannot: what the
     * customer gets back depends on what has *already* been returned against
     * that sale, which only the server knows. Parking one would mean promising
     * money on a stale reading.
     */
    suspend fun refund(request: RefundRequest): Result<RefundResponse> = authed { api.refund(it, request) }

    // --------------------------------------------------------------- queue

    /**
     * Parks a sale the till could not confirm.
     *
     * Returns false if the write itself failed, so the caller can hold the
     * cashier on screen rather than tell them a sale is saved when it is not.
     */
    suspend fun enqueueSale(sale: SaleRequest, total: Double, itemCount: Int): Boolean =
        runCatching {
            queue.enqueue(
                QueuedSale(
                    key = sale.idempotencyKey,
                    payload = queueJson.encodeToString(sale),
                    queuedAt = System.currentTimeMillis(),
                    attempts = 0,
                    total = total,
                    itemCount = itemCount,
                ),
            )
        }.isSuccess

    suspend fun queuedCount(): Int = runCatching { queue.count() }.getOrDefault(0)

    suspend fun queuedSales(): List<QueuedSale> = runCatching { queue.all() }.getOrDefault(emptyList())

    /** Queued sales carrying an error, newest first. */
    suspend fun failingSales(): List<QueuedSale> =
        runCatching { queue.failing() }.getOrDefault(emptyList())

    /**
     * Sends queued sales, oldest first, one at a time.
     *
     * Serial on purpose. Each sale deducts stock, and firing the backlog
     * concurrently would have several of them racing the `qty_on_hand >= 0`
     * constraint — turning a queue that would have drained cleanly into a
     * scattering of oversell failures.
     *
     * Stops at the first sale that is not due or does not go through, rather
     * than skipping past it: order matters, and a sale that keeps failing
     * should not let later ones jump the line.
     *
     * Returns how many were confirmed.
     */
    suspend fun drainQueue(): Int {
        var sent = 0
        val now = System.currentTimeMillis()

        for (queued in queuedSales()) {
            if (!queued.isDue(now)) continue

            val request = runCatching {
                queueJson.decodeFromString<SaleRequest>(queued.payload)
            }.getOrNull()

            if (request == null) {
                // Undecodable, so it can never be sent. Recorded and left in
                // place rather than deleted: a row that cannot be parsed is
                // still evidence a sale happened, and dropping it silently
                // would hide that.
                queue.recordAttempt(queued.key, now, "This queued sale could not be read.")
                continue
            }

            val result = completeSale(request)
            val value = result.getOrNull()

            when {
                // ok covers a replay too: the RPC hands back the original sale
                // for a key it has already seen, which is exactly what makes
                // draining a queue of maybe-committed sales safe.
                value != null && value.ok -> {
                    queue.remove(queued.key)
                    sent += 1
                }

                // The server answered and refused. Not retryable on its own —
                // an oversell or a deleted discount rule will refuse again — so
                // it backs off rather than spinning.
                value != null -> queue.recordAttempt(queued.key, now, value.error)

                // No answer. Almost always the line still being down, so stop
                // here: the rest of the queue will fail the same way.
                else -> {
                    queue.recordAttempt(
                        queued.key,
                        now,
                        result.exceptionOrNull()?.message ?: "Could not reach the till server.",
                    )
                    break
                }
            }
        }

        return sent
    }

    /** Whatever is already cached, so the till can sell before any fetch lands. */
    suspend fun cachedCatalog(): List<CatalogVariant> = catalog.all()

    /**
     * Refreshes the cache and returns it.
     *
     * On failure the cached rows are returned instead of an error. A shop whose
     * line has dropped should keep selling from this morning's prices — the
     * server re-prices every sale anyway, so the worst case is a cashier quoting
     * a figure that the receipt then corrects, which beats a till that refuses
     * to open.
     */
    suspend fun refreshCatalog(): Result<List<CatalogVariant>> {
        val fetched = authed { api.catalog(it) }
        return fetched.mapCatching { response ->
            catalog.replaceAll(response.variants)
            response.variants
        }.recoverCatching { cause ->
            val cached = catalog.all()
            if (cached.isEmpty()) throw cause else cached
        }
    }

    /**
     * Runs a call with a fresh-enough token, refreshing once if the server still
     * says 401.
     *
     * The clock check comes first so the common case costs no extra round trip,
     * and the 401 retry covers the rest: a token revoked early, a device whose
     * clock is wrong, a password changed in the back office.
     */
    private suspend fun <T> authed(call: suspend (String) -> T): Result<T> = runCatching {
        val token = validToken() ?: error("This till is not signed in.")
        try {
            call(token)
        } catch (expired: UnauthorizedException) {
            val renewed = forceRefresh()
                ?: throw UnauthorizedException(expired.message ?: "Sign in again.")
            call(renewed)
        }
    }.also { result ->
        // A 401 still means the server answered, so it does not count as being
        // offline — the till is reachable and the token is simply stale.
        val reachable = result.isSuccess || result.exceptionOrNull() is UnauthorizedException
        _online.value = reachable
    }

    private suspend fun validToken(): String? {
        val access = store.accessToken
        val stillFresh = store.expiresAt - SKEW_SECONDS > System.currentTimeMillis() / 1000
        if (!access.isNullOrBlank() && stillFresh) return access
        return forceRefresh() ?: access
    }

    private suspend fun forceRefresh(): String? = refreshLock.withLock {
        // Re-checked inside the lock: a caller that queued behind another
        // refresh should use its result, not start a second one.
        val fresh = store.expiresAt - SKEW_SECONDS > System.currentTimeMillis() / 1000
        if (fresh) return@withLock store.accessToken

        val refresh = store.refreshToken ?: return@withLock null
        auth.refresh(refresh)
            .onSuccess { store.save(it) }
            .map { it.accessToken }
            .getOrNull()
    }

    private companion object {
        /** Refresh a minute early, so a slow call cannot expire mid-flight. */
        const val SKEW_SECONDS = 60
    }
}
