package mu.kidscorner.till

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import mu.kidscorner.till.data.AppliedDiscountLocal
import mu.kidscorner.till.data.Approval
import mu.kidscorner.till.data.AuthClient
import mu.kidscorner.till.data.Bootstrap
import mu.kidscorner.till.data.CartLine
import mu.kidscorner.till.data.CartTotals
import mu.kidscorner.till.data.Cashier
import mu.kidscorner.till.data.CatalogVariant
import mu.kidscorner.till.data.CloseShiftRequest
import mu.kidscorner.till.data.CloseShiftResponse
import mu.kidscorner.till.data.Customer
import mu.kidscorner.till.data.DiscountRule
import mu.kidscorner.till.data.HeldSale
import mu.kidscorner.till.data.MovementRequest
import mu.kidscorner.till.data.RefundItem
import mu.kidscorner.till.data.RefundRequest
import mu.kidscorner.till.data.RefundResponse
import mu.kidscorner.till.data.SaleDetail
import mu.kidscorner.till.data.SaleItem
import mu.kidscorner.till.data.SalePayment
import mu.kidscorner.till.data.SaleRequest
import mu.kidscorner.till.data.SaleSummary
import mu.kidscorner.till.data.SessionStore
import mu.kidscorner.till.data.ShiftTotals
import mu.kidscorner.till.data.TillApi
import mu.kidscorner.till.data.ZTotals
import mu.kidscorner.till.data.TillDatabase
import mu.kidscorner.till.data.TillRepository
import mu.kidscorner.till.data.UnauthorizedException
import mu.kidscorner.till.data.cartTotals
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.isNetworkish
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.print.Align
import mu.kidscorner.till.print.EscPos
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.PrintResult
import mu.kidscorner.till.print.PrinterSettings
import mu.kidscorner.till.print.ReceiptLine
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.buildReceipt
import mu.kidscorner.till.print.buildZReport
import mu.kidscorner.till.print.toPlainText
import mu.kidscorner.till.data.withQty
import mu.kidscorner.till.data.withLineDiscount
import mu.kidscorner.till.data.withCustomItem
import mu.kidscorner.till.data.withPriceOverride
import mu.kidscorner.till.data.withVariant
import mu.kidscorner.till.data.without
import java.util.UUID

/** Which screen the till is on. */
sealed interface TillScreen {
    /** Deciding whether this device has been set up. Shown for a blink. */
    data object Starting : TillScreen

    /** One-time device sign-in. The owner does this on setup, not a cashier. */
    data object DeviceSetup : TillScreen

    /** The PIN keypad. Where the till sits between cashiers, all day. */
    data object Locked : TillScreen

    /** Counting the opening float into an empty drawer. */
    data class OpeningShift(val cashier: Cashier) : TillScreen

    /** Selling. */
    data class Selling(val cashier: Cashier) : TillScreen

    /** Taking payment for the basket. */
    data class Paying(val cashier: Cashier) : TillScreen

    /** The till's own settings: printer, drawer, receipts. */
    data class Settings(val cashier: Cashier) : TillScreen

    /** Giving goods back against a past sale. */
    data class Refunding(val cashier: Cashier) : TillScreen

    /** End of day: count the drawer against what the ledger expects. */
    data class ClosingShift(val cashier: Cashier) : TillScreen
}

/** How a completed sale finished, for the confirmation screen. */
data class SaleOutcome(
    val saleId: Int?,
    val change: Double,
    val itemCount: Int,
    val total: Double,
    /** "Cash, Card" — the handoff prints these under the heading. */
    val methods: String = "",
    /** Parked rather than confirmed. The customer still gets their change. */
    val queued: Boolean = false,
)

data class TillState(
    val screen: TillScreen = TillScreen.Starting,
    val shop: Bootstrap? = null,
    /** This till's row in the shop's device registry, from bootstrap. */
    val deviceId: Int? = null,
    val busy: Boolean = false,
    val error: String? = null,
    /** Seconds left on a PIN lockout, counted down for the keypad. */
    val lockedFor: Int = 0,

    val catalog: List<CatalogVariant> = emptyList(),
    val catalogLoading: Boolean = false,

    val lines: List<CartLine> = emptyList(),
    val totals: CartTotals = CartTotals(),
    val customer: Customer? = null,
    val discount: AppliedDiscountLocal? = null,

    val customerResults: List<Customer> = emptyList(),
    val customerSearching: Boolean = false,
    val customerError: String? = null,

    /** Rules the cashier may offer. Refreshed with the catalog. */
    val discountRules: List<DiscountRule> = emptyList(),

    /** Parked baskets, this device only. */
    val held: List<HeldSale> = emptyList(),

    /** Live figures for the close screen, fetched when it opens. */
    val shiftTotals: ShiftTotals? = null,
    /** Filled in once a shift is closed, for the end-of-day summary. */
    val closeSummary: CloseShiftResponse? = null,
    val movementError: String? = null,
    val movementDone: Boolean = false,

    val history: List<SaleSummary> = emptyList(),
    val historyLoading: Boolean = false,
    val selectedSale: SaleDetail? = null,
    val saleDetailLoading: Boolean = false,
    val printing: Boolean = false,
    val historyError: String? = null,

    /**
     * The design's toast: one line, bottom-left, gone in 2.2 seconds.
     *
     * The till's only channel for an action that changes nothing on screen —
     * a discount removed, a drawer popped, a receipt reprinted. Without it
     * those actions are silent, which at a counter reads as "it didn't work"
     * and gets pressed twice.
     */
    val toast: String? = null,

    /** A completed return, held until the cashier dismisses it. */
    val refundDone: RefundResponse? = null,

    /** What would come out of the printer, as monospaced text. */
    val receiptPreview: String? = null,
    val printerConfigured: Boolean = false,
    val printerDescribe: String = "",
    /** The six switches on the settings screen, mirrored out of SharedPreferences. */
    val prefs: Map<String, Boolean> = emptyMap(),
    val paper: PaperWidth = PaperWidth.Mm80,
    val printerTestResult: String? = null,

    /** Non-null once a sale has gone through, until the cashier dismisses it. */
    val outcome: SaleOutcome? = null,
    /**
     * A submitted sale whose outcome is unknown. The basket is frozen while
     * this is set: retrying replays the same idempotency key, which is only
     * safe if the basket has not changed underneath it.
     */
    val settleFrozen: Boolean = false,
    /**
     * Whether the frozen sale can be parked and dealt with later.
     *
     * True only when the freeze is an UNCERTAIN outcome: the payload is
     * complete and carries its idempotency key, so parking it is safe — the
     * drain replays the same sale rather than charging again. False when a
     * manager's approval was involved (a replay would need the PIN, which is
     * not written to a shared till's disk) and false when the queue write is
     * what failed in the first place.
     */
    val settleParkable: Boolean = false,
    /**
     * The server refused the sale until a manager authorises the discount.
     * Set only from the server's answer — the device never decides this itself,
     * because only the rule row knows whether approval is required.
     */
    val needsApproval: Boolean = false,
    /**
     * A note the cashier attached to this sale.
     *
     * Prints on the receipt and travels with a held sale, which is what the
     * design promises — so it is cleared with the cart, not left to attach
     * itself to whatever is rung up next.
     */
    val note: String = "",

    /** Whether the till can reach its server. Derived from calls, not from Wi-Fi. */
    val online: Boolean = true,

    /** Sales parked and not yet sent. Shown as a badge so it is never invisible. */
    val queuedCount: Int = 0,
    /** How many the last drain got through, for a brief confirmation. */
    val queuedJustSent: Int = 0,
)

