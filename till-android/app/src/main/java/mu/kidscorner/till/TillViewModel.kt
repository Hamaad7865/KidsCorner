package mu.kidscorner.till

import android.app.Application
import android.media.AudioManager
import android.media.ToneGenerator
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
import mu.kidscorner.till.data.AppUpdater
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
import mu.kidscorner.till.data.CreateCustomerRequest
import mu.kidscorner.till.data.CreditCharge
import mu.kidscorner.till.data.Customer
import mu.kidscorner.till.data.DiscountRule
import mu.kidscorner.till.data.DownloadState
import mu.kidscorner.till.data.HeldSale
import mu.kidscorner.till.data.MovementRequest
import mu.kidscorner.till.data.OfflineGate
import mu.kidscorner.till.data.RefundItem
import mu.kidscorner.till.data.RefundRequest
import mu.kidscorner.till.data.RefundResponse
import mu.kidscorner.till.data.SaleDetail
import mu.kidscorner.till.data.SaleItem
import mu.kidscorner.till.data.SalePayment
import mu.kidscorner.till.data.SaleRequest
import mu.kidscorner.till.data.SaleSummary
import mu.kidscorner.till.data.SessionStore
import mu.kidscorner.till.data.SettleCreditRequest
import mu.kidscorner.till.data.ShiftTotals
import mu.kidscorner.till.data.StockCheckLocation
import mu.kidscorner.till.data.TillApi
import mu.kidscorner.till.data.ZTotals
import mu.kidscorner.till.data.TillDatabase
import mu.kidscorner.till.data.TillRepository
import mu.kidscorner.till.data.SessionEndedException
import mu.kidscorner.till.data.UnauthorizedException
import mu.kidscorner.till.data.cartTotals
import mu.kidscorner.till.data.formatRs
import mu.kidscorner.till.data.isNetworkish
import mu.kidscorner.till.data.round2
import mu.kidscorner.till.print.AccountPaymentSlipDoc
import mu.kidscorner.till.print.Align
import mu.kidscorner.till.print.EscPos
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.PrintResult
import mu.kidscorner.till.print.PrinterSettings
import mu.kidscorner.till.print.ReceiptLine
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.CreditNoteDoc
import mu.kidscorner.till.print.buildAccountPaymentSlip
import mu.kidscorner.till.print.buildCreditNote
import mu.kidscorner.till.print.buildReceipt
import mu.kidscorner.till.print.buildZReport
import mu.kidscorner.till.print.toPlainText
import mu.kidscorner.till.data.withQty
import mu.kidscorner.till.data.withLineDiscount
import mu.kidscorner.till.data.withCustomItem
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

    /** Looking up live stock without changing the active sale. */
    data class StockCheck(val cashier: Cashier) : TillScreen

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