class TillViewModel(app: Application) : AndroidViewModel(app) {

    /**
     * Per-instance, not shared.
     *
     * It was a companion `val` first, which is a trap: `onCleared` closes it, so
     * the next ViewModel — after the activity is finished and the process kept
     * alive — would be handed an already-closed client and every call would
     * fail. One client per ViewModel, closed with it.
     */
    private val http = TillApi.httpClient()

    private val db = Room
        .databaseBuilder(app, TillDatabase::class.java, "till.db")
        // No destructive fallback. It was fine while this held only the
        // catalog — a cache of server state, cheaper to refetch than to
        // migrate — but `queued_sales` holds sales the shop has taken money for
        // and not yet sent. Dropping those to satisfy a version bump would lose
        // real revenue silently.
        .addMigrations(TillDatabase.MIGRATION_1_2)
        .build()

    private val repo = TillRepository(
        api = TillApi(http),
        auth = AuthClient(http),
        store = SessionStore(app),
        catalog = db.catalog(),
        queue = db.queue(),
    )

    private val printerSettings = PrinterSettings(app)

    private val _state = MutableStateFlow(
        TillState(printerDescribe = printerSettings.transport(app).describe),
    )
    val state: StateFlow<TillState> = _state.asStateFlow()

    /**
     * Names the current sale attempt.
     *
     * Minted once per basket and kept across every retry, which is the whole
     * point: pressing Confirm again after a failure must reach the server as
     * the SAME attempt, so a sale that committed without answering is replayed
     * rather than rung up twice. Rotated only once a sale actually finishes.
     */
    private var saleKey: String = UUID.randomUUID().toString()

    /** A submitted sale whose fate is unknown, kept so it can be parked. */
    private data class FrozenSale(
        val request: SaleRequest,
        val total: Double,
        val itemCount: Int,
        val change: Double,
        val methods: String,
    )

    private var frozenSale: FrozenSale? = null

    /**
     * What the last settle attempt tendered, so it can be resubmitted.
     *
     * Held HERE rather than in the composable that collected it. A ViewModel
     * outlives an activity recreation and `remember` does not, so a tablet
     * rotated while a sale was frozen — or while the manager-approval prompt
     * was open — came back with the payment list emptied underneath a screen
     * still asking the cashier to retry. The retry then posted nothing and the
     * server refused it as an underpayment for the full amount.
     */
    private var lastTender: Pair<List<SalePayment>, Double>? = null

    init {
        start()
        watchForIdle()
        // Mirrored into the UI state so screens can read one flow.
        viewModelScope.launch {
            repo.online.collect { up -> _state.update { it.copy(online = up) } }
        }
    }

    private fun start() = viewModelScope.launch {
        if (!repo.isSignedIn) {
            _state.update { it.copy(screen = TillScreen.DeviceSetup) }
            return@launch
        }
        // Whatever was cached last time, on screen before the network is asked.
        val cached = repo.cachedCatalog()
        if (cached.isNotEmpty()) _state.update { it.copy(catalog = cached) }
        _state.update { it.copy(queuedCount = repo.queuedCount()) }

        loadShop()
        startQueuePump()
    }

    private var queuePump: Job? = null

    /**
     * Drains now, then keeps draining on a heartbeat.
     *
     * Started from `start()` on a launch that is already signed in, and from
     * `signIn` for the session right after device setup — which used to get
     * neither, because `start()` had already returned at the not-signed-in
     * branch. In that session a parked sale sat there until the cashier
     * happened to ring up another one, close the day, or restart the app,
     * making a liar of the "it will send itself when the connection is back"
     * promise on the saved-to-send screen.
     *
     * Idempotent: a second call while one is running is ignored, so signing in
     * twice cannot leave two heartbeats draining the same queue against each
     * other.
     */
    private fun startQueuePump() {
        if (queuePump?.isActive == true) return
        queuePump = viewModelScope.launch {
            drainQueue()
            // The alternative is a queue that only moves when the cashier
            // happens to ring something up. A till can sit idle for an hour
            // with a customer's sale unsent, and the shop would not know.
            while (isActive) {
                delay(QUEUE_HEARTBEAT_MS)
                drainQueue()
            }
        }
    }

    // ------------------------------------------------------------- session