data class StockCheckUiState(
    val productId: Int? = null,
    val locations: List<StockCheckLocation> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
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
    /**
     * Somebody asked the till to go and look for the shop again.
     *
     * Its own flag rather than `busy`, which the lock screen reads as
     * "checking a PIN" and would answer with the wrong spinner and the wrong
     * word over an empty keypad.
     */
    val reconnecting: Boolean = false,

    /**
     * The published version this till would be updating to, once bootstrap
     * has reported one newer than [mu.kidscorner.till.BuildConfig.VERSION_CODE].
     * Null the rest of the time — the pill has nothing to say about updates.
     */
    val updateVersionName: String? = null,
    /** Where that update's download currently stands. */
    val updateDownload: DownloadState = DownloadState.None,

    val catalog: List<CatalogVariant> = emptyList(),
    val catalogLoading: Boolean = false,
    val stockCheck: StockCheckUiState = StockCheckUiState(),

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

    /** A customer's payment on account, mid-flight or refused. */
    val creditPaymentBusy: Boolean = false,
    val creditPaymentError: String? = null,
    val creditPaymentDone: Boolean = false,
    /** The sales behind the picked customer's tab, shown while settling. */
    val creditCharges: List<CreditCharge> = emptyList(),
    val creditChargesLoading: Boolean = false,

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
    /**
     * A return the server refused until a manager approves it.
     *
     * Held so the approval prompt has something to resubmit. It also tells the
     * prompt WHICH act it is authorising: `needsApproval` is shared with the
     * sale path, and without this the dialog would take a manager's PIN for a
     * refund and retry a frozen sale with it.
     */
    val pendingRefund: RefundRequest? = null,
    /**
     * A new customer the server refused to open a credit account for until a
     * manager approves it. Held for the same reason as [pendingRefund] — to
     * resubmit once a PIN is typed, and to tell the shared approval prompt
     * which act it is authorising.
     */
    val pendingCustomerCreate: CreateCustomerRequest? = null,

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

/**
 * Folds a fresh bootstrap's VAT policy into the running state, mid-trade.
 *
 * Pure, so the rule can be tested without a device. It preserves everything the
 * till is in the middle of — the active local shift, the cashier roster, the
 * basket lines — and the payable total, because prices are VAT-inclusive so the
 * total never moves when the rate does. Only the current VAT policy and the
 * contained-VAT display change. The shift is kept from the running state, not
 * taken from `fresh`: `getOpenShift` is shop-scoped, so in a two-till shop the
 * fresh answer could name the other drawer.
 */
internal fun applyBootstrapPolicy(state: TillState, fresh: Bootstrap): TillState {
    val current = state.shop
    val merged = if (current == null) {
        fresh
    } else {
        fresh.copy(shift = current.shift, cashiers = current.cashiers)
    }
    return state.copy(
        shop = merged,
        totals = cartTotals(
            state.lines,
            state.discount?.amount ?: 0.0,
            merged.resolvedVatRate,
        ),
        // Refreshed whenever this round says something is available, so a
        // second, newer release supersedes the name shown for the first.
        // Left as it was on a round that reports nothing — a single missed
        // GitHub check must not make an already-found update disappear.
        updateVersionName = if (fresh.updateAvailable) fresh.latestVersionName else state.updateVersionName,
    )
}

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
        .addMigrations(
            TillDatabase.MIGRATION_1_2,
            TillDatabase.MIGRATION_2_3,
            TillDatabase.MIGRATION_3_4,
            TillDatabase.MIGRATION_4_5,
        )
        .build()

    private val repo = TillRepository(
        api = TillApi(http),
        auth = AuthClient(http),
        store = SessionStore(app),
        gate = OfflineGate(app),
        catalog = db.catalog(),
        queue = db.queue(),
    )

    private val printerSettings = PrinterSettings(app)
    private val appUpdater = AppUpdater(app)

    /**
     * Credit notes already sent to the printer, by number.
     *
     * A credit note is a claim on the drawer, so it must print exactly once. The
     * refund success path fires the print, and this set makes a second attempt
     * for the same number — a resubmit, a recomposition — a no-op.
     */
    private val printedCreditNotes = mutableSetOf<String>()

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

    /**
     * The VAT policy and instant frozen for the current sale attempt.
     *
     * Keyed to [saleKey], so it lives and dies with the attempt: rotating the
     * key on a finished or parked sale invalidates it automatically, and the
     * next checkout mints a fresh one — no rotation site has to remember to
     * clear it. Once minted it never changes for the attempt, so an approval,
     * network or idempotency retry sends the exact same policy id and time.
     */
    private data class CheckoutFreeze(
        val saleKey: String,
        val policyId: Long?,
        val checkedOutAt: String,
    )

    private var checkout: CheckoutFreeze? = null

    /**
     * Freezes the checkout policy and time for this attempt, once.
     *
     * Returns the existing freeze when [saleKey] has not rotated — the retry
     * case — and mints a new one against the current cached policy otherwise. A
     * null policy id is the legacy spelling and is preserved as-is, so the
     * server maps it to the immutable legacy policy rather than today's current.
     */
    private fun freezeCheckout(): CheckoutFreeze {
        checkout?.takeIf { it.saleKey == saleKey }?.let { return it }
        return CheckoutFreeze(
            saleKey = saleKey,
            policyId = _state.value.shop?.vatPolicyId,
            checkedOutAt = nowIso(),
        ).also { checkout = it }
    }

    /**
     * Pulls the current VAT policy and folds it into the running state.
     *
     * Called before trading and immediately before a checkout freezes, so the
     * basket shows — and the sale stamps — the policy the shop has right now. On
     * a failure the last cached policy stays in force, which is what lets an
     * offline till still freeze a checkout against a known immutable id. Returns
     * whether a fresh policy was applied.
     */
    private suspend fun refreshVatPolicy(): Boolean {
        val fresh = repo.bootstrap().getOrNull() ?: return false
        _state.update { applyBootstrapPolicy(it, fresh).copy(deviceId = fresh.deviceId ?: it.deviceId) }
        checkForUpdate(fresh)
        return true
    }

    /**
     * Starts (or continues) downloading a published update and folds its
     * progress into state.
     *
     * Called from every function that receives a fresh [Bootstrap] —
     * [refreshVatPolicy] (the heartbeat, every two minutes) and
     * [refreshRoster] (the heartbeat's slower cadence, and a manual
     * [reconnect] tap) — rather than one designated caller, so a future third
     * source of a fresh bootstrap does not silently skip the update check.
     * [mu.kidscorner.till.data.AppUpdater.start] no-ops on a version already
     * in flight, so calling this from more than one place costs nothing.
     */
    private fun checkForUpdate(fresh: Bootstrap) {
        val versionCode = fresh.latestVersionCode
        val apkUrl = fresh.apkUrl
        if (fresh.updateAvailable && versionCode != null && apkUrl != null) {
            appUpdater.start(versionCode, apkUrl)
        }
        _state.update { it.copy(updateDownload = appUpdater.poll()) }
    }

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
            var beats = 0
            // The alternative is a queue that only moves when the cashier
            // happens to ring something up. A till can sit idle for an hour
            // with a customer's sale unsent, and the shop would not know.
            while (isActive) {
                delay(QUEUE_HEARTBEAT_MS)
                drainQueue()
                noticeRemoteClose()
                // The VAT policy is refreshed every beat — two minutes, not the
                // twenty of a roster re-pull — so a toggle in the back office
                // reaches the basket promptly. The roster changes far less often
                // and keeps its slower cadence.
                if (_state.value.online) refreshVatPolicy()
                if (++beats % ROSTER_EVERY_BEATS == 0) refreshRoster()
            }
        }
    }

    /**
     * Go and look for the shop now, because somebody at the till asked.
     *
     * The heartbeat gets there on its own, but on its own schedule: up to two
     * minutes to notice the line at all and up to twenty to re-pull the
     * roster. That is fine for a till nobody is standing at, and no use
     * whatever to a cashier watching a queue build while the one name on
     * screen is greyed out. This is the same work, on demand.
     *
     * Deliberately not `loadShop()`: that one is the cold start and can send
     * the till back to the device-setup screen when credentials are dead.
     * Pressing "Try again" on a lock screen should find the shop or change
     * nothing — it should never sign the till out from under a cashier.
     */
    fun reconnect() = viewModelScope.launch {
        if (_state.value.reconnecting) return@launch
        _state.update { it.copy(reconnecting = true, error = null) }
        refreshRoster()
        // Whatever came back, the catalogue is worth having too — a till that
        // has just found the shop should not still be selling this morning's
        // prices, or pointing at last week's shelf, off a cache. The reconnecting
        // flag stays up across both so the pill reads "Syncing…" for the whole
        // pull, not just the roster half.
        if (_state.value.online) refreshCatalog()
        _state.update { it.copy(reconnecting = false) }
    }

    /**
     * Fires the system install prompt for a downloaded update, or — the
     * first time on a given device — the one-time "allow installs from this
     * app" settings screen instead.
     *
     * Callers are expected to have already confirmed with the cashier (the
     * "Update to vX?" dialog) and checked the basket is empty; this function
     * does not re-check either, so it can also serve a Settings-screen
     * "Install now" button where there is no basket to be mid-sale in.
     * `FLAG_ACTIVITY_NEW_TASK` on both intents (built in [AppUpdater]) is what
     * makes starting them from an application, not an activity, context safe.
     */
    fun installUpdate() {
        val ready = _state.value.updateDownload as? DownloadState.Ready ?: return
        val app = getApplication<Application>()
        val intent = if (appUpdater.canInstall()) {
            appUpdater.installIntent(ready.apkUri)
        } else {
            appUpdater.requestInstallPermissionIntent()
        }
        app.startActivity(intent)
    }

    /**
     * Re-pull the roster, so the offline gate does not go stale on its feet.
     *
     * Without this the roster was fetched exactly once, at app start, and a
     * till in a shop that never restarts it would go on admitting somebody
     * offline weeks after an owner cleared their PIN. Revocation that only
     * takes effect when a tablet happens to be rebooted is not revocation.
     *
     * Quiet: no spinner, no error. Nothing here is anything a cashier asked
     * for, and a failure just means the roster stays as it was, which is the
     * correct outcome anyway.
     */
    private suspend fun refreshRoster() {
        repo.bootstrap().onSuccess { fresh ->
            _state.update {
                it.copy(
                    // The SHIFT is deliberately not taken from this answer.
                    // `getOpenShift` is scoped to the shop rather than to this
                    // device, so in a two-till shop it returns whichever
                    // drawer was opened last — and adopting it here would move
                    // a cashier's live basket onto the other till's shift
                    // between one sale and the next. Which shift this till is
                    // on is `noticeRemoteClose`'s business, and only its.
                    shop = fresh.copy(shift = it.shop?.shift),
                    deviceId = fresh.deviceId ?: it.deviceId,
                )
            }
            checkForUpdate(fresh)
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
                // A finished account is as dead as a dead refresh token: an
                // owner switched this person off in the back office, and no
                // amount of staying on the sell screen will let them complete
                // a sale. Before this, the 403 arrived as a generic error and
                // the cashier kept scanning into a basket that could never be
                // paid for.
                val expired =
                    cause is UnauthorizedException || cause is SessionEndedException
                if (expired) repo.signOut()

                /**
                 * The last bootstrap the server served, when there is no new
                 * one to be had.
                 *
                 * This is what makes an outage survivable across a restart.
                 * Without it the keypad had no names to draw — bootstrap is the
                 * only thing that fetches the roster — so a tablet that
                 * rebooted mid-outage came up unable to admit anybody, holding
                 * a sale queue nothing could be added to.
                 *
                 * Not used when the credentials are what died: a cached roster
                 * would let somebody in to sell under a session that no longer
                 * exists, and every sale they rang would be refused on replay.
                 */
                val remembered = if (expired) null else repo.cachedShop()

                // Otherwise stay put: a shop whose line has dropped should see
                // "could not reach the till server" over the keypad, not be
                // thrown back to a password prompt it cannot answer without the
                // owner.
                _state.update {
                    val shop = it.shop ?: remembered
                    it.copy(
                        busy = false,
                        shop = shop,
                        deviceId = it.deviceId ?: shop?.deviceId,
                        // A till that can still work does not wear an error.
                        // The keypad says the connection is down and that
                        // sales will send later, which is the whole truth; a
                        // red panel over the top of it says something worse
                        // and is what teaches a shop to ignore red. The
                        // message is kept for the case where there is nothing
                        // cached and the screen genuinely cannot proceed.
                        error = if (shop != null) {
                            null
                        } else {
                            cause.message ?: "Could not reach the till server."
                        },
                        screen = when {
                            expired -> TillScreen.DeviceSetup
                            shop == null && !repo.isSignedIn -> TillScreen.DeviceSetup
                            shop == null -> TillScreen.Locked
                            // A remembered shop is enough to unlock and sell
                            // into the queue, so the keypad is where to be.
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

    // ---------------------------------------------------------- stock check

    fun openStockCheck() {
        val cashier = cashierOf(_state.value.screen) ?: return
        _state.update {
            it.copy(
                screen = TillScreen.StockCheck(cashier),
                stockCheck = StockCheckUiState(),
            )
        }
    }

    /**
     * Loads only live location balances. The catalogue and active basket stay
     * exactly where they are, so Back returns to the sale in progress.
     */
    fun selectStockProduct(productId: Int) = viewModelScope.launch {
        if (productId <= 0) return@launch
        _state.update {
            it.copy(
                stockCheck = it.stockCheck.copy(
                    productId = productId,
                    locations = if (it.stockCheck.productId == productId) {
                        it.stockCheck.locations
                    } else {
                        emptyList()
                    },
                    loading = true,
                    error = null,
                ),
            )
        }

        repo.stockCheck(productId)
            .onSuccess { response ->
                _state.update {
                    // A second selection may have started while this request
                    // was in flight. Its answer must not replace the new one.
                    if (it.stockCheck.productId != productId) {
                        it
                    } else {
                        it.copy(
                            stockCheck = it.stockCheck.copy(
                                locations = response.locations,
                                loading = false,
                                error = null,
                            ),
                        )
                    }
                }
            }
            .onFailure { cause ->
                _state.update {
                    if (it.stockCheck.productId != productId) {
                        it
                    } else {
                        it.copy(
                            stockCheck = it.stockCheck.copy(
                                loading = false,
                                error = if (cause.message.isNetworkish()) {
                                    "Could not reach the shop. Check the connection and try again."
                                } else {
                                    cause.message ?: "Live stock could not be loaded. Try again."
                                },
                            ),
                        )
                    }
                }
            }
    }

    fun retryStockCheck() {
        _state.value.stockCheck.productId?.let(::selectStockProduct)
    }

    fun closeStockCheck() {
        val screen = _state.value.screen as? TillScreen.StockCheck ?: return
        _state.update {
            it.copy(
                screen = TillScreen.Selling(screen.cashier),
                stockCheck = StockCheckUiState(),
            )
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
                    it.copy(
                        busy = false,
                        /*
                         * "Failed to connect to /10.0.2.2:3001" is what the
                         * transport says and it is no use to anybody holding a
                         * cash bag. When the line is what failed, say what
                         * happened and what to do instead of naming a socket.
                         *
                         * Read AFTER the call, not before: `online` is set by
                         * whether calls actually succeed, so this attempt is
                         * the freshest evidence there is.
                         */
                        error = if (it.online) {
                            cause.message ?: "Could not open the till."
                        } else {
                            "No connection, so the till can't be opened yet. " +
                                "Try again when the line is back — the float you " +
                                "counted is still here."
                        },
                    )
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

    /**
     * Money received against a customer's account.
     *
     * Online only, and never queued. A sale can be parked because the till
     * already knows everything about it — replaying it later records history.
     * A payment on account is accepted or refused against a balance only the
     * server knows, so a queued one could double-charge after the debt was
     * settled elsewhere, or fail because it already has been. The refusal the
     * server writes — "they only owe Rs 350" — is shown word for word.
     */
    fun settleCredit(customerId: Int, amount: Double, method: String) = viewModelScope.launch {
        val current = _state.value
        val shiftId = current.shop?.shift?.id
        if (method == "cash" && shiftId == null) {
            _state.update {
                it.copy(creditPaymentError = "Open the till before taking cash.")
            }
            return@launch
        }

        // Captured before the payment lands, for the printed slip: who is paying,
        // what they owed going in, and who took it. The new balance comes back on
        // the response.
        val payingRow = current.customerResults.find { it.id == customerId }
        val customerName =
            payingRow?.fullName ?: current.customer?.fullName ?: "Customer"
        val previousBalance =
            payingRow?.creditBalance ?: current.customer?.creditBalance ?: 0.0
        val cashierName = cashierOf(current.screen)?.fullName

        _state.update { it.copy(creditPaymentBusy = true, creditPaymentError = null) }

        repo.settleCredit(
            SettleCreditRequest(
                customerId = customerId,
                amount = round2(amount),
                method = method,
                shiftId = if (method == "cash") shiftId else null,
                reason = null,
            ),
        )
            .onSuccess { response ->
                _state.update {
                    if (response.ok) {
                        // The balance on any screen that shows one has moved.
                        it.copy(
                            creditPaymentBusy = false,
                            creditPaymentDone = true,
                            customer = it.customer?.takeIf { c -> c.id == customerId }
                                ?.copy(creditBalance = response.balance),
                            customerResults = it.customerResults.map { row ->
                                if (row.id == customerId) row.copy(creditBalance = response.balance)
                                else row
                            },
                        )
                    } else {
                        it.copy(
                            creditPaymentBusy = false,
                            creditPaymentError = response.error ?: "Could not record that payment.",
                        )
                    }
                }
                // The customer's own record of what they handed over — printed
                // after the money is in, never before. A print failure is a
                // toast, not an error over a payment that has already landed.
                if (response.ok) {
                    printAccountPaymentSlip(
                        customerName = customerName,
                        method = method,
                        amount = round2(amount),
                        previousBalance = previousBalance,
                        newBalance = response.balance,
                        cashierName = cashierName,
                    )
                }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(
                        creditPaymentBusy = false,
                        creditPaymentError = cause.message ?: "Could not record that payment.",
                    )
                }
            }
    }

    fun clearCreditPaymentResult() =
        _state.update {
            it.copy(
                creditPaymentDone = false,
                creditPaymentError = null,
                creditCharges = emptyList(),
                creditChargesLoading = false,
            )
        }

    /**
     * Loads the sales behind a customer's tab, for the account-payment view.
     *
     * Read-only and best-effort: the payment does not depend on it, so a failure
     * leaves the list empty and the cashier can still take the money against the
     * balance the search already showed. The server applies payments oldest-first
     * under a lock regardless of what this list says.
     */
    fun loadCreditStatement(customerId: Int) = viewModelScope.launch {
        _state.update { it.copy(creditChargesLoading = true, creditCharges = emptyList()) }
        val charges = repo.creditStatement(customerId).getOrNull()
            ?.takeIf { it.ok }?.charges
            ?: emptyList()
        _state.update { it.copy(creditChargesLoading = false, creditCharges = charges) }
    }

    /**
     * Prints the slip that follows a payment on account.
     *
     * A payment is not a sale, so this carries no VAT and no sale number — it is
     * the customer's record that money was received and what is left to pay.
     * Same best-effort print as the credit note: a failure is a toast, because
     * the payment is already recorded and the figure is on the shop's ledger.
     */
    private fun printAccountPaymentSlip(
        customerName: String,
        method: String,
        amount: Double,
        previousBalance: Double,
        newBalance: Double,
        cashierName: String?,
    ) = viewModelScope.launch {
        val shop = _state.value.shop
        val lines = buildAccountPaymentSlip(
            doc = AccountPaymentSlipDoc(
                customerName = customerName,
                dateIso = nowIso(),
                method = method,
                amount = amount,
                previousBalance = previousBalance,
                newBalance = newBalance,
                cashierName = cashierName,
            ),
            shop = ShopIdentity(
                name = shop?.shopName ?: "Kids Corner",
                address = shop?.shopAddress,
                phone = shop?.shopPhone,
            ),
            width = printerSettings.paper,
        )

        val result = printerSettings
            .transport(getApplication())
            .send(EscPos.encode(lines, printerSettings.paper))

        if (result is PrintResult.Failed) {
            toast("Payment slip did not print — the payment is still recorded")
        }
    }

    /** Clears the shared customer search list, for whoever opened it last. */
    fun clearCustomerSearch() =
        _state.update { it.copy(customerResults = emptyList(), customerError = null) }

    /**
     * Has the back office closed this till out from under us?
     *
     * "Close till" in Point of sale ends the shift on the server. The tablet
     * read its shift once, at bootstrap, and never again — so it went on
     * showing "Shift open" and went on selling, and every one of those sales
     * landed in the closed shift as a late sale. `late_sales` caught them,
     * which is migration 015 working as designed, but an owner who pressed a
     * button called Close till had no way to tell it had not reached the till.
     *
     * The queue heartbeat is already awake every two minutes and already
     * talking to the server, so this costs one extra call on a till that is
     * usually idle.
     *
     * It changes the chrome and nothing else. It does NOT interrupt a payment:
     * migration 015's own reasoning is that refusing a sale is worse than
     * recording a late one, because by then the shop has the customer's money.
     * The cashier finishes what they are holding and sees the till is closed.
     */
    private suspend fun noticeRemoteClose() {
        _state.value.shop?.shift ?: return
        val server = repo.shift().getOrNull() ?: return

        // NO open shift at all, and nothing finer. Comparing ids would be the
        // obvious test and it is wrong: getOpenShift is scoped to the SHOP, not
        // to this device — it returns the most recently opened shift in the
        // building. With two tills running, each would see the other's id, and
        // this would close a perfectly live till every two minutes.
        //
        // The cost is that a shop with two tills open will not notice one of
        // them being closed remotely, because the server still reports an open
        // shift. Partial and always right beats complete and sometimes wrong.
        // `shifts.device_id` exists, so scoping the query is the real fix —
        // it is shared with the web till, which has no device, so it is a
        // wider change than this.
        if (server.shift == null) {
            _state.update { it.copy(shop = it.shop?.copy(shift = null), shiftTotals = null) }
        }
    }

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

        postRefund(
            RefundRequest(
                saleId = sale.id,
                shiftId = _state.value.shop?.shift?.id,
                reason = reason,
                refundMethod = method,
                restock = restock,
                items = items,
            ),
        )
    }

    /**
     * Resubmits a refused return with a manager's PIN.
     *
     * The request is replayed exactly as it was, so what the manager authorises
     * is what the cashier filled in — rebuilding it from the screen would let
     * the two drift apart between the refusal and the approval.
     */
    fun retryRefund(approval: Approval) {
        val pending = _state.value.pendingRefund ?: return
        _state.update { it.copy(needsApproval = false) }
        viewModelScope.launch { postRefund(pending.copy(approval = approval)) }
    }

    fun clearPendingRefund() =
        _state.update { it.copy(pendingRefund = null, needsApproval = false) }

    private suspend fun postRefund(request: RefundRequest) {
        _state.update { it.copy(busy = true, historyError = null) }
        // Captured before the success branch clears selectedSale, so the printed
        // credit note can name the sale it reverses and its cashier.
        val returnedSale = _state.value.selectedSale
        repo.refund(request)
            .onSuccess { response ->
                val cashier = cashierOf(_state.value.screen)
                val went = response.ok && cashier != null
                _state.update {
                    if (response.needsApproval) {
                        // Held, not discarded: the prompt resubmits this exact
                        // request once a manager has typed their PIN. The PIN
                        // itself is never kept — only the return it authorises.
                        it.copy(
                            busy = false,
                            pendingRefund = request.copy(approval = null),
                            needsApproval = true,
                            historyError = response.error,
                        )
                    } else if (!went || cashier == null) {
                        it.copy(
                            busy = false,
                            pendingRefund = null,
                            historyError = response.error ?: "The return did not go through.",
                        )
                    } else {
                        it.copy(
                            busy = false,
                            screen = TillScreen.Selling(cashier),
                            selectedSale = null,
                            history = emptyList(),
                            refundDone = response,
                            pendingRefund = null,
                            needsApproval = false,
                        )
                    }
                }
                // AFTER the update, never inside it. `MutableStateFlow.update`
                // is a compare-and-set retry loop: its lambda can run more than
                // once, and `toast` writes to the same flow — so from in there
                // it fired twice and the outer copy, built from the state as it
                // was before, threw the message away again.
                if (went && !response.needsApproval) {
                    toast("Refunded ${formatRs(response.total)}")
                    printCreditNote(response, returnedSale)
                }
            }
            .onFailure { cause ->
                _state.update {
                    it.copy(
                        busy = false,
                        pendingRefund = null,
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
    fun printReceipt(
        saleId: Int,
        gift: Boolean = false,
        /** The automatic print that follows a sale, not a cashier asking. */
        auto: Boolean = false,
    ) = viewModelScope.launch {
        _state.update { it.copy(printing = true, historyError = null) }
        toast(
            when {
                gift -> "Gift receipt printing · prices hidden"
                auto -> "Printing receipt"
                else -> "Reprinting receipt"
            },
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
                historyError = when {
                    result is PrintResult.Sent -> null
                    // The sale is done and the money is in the drawer. A
                    // printer that would not take it is worth a toast, not an
                    // error banner over a completed sale — and Reprint is
                    // right there once the paper is back in.
                    auto -> {
                        toast("Receipt did not print — tap Reprint when the printer is ready")
                        null
                    }
                    else -> {
                        val failed = result as PrintResult.Failed
                        "${failed.reason} The reprint has still been recorded — " +
                            "this receipt now counts as printed ${recorded.printCount ?: 1} times."
                    }
                },
            )
        }
    }

    /**
     * Prints the credit note that follows a successful refund.
     *
     * The document reads from the refund's OWN frozen VAT snapshot — a VAT
     * credit note or a plain one, exactly as the source sale was — never today's
     * setting. Guarded by [printedCreditNotes] so a resubmit or a recomposition
     * cannot print the same claim on the drawer twice. A print failure is a
     * toast, not an error: the refund is committed and the note is on the shop's
     * records, and it can be reprinted from the back office.
     */
    private fun printCreditNote(refund: RefundResponse, sale: SaleDetail?) {
        val creditNo = refund.creditNo
        if (creditNo.isBlank() || !printedCreditNotes.add(creditNo)) return

        viewModelScope.launch {
            val shop = _state.value.shop
            val lines = buildCreditNote(
                doc = CreditNoteDoc(
                    creditNo = creditNo,
                    saleNo = sale?.saleNo,
                    dateIso = nowIso(),
                    refundMethod = refund.refundMethod,
                    total = refund.total,
                    vatEnabled = refund.vatEnabled,
                    vatRate = refund.vatRate,
                    vatNumber = refund.vatNumber,
                    vatAmount = refund.vatAmount,
                    cashierName = sale?.cashierName,
                ),
                shop = ShopIdentity(
                    name = shop?.shopName ?: "Kids Corner",
                    address = shop?.shopAddress,
                    phone = shop?.shopPhone,
                ),
                width = printerSettings.paper,
            )

            val result = printerSettings
                .transport(getApplication())
                .send(EscPos.encode(lines, printerSettings.paper))

            if (result is PrintResult.Failed) {
                toast("Credit note did not print — reprint it from the back office")
            }
        }
    }

    /** ISO-8601 instant for a document printed now, sliced by readableDate. */
    private fun nowIso(): String = java.time.Instant.now().toString()

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
        is TillScreen.StockCheck -> screen.cashier
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
                        // Not asked when the tablet just admitted this person
                        // itself: the line is down, so the round trip can only
                        // end in a timeout, and it would spend it with a
                        // customer standing there.
                        ?: if (result.offline) null else repo.shift().getOrNull()?.shift

                    // A cashier taking the till online should trade on the
                    // current policy, so refresh it before entering Selling or
                    // Opening. Skipped offline, where there is nothing to fetch.
                    if (!result.offline) refreshVatPolicy()

                    _state.update {
                        it.copy(
                            busy = false,
                            // Says the till is running on its own, over the
                            // keypad and then in the chrome. Cleared on an
                            // online sign-in, so it never lingers past the
                            // outage that caused it.
                            error = null,
                            lockedFor = 0,
                            shop = if (open != null) it.shop?.copy(shift = open) else it.shop,
                            // The verifier stays in the roster; screen state is
                            // read by every composable and holds no secrets.
                            screen = if (open != null) {
                                TillScreen.Selling(result.cashier.withoutSecret())
                            } else {
                                TillScreen.OpeningShift(result.cashier.withoutSecret())
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

    /**
     * Hand the tablet back — sign the device out and forget the shop.
     *
     * Refuses while the queue still holds sales. Signing out destroys the
     * session those sales replay under and clears the roster that lets anybody
     * back in, so this would turn takings the shop has already collected into
     * rows nothing can ever send. The till has to drain first, which needs the
     * line back — and if the line is back, draining takes seconds.
     */
    fun forgetDevice() = viewModelScope.launch {
        val held = repo.queuedCount()
        if (held > 0) {
            _state.update {
                it.copy(
                    error = "$held sale${if (held == 1) "" else "s"} still waiting to be sent. " +
                        "Send them before signing this till out, or they are lost.",
                )
            }
            return@launch
        }

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
            // The effective rate: zero while the shop is not VAT registered, so a
            // disabled basket contains no VAT while the payable total is unchanged.
            vatRate = state.shop?.resolvedVatRate ?: 0.15,
        )

    /** Recomputes totals after anything that can change them. */
    private fun retotal(state: TillState): TillState =
        state.copy(totals = totalsFor(state.lines, state))

    fun addVariant(variant: CatalogVariant) = mutateCart { it.withVariant(variant) }

    /**
     * The same, but the line arrived from a barcode rather than a tap.
     *
     * Separate so "Beep on scan" can mean scan. A cashier tapping a tile is
     * looking at the screen and does not need telling; a cashier running a
     * scanner over a pile of clothes is looking at the clothes, and the beep
     * is the only confirmation they get. That switch was read by nothing
     * until now, so the till has been silent whatever it was set to.
     */
    fun addScanned(variant: CatalogVariant) {
        if (printerSettings.beepOnScan) beep()
        addVariant(variant)
    }

    /**
     * A short confirmation tone.
     *
     * ToneGenerator on STREAM_SYSTEM rather than a bundled sound file: it is
     * on the alarm-ish stream a shop leaves audible, it needs no asset, and
     * it survives the phone being on vibrate the way a media-stream sound
     * would not. Failures are swallowed — some devices refuse to allocate a
     * generator, and no beep is a far smaller problem than a crash mid-sale.
     */
    private fun beep() {
        try {
            ToneGenerator(AudioManager.STREAM_SYSTEM, 80).apply {
                startTone(ToneGenerator.TONE_PROP_BEEP, 120)
                // The generator holds an audio track; released on its own
                // thread after the tone has had time to play.
                viewModelScope.launch {
                    delay(300)
                    release()
                }
            }
        } catch (_: RuntimeException) {
        }
    }

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
     * Throw the drawer open.
     *
     * Fired when a cashier picks Cash, not when the sale completes: they need
     * it open to take the notes and count the change BEFORE confirming, which
     * is the order the counter actually works in. A drawer opened for a sale
     * that then goes on a card is a drawer that closes again unused, which
     * costs nothing.
     *
     * Failures are swallowed. A shop with no drawer wired to the printer must
     * not get an error every time it takes cash.
     */
    fun openCashDrawer() = viewModelScope.launch {
        runCatching {
            printerSettings.transport(getApplication()).send(EscPos.openDrawer())
        }
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

    fun createCustomer(name: String, phone: String?, openAccount: Boolean = false) =
        viewModelScope.launch {
            submitCustomerCreate(CreateCustomerRequest(name, phone, openAccount))
        }

    private suspend fun submitCustomerCreate(request: CreateCustomerRequest) {
        _state.update { it.copy(customerSearching = true, customerError = null) }
        repo.createCustomer(request)
            .onSuccess { response ->
                if (response.ok && response.customer != null) {
                    _state.update {
                        it.copy(
                            customerSearching = false,
                            customer = response.customer,
                            customerResults = emptyList(),
                            customerError = null,
                            pendingCustomerCreate = null,
                        )
                    }
                } else if (response.needsApproval) {
                    // Held, not discarded: the prompt resubmits this exact name
                    // and phone once a manager has typed their PIN, the same
                    // way a refused refund is retried.
                    _state.update {
                        it.copy(
                            customerSearching = false,
                            pendingCustomerCreate = request.copy(approval = null),
                            needsApproval = true,
                            customerError = response.error,
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

    /**
     * Resubmits a customer creation that was refused pending a manager's PIN.
     *
     * Replayed exactly as it was typed, same as [retryRefund] — rebuilding it
     * from the screen would let what the manager authorises drift from what the
     * cashier actually filled in.
     */
    fun retryCustomerCreate(approval: Approval) {
        val pending = _state.value.pendingCustomerCreate ?: return
        _state.update { it.copy(needsApproval = false) }
        viewModelScope.launch { submitCustomerCreate(pending.copy(approval = approval)) }
    }

    fun clearPendingCustomerCreate() =
        _state.update { it.copy(pendingCustomerCreate = null, needsApproval = false) }

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
     * Bills the whole basket to the attached customer's account.
     *
     * The screen's ON ACCOUNT tile asks for this, and the whole balance is the
     * only amount it ever bills: a deposit plus the rest on account is a split
     * tender, and the split flow deliberately does not offer credit — every
     * method in that list is unconditional, which credit is not. The gate stays
     * in the one place a customer's account is actually known.
     *
     * The server re-checks everything that matters — the customer, the account,
     * the hold and the limit, under a lock. This builds the tender; it does not
     * decide whether the tender is legal.
     */
    fun chargeToAccount() {
        val current = _state.value
        val outstanding = round2(maxOf(0.0, current.totals.total))
        if (outstanding <= 0) return
        confirmSale(
            payments = listOf(SalePayment(method = "credit", amount = outstanding, tendered = null)),
            change = 0.0,
        )
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

        // Refresh the policy so the sale stamps — and the basket showed — what
        // the shop's registration is right now, then freeze it once. Online
        // only; offline, the last cached policy stands and is frozen as-is. The
        // freeze is keyed to saleKey, so a retry reuses this exact policy id and
        // checkout time rather than re-reading a policy that may have moved.
        if (_state.value.online) refreshVatPolicy()
        val checkout = freezeCheckout()

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
            vatPolicyId = checkout.policyId,
            checkedOutAt = checkout.checkedOutAt,
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
                                    "myt_money" -> "my.t money"; "bank" -> "Bank"
                                    "credit" -> "On account"; else -> m
                                }
                            },
                    )
                    // A finished sale is the only thing that retires the key. A
                    // fresh basket must never reuse it, or the server would
                    // replay this sale instead of ringing up the next one.
                    saleKey = UUID.randomUUID().toString()

                    // "Print receipt automatically" — the switch has existed
                    // on the settings screen since it was built and nothing
                    // read it, so a till set to print automatically printed
                    // nothing until somebody tapped Print.
                    //
                    // Only for a sale that reached the server: printReceipt
                    // needs the sale number to fetch and to record the print
                    // against, and a queued sale has neither yet. Those still
                    // print from Past sales once the queue drains.
                    val printedId = result.saleId
                    if (printedId != null && printerSettings.autoPrint) {
                        printReceipt(printedId)
                    }
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
                    /*
                     * The receipt prints itself.
                     *
                     * A receipt is not an optional extra a cashier remembers
                     * to ask for — a VAT-registered shop owes one on every
                     * sale, and the tap was one more thing to forget with a
                     * customer waiting. The button on the done screen is a
                     * REPRINT now, for the times the paper jams or the
                     * customer wants a second copy.
                     *
                     * Only for a sale that actually landed: a parked one has
                     * no number yet, and a receipt with no number is not a
                     * receipt. Failures are already swallowed inside — a shop
                     * with no printer must still be able to sell.
                     */
                    outcome.saleId?.let { printReceipt(it, auto = true) }

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

    /**
     * Clears the slip with the sale.
     *
     * Without this the preview outlived the done screen and reappeared as a
     * dialog over the sell screen — the next customer's basket obscured by the
     * last one's receipt.
     */
    fun dismissOutcome() = _state.update { it.copy(outcome = null, receiptPreview = null) }

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
         * Beats between roster re-pulls — ten, so about twenty minutes.
         *
         * Not every beat: bootstrap is six queries and the roster changes
         * about as often as somebody is hired. Twenty minutes is the longest a
         * cleared PIN goes on opening this till offline, which is short enough
         * to mean something and long enough to be free.
         */
        const val ROSTER_EVERY_BEATS = 10

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