    fun signIn(email: String, password: String) = viewModelScope.launch {
        if (email.isBlank() || password.isEmpty()) {
            _state.update { it.copy(error = "Enter the till's email and password.") }
            return@launch
        }
        _state.update { it.copy(busy = true, error = null) }

        repo.signIn(email, password)
            .onSuccess {
                loadShop()
                // This session skipped start()'s pump at the not-signed-in
                // branch, so it starts here or the queue never drains itself.
                startQueuePump()
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(busy = false, error = cause.message ?: "Could not sign in.")
                }
            }
    }

    fun loadShop() = viewModelScope.launch {
        _state.update { it.copy(busy = true, error = null) }

        repo.bootstrap()
            .onSuccess { shop ->
                _state.update {
                    it.copy(
                        busy = false,
                        shop = shop,
                        deviceId = shop.deviceId,
                        screen = TillScreen.Locked,
                        error = null,
                    )
                }
                refreshCatalog()
            }
            .onFailure { cause ->
                // An UnauthorizedException here has ALREADY survived a refresh
                // attempt — `authed` retries once with a renewed token before
                // giving up. So the stored credentials are genuinely dead, not
                // merely stale, and no amount of retrying will fix it.
                //
                // This was a trap: `isSignedIn` only asks whether a refresh
                // token EXISTS, and an expired one still exists. The till landed
                // on the offline screen, whose only button is "Try again",
                // reporting a network fault for an auth failure — a shop would
                // go and check the Wi-Fi while the actual fix was to sign in,
                // with no way to reach that screen. Dead credentials are cleared
                // so the device asks for a sign-in it can actually be given.
                val expired = cause is UnauthorizedException
                if (expired) repo.signOut()

                // Otherwise stay put: a shop whose line has dropped should see
                // "could not reach the till server" over the keypad, not be
                // thrown back to a password prompt it cannot answer without the
                // owner.
                _state.update {
                    it.copy(
                        busy = false,
                        error = cause.message ?: "Could not reach the till server.",
                        screen = when {
                            expired -> TillScreen.DeviceSetup
                            it.shop == null && !repo.isSignedIn -> TillScreen.DeviceSetup
                            it.shop == null -> TillScreen.Locked
                            else -> it.screen
                        },
                    )
                }
            }
    }

    fun refreshCatalog() = viewModelScope.launch {
        _state.update { it.copy(catalogLoading = true) }
        repo.refreshCatalog()
            .onSuccess { variants ->
                _state.update { it.copy(catalog = variants, catalogLoading = false) }
            }
            .onFailure {
                // Silent. The cache is already on screen, and a red banner over
                // a working till helps nobody.
                _state.update { it.copy(catalogLoading = false) }
            }

        // Discounts ride along with the catalog: both are shop configuration
        // that changes in the back office, and neither is worth its own refresh.
        repo.discounts().onSuccess { response ->
            if (response.ok) _state.update { it.copy(discountRules = response.discounts) }
        }
    }

    // --------------------------------------------------------------- shift

    fun startOpeningShift() {
        val screen = _state.value.screen
        val cashier = cashierOf(screen) ?: return
        _state.update { it.copy(screen = TillScreen.OpeningShift(cashier), error = null) }
    }

    fun openShift(openingFloat: Double) = viewModelScope.launch {
        val cashier = cashierOf(_state.value.screen) ?: return@launch
        _state.update { it.copy(busy = true, error = null) }

        repo.openShift(openingFloat, _state.value.deviceId)
            .onSuccess { response ->
                if (response.ok && response.shift != null) {
                    _state.update {
                        it.copy(
                            busy = false,
                            error = null,
                            shop = it.shop?.copy(shift = response.shift),
                            screen = TillScreen.Selling(cashier),
                        )
                    }
                    toast("Shift open · float ${formatRs(openingFloat)}")
                } else {
                    _state.update {
                        it.copy(busy = false, error = response.error ?: "Could not open the till.")
                    }
                }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(busy = false, error = cause.message ?: "Could not open the till.")
                }
            }
    }

    /**
     * Opens the close screen and fetches what the drawer *should* hold.
     *
     * Fetched fresh rather than accumulated on the device: the expected figure
     * has to include sales rung up on any other till and every petty-cash
     * movement, none of which this device has seen.
     */
    fun startClosingShift() = viewModelScope.launch {
        val cashier = cashierOf(_state.value.screen) ?: return@launch
        if (_state.value.lines.isNotEmpty()) {
            _state.update { it.copy(error = "Finish or park the basket before closing the till.") }
            return@launch
        }

        // Anything parked goes out BEFORE the drawer is counted.
        //
        // This is not tidiness. `close_shift_z` freezes the Z from what is in
        // the database at that instant, and a queued sale is not there yet.
        // Close with three sales waiting and the Z is short by three sales
        // permanently — it cannot correct itself, because being frozen is the
        // whole point of it. Worse, they drain afterwards into a shift that is
        // already closed, so the drawer shows a surplus the Z cannot explain.
        if (_state.value.queuedCount > 0) {
            _state.update { it.copy(busy = true, error = null) }
            drainQueue().join()

            val stillWaiting = repo.queuedCount()
            if (stillWaiting > 0) {
                // WHY it is stuck decides what the cashier should do, and the
                // two cases need opposite advice. A sale waiting on the line
                // goes out by itself once the line is back. A sale the SERVER
                // refused — an oversell, a rule deleted mid-queue — will be
                // refused identically on every retry, so telling that cashier
                // to check the connection leaves them unable to close the till
                // at all, chasing a fault that is not there.
                val refusal = repo.failingSales()
                    .firstOrNull { !it.lastError.isNetworkish() }
                    ?.lastError

                _state.update {
                    it.copy(
                        busy = false,
                        queuedCount = stillWaiting,
                        error = if (refusal != null) {
                            "$stillWaiting sale${if (stillWaiting == 1) "" else "s"} " +
                                "cannot be sent. The server refused: \"$refusal\" " +
                                "This will not fix itself — the takings are on this " +
                                "tablet but not in the books, so get an owner to sort " +
                                "it before closing."
                        } else {
                            "$stillWaiting sale${if (stillWaiting == 1) "" else "s"} " +
                                "still waiting to send. The Z report is built from what " +
                                "the server has, so closing now would leave it short by " +
                                "${if (stillWaiting == 1) "that sale" else "those sales"}. " +
                                "Get the connection back, then close."
                        },
                    )
                }
                return@launch
            }
        }

        _state.update {
            it.copy(
                screen = TillScreen.ClosingShift(cashier),
                busy = true,
                // A held sale is not money the shop has taken, so it cannot make
                // the Z wrong the way a queued sale can — but it is a customer's
                // basket about to be forgotten overnight, and the person closing
                // is the last one who can do anything about it.
                error = if (it.held.isNotEmpty()) {
                    "${it.held.size} held sale${if (it.held.size == 1) " is" else "s are"} " +
                        "still parked. They are not part of today's takings and will be " +
                        "lost when the app closes."
                } else {
                    null
                },
            )
        }

        repo.shift()
            .onSuccess { state ->
                // The held-sale warning set above is deliberately preserved —
                // a successful figures fetch is not a reason to clear it.
                _state.update { it.copy(busy = false, shiftTotals = state.totals) }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(busy = false, error = cause.message ?: "Could not read the till total.")
                }
            }
    }

    fun closeShift(countedCash: Double, notes: String?) = viewModelScope.launch {
        val shiftId = _state.value.shop?.shift?.id ?: return@launch
        _state.update { it.copy(busy = true, error = null) }

        repo.closeShift(
            CloseShiftRequest(
                shiftId = shiftId,
                countedCash = countedCash,
                notes = notes?.trim()?.ifBlank { null },
                deviceId = _state.value.deviceId,
            ),
        )
            .onSuccess { response ->
                if (response.ok) {
                    _state.update {
                        it.copy(
                            busy = false,
                            error = null,
                            closeSummary = response,
                            shop = it.shop?.copy(shift = null),
                            receiptPreview = response.totals?.let { z ->
                                zLines(z, response).toPlainText(printerSettings.paper)
                            },
                        )
                    }
                    // Printed without being asked. The Z is the day's paperwork
                    // and the moment it is needed is now, standing at the
                    // drawer — not after remembering to go and find it.
                    response.totals?.let { printZ(it, response) }
                    toast("Shift closed · Z report printed")
                } else {
                    _state.update {
                        it.copy(busy = false, error = response.error ?: "Could not close the till.")
                    }
                }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(busy = false, error = cause.message ?: "Could not close the till.")
                }
            }
    }

    /**
     * Petty cash in or out of the drawer.
     *
     * The reason is required by `record_till_movement`, not by politeness: the
     * ledger is append-only, so a movement cannot be edited later. That line of
     * text is the only record of why the money left, and at close it is the
     * difference between a variance that is explained and one that is not.
     */
    fun recordMovement(amount: Double, payIn: Boolean, reason: String) = viewModelScope.launch {
        val shiftId = _state.value.shop?.shift?.id ?: run {
            _state.update { it.copy(movementError = "The till is closed.") }
            return@launch
        }

        _state.update { it.copy(busy = true, movementError = null) }

        repo.recordMovement(
            MovementRequest(
                shiftId = shiftId,
                amount = round2(amount),
                direction = if (payIn) "in" else "out",
                reason = reason,
                // Names this till, so the server can refuse a drawer that
                // belongs to another one.
                deviceId = _state.value.deviceId,
            ),
        )
            .onSuccess { response ->
                if (response.ok) {
                    _state.update {
                        it.copy(busy = false, movementError = null, movementDone = true)
                    }
                    // The expected-cash figure has moved, so anything showing it
                    // is now stale.
                    if (_state.value.screen is TillScreen.ClosingShift) refreshShiftTotals()
                } else {
                    _state.update {
                        it.copy(
                            busy = false,
                            movementError = response.error ?: "Could not record that.",
                        )
                    }
                }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(
                        busy = false,
                        movementError = cause.message ?: "Could not record that.",
                    )
                }
            }
    }

    fun clearMovementResult() =
        _state.update { it.copy(movementDone = false, movementError = null) }

    private fun refreshShiftTotals() = viewModelScope.launch {
        repo.shift().onSuccess { state ->
            _state.update { it.copy(shiftTotals = state.totals) }
        }
    }

    private fun zLines(z: ZTotals, close: CloseShiftResponse, reprint: Boolean = false) =
        buildZReport(
            z = z,
            shop = ShopIdentity(
                name = _state.value.shop?.shopName ?: "Kids Corner",
                address = _state.value.shop?.shopAddress,
                phone = _state.value.shop?.shopPhone,
                vatNumber = _state.value.shop?.vatNumber,
            ),
            width = printerSettings.paper,
            zNo = close.zNo,
            countedCash = close.countedCash,
            variance = close.variance,
            reprint = reprint,
        )

    /**
     * Sends the Z to the printer.
     *
     * A failure is reported but does not undo the close — the shift is already
     * closed and the slip is already frozen in `z_reports`, so the paper can be
     * reprinted from the back office. Rolling back a close because a printer
     * was out of paper would be far worse than a missing piece of paper.
     */
    private fun printZ(z: ZTotals, close: CloseShiftResponse) = viewModelScope.launch {
        val result = printerSettings
            .transport(getApplication())
            .send(EscPos.encode(zLines(z, close), printerSettings.paper))

        if (result is PrintResult.Failed) {
            _state.update {
                it.copy(
                    error = "The till is closed and the Z is saved, but it did not " +
                        "print: ${result.reason} Reprint it from the back office.",
                )
            }
        }
    }

    /** Back to the keypad after an end-of-day summary has been read. */
    fun finishClose() = _state.update {
        it.copy(screen = TillScreen.Locked, closeSummary = null, shiftTotals = null, error = null)
    }

    fun cancelClose() {
        val cashier = cashierOf(_state.value.screen) ?: return
        _state.update {
            it.copy(screen = TillScreen.Selling(cashier), shiftTotals = null, error = null)
        }
    }

    // ------------------------------------------------------------- history

    /**
     * Opens the return screen on one sale.
     *
     * The detail is re-read first and the screen only opens once it lands: a
     * return decides money, and deciding it against a copy that predates an
     * earlier credit note would offer to give back a unit already refunded.
     */
    fun openRefund(saleId: Int) = viewModelScope.launch {
        val cashier = cashierOf(_state.value.screen) ?: return@launch
        _state.update { it.copy(saleDetailLoading = true, historyError = null, refundDone = null) }
        repo.saleDetail(saleId)
            .onSuccess { response ->
                val sale = response.sale
                _state.update {
                    if (sale == null) {
                        it.copy(
                            saleDetailLoading = false,
                            historyError = response.error ?: "Could not open that sale.",
                        )
                    } else {
                        it.copy(
                            saleDetailLoading = false,
                            selectedSale = sale,
                            screen = TillScreen.Refunding(cashier),
                        )
                    }
                }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(
                        saleDetailLoading = false,
                        historyError = cause.message ?: "Could not open that sale.",
                    )
                }
            }
    }

    private var toastJob: Job? = null

    /** `toastMsg` — replaces whatever is showing, then clears after 2.2s. */
    fun toast(message: String) {
        toastJob?.cancel()
        _state.update { it.copy(toast = message) }
        toastJob = viewModelScope.launch {
            delay(2_200)
            _state.update { it.copy(toast = null) }
        }
    }

    fun openSettings() {
        val cashier = cashierOf(_state.value.screen) ?: return
        _state.update { it.copy(screen = TillScreen.Settings(cashier)) }
        refreshPrinterState()
    }

    fun closeSettings() {
        val cashier = cashierOf(_state.value.screen) ?: return
        _state.update { it.copy(screen = TillScreen.Selling(cashier), printerTestResult = null) }
    }

    fun setPaper(width: PaperWidth) {
        printerSettings.paper = width
        refreshPrinterState()
    }

    /**
     * One setter for six switches.
     *
     * Keyed rather than six functions because the screen already lists them by
     * key, and a seventh switch should mean one line in two places, not four.
     */
    fun setPref(key: String, on: Boolean) {
        // The settings screen's own key names, not the SharedPreferences ones —
        // where a value is stored is nobody else's business.
        when (key) {
            "autoPrint" -> printerSettings.autoPrint = on
            "askReceipt" -> printerSettings.askReceipt = on
            "drawerOnCash" -> printerSettings.drawerOnCash = on
            "drawerOnCard" -> printerSettings.drawerOnCard = on
            "beep" -> printerSettings.beepOnScan = on
            "roundCash" -> printerSettings.roundCash = on
            else -> return
        }
        refreshPrinterState()
    }

    /** Re-reads the store, so the screen never drifts from what is saved. */
    private fun refreshPrinterState() = _state.update {
        it.copy(
            printerConfigured = printerSettings.kind != PrinterSettings.Kind.None,
            printerDescribe = describePrinter(),
            paper = printerSettings.paper,
            prefs = mapOf(
                "autoPrint" to printerSettings.autoPrint,
                "askReceipt" to printerSettings.askReceipt,
                "drawerOnCash" to printerSettings.drawerOnCash,
                "drawerOnCard" to printerSettings.drawerOnCard,
                "beep" to printerSettings.beepOnScan,
                "roundCash" to printerSettings.roundCash,
            ),
        )
    }

    fun closeRefund() {
        val cashier = cashierOf(_state.value.screen) ?: return
        _state.update {
            it.copy(screen = TillScreen.Selling(cashier), selectedSale = null, historyError = null)
        }
    }

    fun dismissRefundDone() = _state.update { it.copy(refundDone = null) }

    /**
     * Posts the return.
     *
     * The till says what is coming back, why, how the money leaves and whether
     * the goods rejoin the shelf. It never says how much — that is worked out
     * server-side from what the customer actually paid for those units.
     */
    fun submitRefund(
        qtyByLine: Map<Int, Int>,
        reason: String,
        method: String,
        restock: Boolean,
    ) = viewModelScope.launch {
        val sale = _state.value.selectedSale ?: return@launch
        val items = qtyByLine.filterValues { it > 0 }.map { (id, qty) -> RefundItem(id, qty) }
        if (items.isEmpty()) return@launch

        _state.update { it.copy(busy = true, historyError = null) }
        repo.refund(
            RefundRequest(
                saleId = sale.id,
                shiftId = _state.value.shop?.shift?.id,
                reason = reason,
                refundMethod = method,
                restock = restock,
                items = items,
            ),
        )
            .onSuccess { response ->
                val cashier = cashierOf(_state.value.screen)
                val went = response.ok && cashier != null
                _state.update {
                    if (!went || cashier == null) {
                        it.copy(busy = false, historyError = response.error ?: "The return did not go through.")
                    } else {
                        it.copy(
                            busy = false,
                            screen = TillScreen.Selling(cashier),
                            selectedSale = null,
                            history = emptyList(),
                            refundDone = response,
                        )
                    }
                }
                // AFTER the update, never inside it. `MutableStateFlow.update`
                // is a compare-and-set retry loop: its lambda can run more than
                // once, and `toast` writes to the same flow — so from in there
                // it fired twice and the outer copy, built from the state as it
                // was before, threw the message away again.
                if (went) toast("Refunded ${formatRs(response.total)}")
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(
                        busy = false,
                        historyError = cause.message ?: "The return did not go through.",
                    )
                }
            }
    }

    private var historySearch: Job? = null

    fun searchHistory(query: String) {
        // Cancelled rather than fired and forgotten: a slow query for "S26" can
        // land after a fast one for "S260729-60" and replace the right answer
        // with a stale list, which at a till looks plausible enough to act on.
        historySearch?.cancel()
        historySearch = viewModelScope.launch {
            _state.update { it.copy(historyLoading = true, historyError = null) }
            repo.sales(query.trim())
                .onSuccess { response ->
                    _state.update {
                        it.copy(
                            historyLoading = false,
                            history = response.sales,
                            historyError = response.error,
                        )
                    }
                }
                .onFailure { cause ->
                    _state.update {
                        it.copy(
                            historyLoading = false,
                            historyError = cause.message ?: "Could not load past sales.",
                        )
                    }
                }
        }
    }

    /**
     * Loads one sale in full.
     *
     * Always from the server, never from the list row. A receipt is a claim
     * about what a customer paid, and serving one from a stale copy — after a
     * return or a credit note — would hand somebody a document that contradicts
     * the shop's own records.
     */
    fun selectSale(saleId: Int) = viewModelScope.launch {
        _state.update { it.copy(saleDetailLoading = true, historyError = null) }
        repo.saleDetail(saleId)
            .onSuccess { response ->
                _state.update {
                    it.copy(
                        saleDetailLoading = false,
                        selectedSale = response.sale,
                        historyError = response.error,
                    )
                }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(
                        saleDetailLoading = false,
                        historyError = cause.message ?: "Could not open that sale.",
                    )
                }
            }
    }

    /**
     * Records the print, renders the receipt, sends it, then reloads the sale.
     *
     * ORDER MATTERS, AND IS A TRADE-OFF.
     *
     * The trail is written *before* the paper comes out, for two reasons. The
     * receipt has to carry its own reprint number, which is not known until the
     * row exists. And of the two ways this can go wrong — a print recorded that
     * did not happen, or a print that happened and was not recorded — the
     * second is worse: an unrecorded reprint is invisible, and this trail exists
     * precisely so a second copy used to claim a refund twice can be seen.
     *
     * There is no way to make the two atomic. A thermal printer on port 9100
     * acknowledges nothing, so even a successful write proves only that the
     * socket took the bytes. When the send fails the cashier is told plainly
     * that the count now includes a print that did not reach paper.
     */
    fun printReceipt(saleId: Int, gift: Boolean = false) = viewModelScope.launch {
        _state.update { it.copy(printing = true, historyError = null) }
        toast(
            if (gift) "Gift receipt printing · prices hidden"
            else "Reprinting receipt",
        )

        val recorded = repo.recordPrint(saleId).getOrNull()
        if (recorded == null || !recorded.ok) {
            _state.update {
                it.copy(
                    printing = false,
                    historyError = recorded?.error ?: "Could not record that print.",
                )
            }
            return@launch
        }

        val sale = repo.saleDetail(saleId).getOrNull()?.sale
        if (sale == null) {
            _state.update {
                it.copy(printing = false, historyError = "Could not load that receipt.")
            }
            return@launch
        }

        val shop = _state.value.shop
        val lines = buildReceipt(
            sale = sale,
            shop = ShopIdentity(
                name = shop?.shopName ?: "Kids Corner",
                address = shop?.shopAddress,
                phone = shop?.shopPhone,
                vatNumber = shop?.vatNumber,
            ),
            width = printerSettings.paper,
            reprintNumber = recorded.printCount ?: 1,
            gift = gift,
        )

        val result = printerSettings
            .transport(getApplication())
            .send(EscPos.encode(lines, printerSettings.paper))

        _state.update {
            it.copy(
                printing = false,
                selectedSale = sale,
                receiptPreview = lines.toPlainText(printerSettings.paper),
                historyError = when (result) {
                    is PrintResult.Sent -> null
                    is PrintResult.Failed ->
                        "${result.reason} The reprint has still been recorded — " +
                            "this receipt now counts as printed ${recorded.printCount ?: 1} times."
                },
            )
        }
    }

    /** Renders what would print, without printing or recording anything. */
    fun previewReceipt(saleId: Int) = viewModelScope.launch {
        val sale = _state.value.selectedSale?.takeIf { it.id == saleId }
            ?: repo.saleDetail(saleId).getOrNull()?.sale
            ?: return@launch

        val shop = _state.value.shop
        val lines = buildReceipt(
            sale = sale,
            shop = ShopIdentity(
                name = shop?.shopName ?: "Kids Corner",
                address = shop?.shopAddress,
                phone = shop?.shopPhone,
                vatNumber = shop?.vatNumber,
            ),
            width = printerSettings.paper,
            // The preview shows the copy that *would* come next, so a cashier
            // sees the REPRINT banner before committing to it.
            reprintNumber = sale.prints.size + 1,
        )

        _state.update { it.copy(receiptPreview = lines.toPlainText(printerSettings.paper)) }
    }

    fun dismissPreview() = _state.update { it.copy(receiptPreview = null) }

    // ------------------------------------------------------------- printer

    val printer: PrinterSettings get() = printerSettings

    fun savePrinter(kind: PrinterSettings.Kind, address: String, name: String, paper: PaperWidth) {
        printerSettings.kind = kind
        printerSettings.address = address
        printerSettings.name = name
        printerSettings.paper = paper
        _state.update { it.copy(printerDescribe = describePrinter()) }
    }

    private fun describePrinter(): String =
        printerSettings.transport(getApplication()).describe

    /**
     * Sends a short job to prove the link works.
     *
     * Deliberately not a real receipt: a test that printed a plausible-looking
     * receipt would produce a piece of paper indistinguishable from a genuine
     * one, which is the last thing a shop needs lying around.
     */
    fun testPrinter() = viewModelScope.launch {
        _state.update { it.copy(printing = true, printerTestResult = null) }

        val lines = listOf<ReceiptLine>(
            ReceiptLine.Text("Kids Corner", Align.Centre, bold = true, big = true),
            ReceiptLine.Feed(),
            ReceiptLine.Text("PRINTER TEST — NOT A RECEIPT", Align.Centre, bold = true),
            ReceiptLine.Rule,
            ReceiptLine.Columns("Paper", printerSettings.paper.label),
            ReceiptLine.Columns("Columns", printerSettings.paper.columns.toString()),
            ReceiptLine.Feed(2),
        )

        val result = printerSettings
            .transport(getApplication())
            .send(EscPos.encode(lines, printerSettings.paper))

        _state.update {
            it.copy(
                printing = false,
                printerTestResult = when (result) {
                    is PrintResult.Sent ->
                        "Sent. If nothing came out, the printer took the bytes but did " +
                            "not print — check paper and power."
                    is PrintResult.Failed -> result.reason
                },
            )
        }
    }

    fun clearPrinterTest() = _state.update { it.copy(printerTestResult = null) }

    private fun cashierOf(screen: TillScreen): Cashier? = when (screen) {
        is TillScreen.Selling -> screen.cashier
        is TillScreen.Paying -> screen.cashier
        is TillScreen.OpeningShift -> screen.cashier
        is TillScreen.ClosingShift -> screen.cashier
        is TillScreen.Refunding -> screen.cashier
        is TillScreen.Settings -> screen.cashier
        else -> null
    }

    fun submitPin(cashier: Cashier, pin: String) = viewModelScope.launch {
        _state.update { it.copy(busy = true, error = null) }

        repo.verifyPin(cashier.id, pin, _state.value.deviceId)
            .onSuccess { result ->
                if (result.ok && result.cashier != null) {
                    /*
                     * A closed till lands on the float screen, not the sell
                     * screen.
                     *
                     * Selling was the old landing, and it let a cashier scan a
                     * whole basket before PAY refused it — the till has to be
                     * open for a sale to have a drawer to go in. Finding that
                     * out at the end, with a customer waiting, is the worst
                     * possible moment.
                     *
                     * The cached shift is only consulted when it says a shift
                     * IS open, because that is the common case and a cashier
                     * switch is meant to take about three seconds. When it says
                     * closed, the server is asked — the cache was filled at app
                     * start and the back office or another till may have opened
                     * one since, and sending somebody to count a float for a
                     * drawer that is already open is a dead end.
                     */
                    val open = _state.value.shop?.shift
                        ?: repo.shift().getOrNull()?.shift

                    _state.update {
                        it.copy(
                            busy = false,
                            error = null,
                            lockedFor = 0,
                            shop = if (open != null) it.shop?.copy(shift = open) else it.shop,
                            screen = if (open != null) {
                                TillScreen.Selling(result.cashier)
                            } else {
                                TillScreen.OpeningShift(result.cashier)
                            },
                        )
                    }
                } else {
                    _state.update {
                        it.copy(
                            busy = false,
                            error = result.error ?: "Wrong PIN.",
                            lockedFor = result.lockedFor,
                        )
                    }
                }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(busy = false, error = cause.message ?: "Could not check that PIN.")
                }
            }
    }

    /**
     * Back to the keypad.
     *
     * Refuses while a sale's outcome is unknown: locking would hide the only
     * screen that can resolve it, and the basket would sit frozen with nothing
     * able to retry it.
     */
    fun lock() {
        if (_state.value.settleFrozen) return
        _state.update {
            it.copy(screen = TillScreen.Locked, error = null, lockedFor = 0, outcome = null)
        }
    }

    fun clearError() = _state.update { it.copy(error = null) }

    /**
     * Hand the till to another cashier without closing the shift.
     *
     * Refused while there is a basket. Not because the sale would be recorded
     * wrongly — it is attributed to whoever completes it, which is the truthful
     * record — but because a half-built basket changing hands silently is how
     * one customer ends up paying for another's items. The handover route for a
     * basket in progress is Hold, then Resume.
     */
    fun switchCashier() {
        if (_state.value.lines.isNotEmpty()) {
            _state.update {
                it.copy(error = "Finish or hold the basket before switching cashier.")
            }
            return
        }
        _state.update { it.copy(screen = TillScreen.Locked, error = null, lockedFor = 0) }
    }

    /**
     * Locks the till after a spell of no input.
     *
     * A till is left facing a shop floor all day. Without this, "signed in as
     * Marie" survives Marie going home, and every sale after that carries her
     * name — which makes the cashier field on a sale worth nothing.
     */
    fun noteActivity() {
        lastTouch = System.currentTimeMillis()
    }

    private var lastTouch = System.currentTimeMillis()

    private fun watchForIdle() = viewModelScope.launch {
        while (isActive) {
            delay(IDLE_CHECK_MS)
            val current = _state.value
            val selling = current.screen is TillScreen.Selling
            val idleFor = System.currentTimeMillis() - lastTouch

            // Only from the sell screen, and only with an empty basket. Locking
            // over a part-built basket or mid-payment would lose a cashier's
            // work while they were reaching for a bag.
            if (selling && current.lines.isEmpty() && idleFor >= IDLE_LOCK_MS) {
                _state.update { it.copy(screen = TillScreen.Locked, error = null) }
            }
        }
    }

    fun forgetDevice() {
        repo.signOut()
        _state.update { TillState(screen = TillScreen.DeviceSetup) }
    }

    // ---------------------------------------------------------------- cart

    private fun mutateCart(block: (List<CartLine>) -> List<CartLine>) {
        // Frozen while a sale's fate is unknown. Editing the basket then
        // resubmitting under the same idempotency key would replay the ORIGINAL
        // sale and silently discard the edit.
        if (_state.value.settleFrozen) return
        _state.update { current ->
            val lines = block(current.lines)
            current.copy(lines = lines, totals = totalsFor(lines, current))
        }
    }

    private fun totalsFor(lines: List<CartLine>, state: TillState): CartTotals =
        cartTotals(
            lines,
            saleDiscount = state.discount?.amount ?: 0.0,
            vatRate = state.shop?.vatRate ?: 0.15,
        )

    /** Recomputes totals after anything that can change them. */
    private fun retotal(state: TillState): TillState =
        state.copy(totals = totalsFor(state.lines, state))

    fun addVariant(variant: CatalogVariant) = mutateCart { it.withVariant(variant) }

    fun setQty(variantId: Int, qty: Int) = mutateCart { it.withQty(variantId, qty) }

    fun removeLine(variantId: Int) = mutateCart { it.without(variantId) }

    /**
     * Money off one line — the design's own per-line chips.
     *
     * `kind` is "percent" or "amount"; null clears it. The figure is a quote:
     * `priceItems` re-derives the line from `product_variants` and clamps this
     * against the line's gross, and because any line discount is a cashier
     * deciding the price, `settleDiscounts` now demands a manager for it exactly
     * as it does for a manual sale discount.
     */
    fun setLineDiscount(variantId: Int, kind: String?, value: Double) =
        mutateCart { it.withLineDiscount(variantId, kind, value) }

    /**
     * A unit price set by hand — `atSell`'s "Price" key.
     *
     * Carried as the line's discount, so it arrives at the server on the rail
     * that already re-derives it from the catalogue, clamps it to the line and
     * demands a manager. Null returns the line to the list price.
     */
    fun setPriceOverride(variantId: Int, price: Double?) {
        mutateCart { it.withPriceOverride(variantId, price) }
        toast(if (price == null) "Back to list price" else "Unit price set to ${formatRs(price)}")
    }

    fun addCustomItem(description: String, price: Double) =
        mutateCart { it.withCustomItem(description, price) }

    fun setNote(note: String) {
        if (_state.value.settleFrozen) return
        _state.update { it.copy(note = note.trim()) }
    }

    fun clearCart() {
        if (_state.value.settleFrozen) return
        if (_state.value.lines.isEmpty()) {
            toast("Cart is already empty")
            return
        }
        _state.update {
            retotal(it.copy(lines = emptyList(), discount = null, customer = null, note = ""))
        }
        toast("Sale cleared")
    }

    // ------------------------------------------------------------ customer

    fun attachCustomer(customer: Customer?) {
        if (_state.value.settleFrozen) return
        _state.update { it.copy(customer = customer, customerResults = emptyList()) }
    }

    /**
     * Serialised behind a job handle rather than fired and forgotten.
     *
     * Without the cancel, a slow query for "ma" can land after a fast one for
     * "marie" and overwrite the right results with stale ones — the classic
     * search race, and a confusing one at a till because the list looks
     * plausible.
     */
    private var customerSearch: Job? = null

    fun searchCustomers(query: String) {
        customerSearch?.cancel()
        val trimmed = query.trim()
        if (trimmed.length < 2) {
            _state.update { it.copy(customerResults = emptyList(), customerSearching = false) }
            return
        }

        customerSearch = viewModelScope.launch {
            _state.update { it.copy(customerSearching = true, customerError = null) }
            repo.searchCustomers(trimmed)
                .onSuccess { response ->
                    _state.update {
                        it.copy(customerSearching = false, customerResults = response.customers)
                    }
                }
                .onFailure { cause ->
                    _state.update {
                        it.copy(
                            customerSearching = false,
                            customerError = cause.message ?: "Could not search customers.",
                        )
                    }
                }
        }
    }

    fun createCustomer(name: String, phone: String?) = viewModelScope.launch {
        _state.update { it.copy(customerSearching = true, customerError = null) }
        repo.createCustomer(name, phone)
            .onSuccess { response ->
                if (response.ok && response.customer != null) {
                    _state.update {
                        it.copy(
                            customerSearching = false,
                            customer = response.customer,
                            customerResults = emptyList(),
                            customerError = null,
                        )
                    }
                } else {
                    _state.update {
                        it.copy(
                            customerSearching = false,
                            customerError = response.error ?: "Could not add that customer.",
                        )
                    }
                }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(
                        customerSearching = false,
                        customerError = cause.message ?: "Could not add that customer.",
                    )
                }
            }
    }

    // ------------------------------------------------------------ discount

    /**
     * Puts a discount on the basket.
     *
     * The amount shown is a preview computed from the rule. The server refuses,
     * recomputes or clamps it at commit time, so the only thing this decides is
     * what the cashier and customer see before they agree a price.
     */
    fun applyDiscount(discount: AppliedDiscountLocal?) {
        if (_state.value.settleFrozen) return
        val had = _state.value.discount != null
        _state.update { retotal(it.copy(discount = discount)) }
        when {
            discount != null -> toast("Basket discount ${discount.label}")
            had -> toast("Basket discount removed")
        }
    }

    // --------------------------------------------------------- held sales

    /**
     * Parks the basket.
     *
     * Named after the customer where there is one, so "resume Marie's" is
     * possible without opening each held sale to look.
     */
    fun holdSale() {
        val current = _state.value
        if (current.settleFrozen) return
        if (current.lines.isEmpty()) {
            toast("Nothing to hold yet")
            return
        }

        val label = current.customer?.fullName
            ?: "${current.totals.itemCount} items · ${formatRs(current.totals.total)}"

        val sale = HeldSale(
            id = UUID.randomUUID().toString(),
            label = label,
            lines = current.lines,
            customer = current.customer,
            discount = current.discount,
            heldAt = System.currentTimeMillis(),
        )

        // A parked basket is a different sale attempt from whatever is rung up
        // next, so the key is retired with it. Reusing it would make the server
        // replay this basket instead of the new one.
        saleKey = UUID.randomUUID().toString()

        _state.update {
            retotal(
                it.copy(
                    held = it.held + sale,
                    lines = emptyList(),
                    customer = null,
                    discount = null,
                ),
            )
        }
        toast("Sale held · $label")
    }

    /**
     * Brings a parked basket back.
     *
     * Quantities are re-clamped against the catalog as it stands now: stock may
     * have been sold on another till while this sat parked, and a resumed
     * basket asking for more than exists would only fail at payment.
     */
    fun resumeSale(id: String) {
        val current = _state.value
        if (current.lines.isNotEmpty() || current.settleFrozen) return
        val sale = current.held.firstOrNull { it.id == id } ?: return

        val stock = current.catalog.associateBy { it.id }
        val revived = sale.lines.mapNotNull { line ->
            val onHand = stock[line.variantId]?.qtyOnHand ?: return@mapNotNull null
            if (onHand <= 0) null else line.copy(qty = minOf(line.qty, onHand), qtyOnHand = onHand)
        }

        saleKey = UUID.randomUUID().toString()

        toast("Resumed ${sale.label}")

        _state.update {
            retotal(
                it.copy(
                    held = it.held.filterNot { h -> h.id == id },
                    lines = revived,
                    customer = sale.customer,
                    discount = sale.discount,
                    error = if (revived.size < sale.lines.size) {
                        "Some items sold out while this was on hold and were removed."
                    } else {
                        null
                    },
                ),
            )
        }
    }

    fun discardHeld(id: String) {
        _state.update { it.copy(held = it.held.filterNot { h -> h.id == id }) }
        toast("Held sale discarded")
    }

    /** Resolves a scanned barcode against the cached catalog. Null if unknown. */
    fun findByBarcode(code: String): CatalogVariant? {
        val trimmed = code.trim()
        if (trimmed.isEmpty()) return null
        return _state.value.catalog.firstOrNull { it.barcode?.trim() == trimmed }
    }

    // ------------------------------------------------------------- payment

    fun startPayment() {
        val screen = _state.value.screen
        if (screen !is TillScreen.Selling || _state.value.lines.isEmpty()) return
        _state.update { it.copy(screen = TillScreen.Paying(screen.cashier), error = null) }
    }

    fun cancelPayment() {
        val screen = _state.value.screen
        if (screen !is TillScreen.Paying) return
        if (_state.value.settleFrozen) return
        _state.update { it.copy(screen = TillScreen.Selling(screen.cashier), error = null) }
    }

    /**
     * Commits the sale.
     *
     * Sends variant ids and quantities only. Every price, every discount and
     * the total are rebuilt on the server, so nothing here is trusted — which
     * is why a stale catalog on this device is a display problem rather than a
     * pricing one.
     */
    fun confirmSale(
        payments: List<SalePayment>,
        change: Double,
        approval: Approval? = null,
    ) = viewModelScope.launch {
        val current = _state.value
        val screen = current.screen
        if (screen !is TillScreen.Paying) return@launch
        val shiftId = current.shop?.shift?.id ?: run {
            _state.update { it.copy(error = "The till is closed. Open it before selling.") }
            return@launch
        }
        if (current.lines.isEmpty()) return@launch

        // Remembered before the attempt, so a retry or an approval resubmit
        // has the tender even if the screen that collected it has been
        // recreated since.
        lastTender = payments to change

        _state.update { it.copy(busy = true, error = null) }

        val request = SaleRequest(
            shiftId = shiftId,
            customerId = current.customer?.id,
            cashierId = screen.cashier.id,
            // A custom line's synthetic negative key is stripped here: the
            // server keys off a null variant plus a description, and a
            // negative id would be a foreign key to nothing.
            items = current.lines.map { line ->
                if (line.isCustom) {
                    SaleItem(
                        variantId = null,
                        qty = line.qty,
                        discount = round2(line.discount),
                        description = line.description,
                        unitPrice = round2(line.unitPrice),
                    )
                } else {
                    SaleItem(line.variantId, line.qty, round2(line.discount))
                }
            },
            payments = payments,
            discounts = listOfNotNull(current.discount?.toRequest()),
            approval = approval,
            idempotencyKey = saleKey,
        )

        repo.completeSale(request)
            .onSuccess { result ->
                if (result.ok) {
                    val outcome = SaleOutcome(
                        saleId = result.saleId,
                        change = change,
                        itemCount = current.totals.itemCount,
                        total = current.totals.total,
                        methods = payments.map { it.method }.distinct()
                            .joinToString(", ") { m ->
                                when (m) {
                                    "cash" -> "Cash"; "card" -> "Card"; "juice" -> "Juice"
                                    "myt_money" -> "my.t money"; else -> m
                                }
                            },
                    )
                    // A finished sale is the only thing that retires the key. A
                    // fresh basket must never reuse it, or the server would
                    // replay this sale instead of ringing up the next one.
                    saleKey = UUID.randomUUID().toString()
                    _state.update {
                        it.copy(
                            busy = false,
                            settleFrozen = false,
                            settleParkable = false,
                            lines = emptyList(),
                            totals = CartTotals(),
                            customer = null,
                            discount = null,
                            // Cleared with the cart, or it attaches itself to
                            // whatever the next customer buys.
                            note = "",
                            needsApproval = false,
                            outcome = outcome,
                            screen = TillScreen.Selling(screen.cashier),
                        )
                    }
                    // Stock moved, so the cached quantities are now wrong.
                    refreshCatalog()
                    // A sale going through is the clearest signal the line is
                    // back, so anything parked earlier goes out now.
                    drainQueue()
                } else {
                    if (result.uncertain) {
                        frozenSale = FrozenSale(
                            request = request,
                            total = current.totals.total,
                            itemCount = current.totals.itemCount,
                            change = change,
                            methods = payments.map { it.method }.distinct().joinToString(", "),
                        )
                    }
                    _state.update {
                        it.copy(
                            busy = false,
                            error = result.error ?: "The sale did not go through.",
                            needsApproval = result.needsApproval,
                            // Uncertain means it may have committed. Freeze the
                            // basket so the cashier can only retry it, not edit
                            // and resubmit it under the same key.
                            settleFrozen = result.uncertain,
                            settleParkable = result.uncertain,
                        )
                    }
                }
            }
            .onFailure { cause ->
                // No answer at all, so whether the sale committed is unknown.
                //
                // A sale that needed a manager is NOT queued. Approval is
                // re-verified server-side before every commit, so a replay
                // would need the PIN again — which would mean writing a
                // manager's PIN to disk on a shared till, to buy nothing.
                // Those hold the cashier on the frozen screen instead.
                if (approval != null) {
                    _state.update {
                        it.copy(
                            busy = false,
                            settleFrozen = true,
                            settleParkable = false,
                            error = cause.message ?: "Couldn't reach the till server.",
                        )
                    }
                    return@onFailure
                }

                // Otherwise park it and let the cashier serve the next
                // customer. The queued attempt carries the same idempotency
                // key, so if it did commit the drain replays it rather than
                // charging again.
                val queued = repo.enqueueSale(
                    request,
                    total = current.totals.total,
                    itemCount = current.totals.itemCount,
                )

                if (queued) {
                    saleKey = UUID.randomUUID().toString()
                    _state.update {
                        it.copy(
                            busy = false,
                            settleFrozen = false,
                            settleParkable = false,
                            lines = emptyList(),
                            totals = CartTotals(),
                            customer = null,
                            discount = null,
                            note = "",
                            needsApproval = false,
                            queuedCount = it.queuedCount + 1,
                            outcome = SaleOutcome(
                                saleId = null,
                                change = change,
                                itemCount = current.totals.itemCount,
                                total = current.totals.total,
                                methods = payments.map { it.method }.distinct().joinToString(", "),
                                queued = true,
                            ),
                            screen = TillScreen.Selling(screen.cashier),
                        )
                    }
                } else {
                    // The queue write itself failed. Better to block one sale
                    // than to tell somebody it is saved when it is not.
                    _state.update {
                        it.copy(
                            busy = false,
                            settleFrozen = true,
                            settleParkable = false,
                            error = cause.message ?: "Couldn't reach the till server.",
                        )
                    }
                }
            }
    }

    /**
     * Resubmits the frozen sale, under its original idempotency key.
     *
     * Reads the tender from this ViewModel rather than from the screen, so a
     * retry works even after the activity has been recreated. `saleKey` is
     * untouched until something succeeds, so this replays the same sale rather
     * than ringing up a second one.
     */
    fun retryFrozenSale(approval: Approval? = null) {
        val (payments, change) = lastTender ?: run {
            _state.update {
                it.copy(error = "This till has lost track of what was tendered. Cancel and ring it up again.")
            }
            return
        }
        confirmSale(payments, change, approval)
    }

    /**
     * Parks a sale the till could not get an answer about, and frees the till.
     *
     * The escape hatch from a frozen settle. Without it a cashier whose line
     * dropped at exactly the wrong moment had a payment screen with every key
     * disabled and no way forward but force-killing the app — which loses the
     * basket AND the idempotent retry for a sale the customer may already have
     * paid for.
     *
     * Only offered when the freeze was an uncertain OUTCOME, never when a
     * manager's approval is in play: the parked payload would need that PIN
     * again on replay, and a shared till must not keep one on disk.
     */
    fun parkFrozenSale() = viewModelScope.launch {
        val frozen = frozenSale ?: return@launch
        if (!_state.value.settleParkable) return@launch

        val parked = repo.enqueueSale(frozen.request, frozen.total, frozen.itemCount)
        if (!parked) {
            _state.update {
                it.copy(error = "This sale could not be saved to send later. Try again.")
            }
            return@launch
        }

        // A new key only now: the parked payload keeps the old one, so the
        // drain replays that sale rather than ringing up a second.
        saleKey = UUID.randomUUID().toString()
        frozenSale = null

        val screen = _state.value.screen
        val cashier = (screen as? TillScreen.Paying)?.cashier
        _state.update {
            it.copy(
                busy = false,
                error = null,
                settleFrozen = false,
                settleParkable = false,
                lines = emptyList(),
                totals = CartTotals(),
                customer = null,
                discount = null,
                note = "",
                needsApproval = false,
                queuedCount = it.queuedCount + 1,
                outcome = SaleOutcome(
                    saleId = null,
                    change = frozen.change,
                    itemCount = frozen.itemCount,
                    total = frozen.total,
                    methods = frozen.methods,
                    queued = true,
                ),
                screen = if (cashier != null) TillScreen.Selling(cashier) else it.screen,
            )
        }
    }

    /**
     * Sends anything parked, oldest first.
     *
     * Called on launch, after every successful sale — a sale going through is
     * the clearest possible signal the line is back — and on the heartbeat
     * below.
     */
    /** Returns the job so a caller that must not proceed until it lands can wait. */
    fun drainQueue(): Job = viewModelScope.launch {
        if (!repo.isSignedIn) return@launch
        val sent = repo.drainQueue()
        val remaining = repo.queuedCount()
        _state.update {
            it.copy(
                queuedCount = remaining,
                queuedJustSent = if (sent > 0) sent else it.queuedJustSent,
            )
        }
        if (sent > 0) refreshCatalog()
    }

    fun clearQueuedNotice() = _state.update { it.copy(queuedJustSent = 0) }

    fun dismissOutcome() = _state.update { it.copy(outcome = null) }

    /** Closes the manager prompt without clearing the reason it was refused. */
    fun clearApprovalPrompt() = _state.update { it.copy(needsApproval = false) }

    override fun onCleared() {
        http.close()
        db.close()
        super.onCleared()
    }

    private companion object {
        /**
         * Two minutes. Frequent enough that a shop whose line came back does not
         * carry unsent sales for long, rare enough not to be a battery or data
         * cost on a tablet that is idle most of the day.
         */
        const val QUEUE_HEARTBEAT_MS = 120_000L

        /**
         * Five minutes idle, checked every fifteen seconds.
         *
         * Long enough that a quiet spell between customers does not make staff
         * re-enter a PIN constantly — which is how a shop ends up writing the
         * PIN on a sticker beside the screen.
         */
        const val IDLE_LOCK_MS = 5 * 60_000L
        const val IDLE_CHECK_MS = 15_000L
    }
}
