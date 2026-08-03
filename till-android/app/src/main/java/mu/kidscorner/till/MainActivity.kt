package mu.kidscorner.till

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import mu.kidscorner.till.data.Approval
import mu.kidscorner.till.print.hasBluetoothPermission
import mu.kidscorner.till.print.PrinterSettings
import mu.kidscorner.till.ui.ActionsDialog
import mu.kidscorner.till.ui.BasketDiscountDialog
import mu.kidscorner.till.ui.CloseShiftScreen
import mu.kidscorner.till.ui.CustomItemDialog
import mu.kidscorner.till.ui.CustomerDialog
import mu.kidscorner.till.ui.DeviceSetupScreen
import mu.kidscorner.till.ui.HeldSalesDialog
import mu.kidscorner.till.ui.LockScreen
import mu.kidscorner.till.ui.ManagerApprovalDialog
import mu.kidscorner.till.ui.MovementDialog
import mu.kidscorner.till.ui.OfflineScreen
import mu.kidscorner.till.ui.OpenShiftScreen
import mu.kidscorner.till.ui.PaymentScreen
import mu.kidscorner.till.ui.PrinterSettingsDialog
import mu.kidscorner.till.ui.ReceiptPreviewDialog
import mu.kidscorner.till.ui.RefundDoneDialog
import mu.kidscorner.till.ui.RefundScreen
import mu.kidscorner.till.ui.SaleCompleteScreen
import mu.kidscorner.till.ui.SaleNoteDialog
import mu.kidscorner.till.ui.SellScreen
import mu.kidscorner.till.ui.SettingsScreen
import mu.kidscorner.till.ui.StartingScreen
import mu.kidscorner.till.ui.ToastPill
import mu.kidscorner.till.ui.TodaysSalesDialog
import mu.kidscorner.till.ui.theme.KidsCornerTillTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // A till is a kiosk: the status and nav bars are surface area a customer
        // can press to leave the app mid-sale, so they stay hidden until a
        // deliberate swipe.
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }

        setContent {
            KidsCornerTillTheme {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        // Still padded despite the bars being hidden: they come
                        // back on a swipe, and a keypad that shifts under a
                        // finger mid-PIN is how a wrong digit gets entered.
                        .windowInsetsPadding(WindowInsets.safeDrawing),
                ) {
                    TillRoot()
                }
            }
        }
    }
}

/** Which overlay is up, if any. One at a time — a till is not a desktop. */
private enum class Overlay { None, Customer, Held, Discount, Approval, Movement, Printer, Actions, Note, Custom, Txns }

@Composable
private fun TillRoot(vm: TillViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var overlay by remember { mutableStateOf(Overlay.None) }
    val context = LocalContext.current

    /**
     * Both Bluetooth permissions in one prompt.
     *
     * The result is ignored on purpose: `BluetoothPrinter` re-checks before
     * every job and returns a message the cashier can act on. Reacting here
     * too would mean two places deciding what a denied permission means, and
     * the one that matters is the one holding the socket.
     */
    val bluetoothPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { }

    // Stripped: this list is passed into the approval prompt and held in
    // composition, and a manager's offline verifier has no business there.
    val managers = state.shop?.cashiers.orEmpty()
        .filter { it.role == "owner" || it.role == "manager" }
        .map { it.withoutSecret() }

    Box(
        Modifier
            .fillMaxSize()
            // Every touch anywhere resets the idle clock.
            //
            // Observed on the Initial pass so it is seen before a child
            // consumes it — a tap on a keypad key is exactly the activity that
            // should count, and by the Main pass the button has eaten it.
            // Nothing is consumed here, so this cannot interfere with anything.
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        awaitPointerEvent(PointerEventPass.Initial)
                        vm.noteActivity()
                    }
                }
            },
    ) {
        when (val screen = state.screen) {
            TillScreen.Starting -> StartingScreen()

            TillScreen.DeviceSetup -> DeviceSetupScreen(
                busy = state.busy,
                error = state.error,
                onSignIn = vm::signIn,
            )

            TillScreen.Locked -> {
                val shop = state.shop
                if (shop == null) {
                    // Signed in, but the shop's details never arrived. Retry,
                    // never sign out — see OfflineScreen.
                    OfflineScreen(
                        message = state.error ?: "Checking…",
                        busy = state.busy,
                        onRetry = { vm.loadShop() },
                    )
                } else {
                    LockScreen(
                        shopName = shop.shopName,
                        cashiers = shop.cashiers,
                        busy = state.busy,
                        error = state.error,
                        lockedFor = state.lockedFor,
                        offline = !state.online,
                        reconnecting = state.reconnecting,
                        onSubmit = vm::submitPin,
                        onErrorShown = vm::clearError,
                        onRetry = vm::reconnect,
                    )
                }
            }

            is TillScreen.OpeningShift -> OpenShiftScreen(
                shopName = state.shop?.shopName ?: "Kids Corner",
                cashierName = screen.cashier.fullName,
                busy = state.busy,
                error = state.error,
                offline = !state.online,
                onOpen = vm::openShift,
                onLock = vm::lock,
                onRetry = vm::reconnect,
            )

            is TillScreen.Selling -> {
                val shop = state.shop
                if (shop == null) {
                    OfflineScreen(
                        message = state.error ?: "Checking…",
                        busy = state.busy,
                        onRetry = { vm.loadShop() },
                    )
                } else {
                    SellScreen(
                        catalog = state.catalog,
                        lines = state.lines,
                        totals = state.totals,
                        cashier = screen.cashier,
                        shopName = shop.shopName,
                        tillOpen = shop.shift != null,
                        catalogLoading = state.catalogLoading,
                        online = state.online,
                        vatRate = shop.vatRate,
                        onSwitchCashier = vm::switchCashier,
                        customer = state.customer,
                        discount = state.discount,
                        heldCount = state.held.size,
                        queuedCount = state.queuedCount,
                        onAdd = vm::addVariant,
                        onAddScanned = vm::addScanned,
                        onSetQty = vm::setQty,
                        onSetLineDiscount = vm::setLineDiscount,
                        onOpenActions = { overlay = Overlay.Actions },
                        onOpenCustomItem = { overlay = Overlay.Custom },
                        onOpenNote = { overlay = Overlay.Note },
                        onSetNote = vm::setNote,
                        note = state.note,
                        onRemove = vm::removeLine,
                        onClear = vm::clearCart,
                        onFindBarcode = vm::findByBarcode,
                        onPay = vm::startPayment,
                        onLock = vm::lock,
                        onHold = vm::holdSale,
                        onOpenHeld = { overlay = Overlay.Held },
                        onOpenCustomer = { overlay = Overlay.Customer },
                        onDetachCustomer = { vm.attachCustomer(null) },
                        onOpenDiscount = { overlay = Overlay.Discount },
                        onRemoveDiscount = { vm.applyDiscount(null) },
                        onOpenTill = vm::startOpeningShift,
                        onCloseTill = vm::startClosingShift,
                        onOpenMovement = { overlay = Overlay.Movement },
                        onOpenHistory = { overlay = Overlay.Txns; vm.searchHistory("") },
                    )
                }
            }

            is TillScreen.Paying -> PaymentScreen(
                totals = state.totals,
                lines = state.lines,
                paymentMethods = state.shop?.paymentMethods ?: listOf("cash"),
                cashierName = screen.cashier.fullName,
                busy = state.busy,
                error = state.error,
                frozen = state.settleFrozen,
                parkable = state.settleParkable,
                // The ViewModel remembers the tender itself, so a retry or an
                // approval resubmit survives this screen being recreated.
                onConfirm = { payments, change -> vm.confirmSale(payments, change) },
                // The same payments as the attempt that froze, so the retry
                // carries the same idempotency key and replays rather than
                // ringing up a second sale.
                onRetry = { vm.retryFrozenSale() },
                onPark = vm::parkFrozenSale,
                onOpenDrawer = vm::openCashDrawer,
                onCancel = vm::cancelPayment,
            )

            is TillScreen.Settings -> SettingsScreen(
                printerConfigured = state.printerConfigured,
                printerLabel = state.printerDescribe,
                paper = state.paper,
                autoPrint = state.prefs["autoPrint"] == true,
                drawerOnCash = state.prefs["drawerOnCash"] == true,
                drawerOnCard = state.prefs["drawerOnCard"] == true,
                beepOnScan = state.prefs["beep"] == true,
                roundCash = state.prefs["roundCash"] == true,
                onBack = vm::closeSettings,
                onOpenPrinter = { overlay = Overlay.Printer },
                onTestPrint = vm::testPrinter,
                onSetPaper = vm::setPaper,
                onSetPref = vm::setPref,
            )

            is TillScreen.Refunding -> {
                val sale = state.selectedSale
                if (sale == null) {
                    LaunchedEffect(Unit) { vm.closeRefund() }
                } else {
                    RefundScreen(
                        sale = sale,
                        alreadyReturned = sale.lines.associate { it.id to it.returnedQty },
                paymentMethods = state.shop?.paymentMethods ?: listOf("cash"),
                        busy = state.busy,
                        error = state.historyError,
                        onBack = vm::closeRefund,
                        onRefund = vm::submitRefund,
                    )
                }
            }

            is TillScreen.ClosingShift -> CloseShiftScreen(
                totals = state.shiftTotals,
                summary = state.closeSummary,
                cashierName = screen.cashier.fullName,
                openedAt = state.shop?.shift?.openedAt,
                busy = state.busy,
                error = state.error,
                onClose = vm::closeShift,
                onCancel = vm::cancelClose,
                onFinish = vm::finishClose,
            )
        }

        ToastPill(state.toast)

        state.refundDone?.let { refund ->
            RefundDoneDialog(refund = refund, onDismiss = vm::dismissRefundDone)
        }

        // Only when there is no done screen to carry it — a reprint from
        // history, or the Z. During a sale the slip belongs ON the completion
        // screen, where the cashier and the customer are both already looking.
        if (state.outcome == null) state.receiptPreview?.let { preview ->
            ReceiptPreviewDialog(
                preview = preview,
                paper = vm.printer.paper,
                onDismiss = vm::dismissPreview,
            )
        }

        // `atComplete` takes the WHOLE screen in the handoff, not an overlay
        // panel — so it is drawn last inside the Box and covers everything.
        state.outcome?.let { outcome ->
            SaleCompleteScreen(
                saleNo = outcome.saleId?.let { "#$it" },
                total = outcome.total,
                change = outcome.change,
                itemCount = outcome.itemCount,
                methods = outcome.methods,
                queued = outcome.queued,
                receiptPreview = state.receiptPreview,
                onPrint = { outcome.saleId?.let(vm::printReceipt) },
                onPrintGift = { outcome.saleId?.let { vm.printReceipt(it, gift = true) } },
                onNewSale = vm::dismissOutcome,
            )
        }
    }

    // The server decides whether a manager is needed — the till only asks when
    // told to. Raised here rather than pre-empted on the device, because the
    // rule row is what settles it and only the server has read that.
    if (state.needsApproval && overlay != Overlay.Approval) overlay = Overlay.Approval

    when (overlay) {
        Overlay.None -> Unit

        Overlay.Customer -> CustomerDialog(
            results = state.customerResults,
            searching = state.customerSearching,
            error = state.customerError,
            onSearch = vm::searchCustomers,
            onPick = { vm.attachCustomer(it); overlay = Overlay.None },
            onCreate = { name, phone -> vm.createCustomer(name, phone) },
            onDismiss = { overlay = Overlay.None },
        )

        Overlay.Held -> HeldSalesDialog(
            held = state.held,
            cartBusy = state.lines.isNotEmpty(),
            onResume = { vm.resumeSale(it); overlay = Overlay.None },
            onDiscard = vm::discardHeld,
            onDismiss = { overlay = Overlay.None },
        )

        // v2 replaces v1's list of rule rows with a manual figure plus a
        // reason. The shop's live rules ride in as reason chips rather than
        // being stranded — see the dialog.
        Overlay.Discount -> BasketDiscountDialog(
            // The design's own base: "applies after line discounts".
            basket = state.totals.subtotal - state.totals.lineDiscounts,
            rules = state.discountRules,
            current = state.discount,
            onApply = { vm.applyDiscount(it); overlay = Overlay.None },
            onDismiss = { overlay = Overlay.None },
        )

        Overlay.Txns -> TodaysSalesDialog(
            sales = state.history,
            loading = state.historyLoading,
            onSearch = vm::searchHistory,
            onReprint = { vm.printReceipt(it) },
            onGiftReceipt = { vm.printReceipt(it, gift = true) },
            onReturn = { overlay = Overlay.None; vm.openRefund(it) },
            onDismiss = { overlay = Overlay.None },
        )

        Overlay.Printer -> PrinterSettingsDialog(
            settings = vm.printer,
            describe = state.printerDescribe,
            busy = state.printing,
            testResult = state.printerTestResult,
            onSave = { kind, address, name, paper ->
                vm.savePrinter(kind, address, name, paper)
                // Asked at the moment it is needed, not on first launch. A
                // permission prompt with no context is one people dismiss, and
                // a shop on a network printer never needs this at all.
                if (kind == PrinterSettings.Kind.Bluetooth && !hasBluetoothPermission(context)) {
                    bluetoothPermission.launch(
                        arrayOf(
                            Manifest.permission.BLUETOOTH_CONNECT,
                            Manifest.permission.BLUETOOTH_SCAN,
                        ),
                    )
                }
            },
            onTest = vm::testPrinter,
            onDismiss = {
                overlay = Overlay.None
                vm.clearPrinterTest()
            },
        )

        Overlay.Movement -> MovementDialog(
            busy = state.busy,
            error = state.movementError,
            done = state.movementDone,
            onRecord = vm::recordMovement,
            onDismiss = {
                overlay = Overlay.None
                vm.clearMovementResult()
            },
        )

        Overlay.Actions -> ActionsDialog(
            lastReceiptNo = state.history.firstOrNull()?.saleNo,
            onReprintLast = {
                overlay = Overlay.None
                state.history.firstOrNull()?.let { vm.printReceipt(it.id) }
            },
            onOpenHistory = { overlay = Overlay.Txns; vm.searchHistory("") },
            onOpenDrawer = { overlay = Overlay.None; vm.openCashDrawer() },
            onCustomItem = { overlay = Overlay.None },
            onSaleNote = { overlay = Overlay.Note },
            onSettings = { overlay = Overlay.None; vm.openSettings() },
            onDismiss = { overlay = Overlay.None },
        )

        Overlay.Custom -> CustomItemDialog(
            onAdd = { label, price ->
                vm.addCustomItem(label, price)
                overlay = Overlay.None
            },
            onDismiss = { overlay = Overlay.None },
        )

        Overlay.Note -> SaleNoteDialog(
            note = state.note,
            onSave = { vm.setNote(it); overlay = Overlay.None },
            onDismiss = { overlay = Overlay.None },
        )

        // One prompt, two things it can be authorising. `pendingRefund` is what
        // says which — without it a manager's PIN typed for a return would be
        // handed to `retryFrozenSale`, which would either do nothing or replay
        // a sale nobody asked it to.
        Overlay.Approval -> {
            val forRefund = state.pendingRefund != null
            ManagerApprovalDialog(
                managers = managers,
                reason = state.let { if (forRefund) it.historyError else it.error }
                    ?: if (forRefund) "This return needs an owner or manager."
                       else "This discount needs an owner or manager.",
                busy = state.busy,
                onApprove = { managerId, pin ->
                    overlay = Overlay.None
                    if (forRefund) {
                        vm.retryRefund(Approval(managerId, pin))
                    } else {
                        vm.clearApprovalPrompt()
                        vm.retryFrozenSale(Approval(managerId, pin))
                    }
                },
                onDismiss = {
                    overlay = Overlay.None
                    // Dropping the prompt drops the return with it. A refused
                    // refund that stayed pending would re-open this dialog the
                    // next time anything set `needsApproval`.
                    if (forRefund) vm.clearPendingRefund() else vm.clearApprovalPrompt()
                },
            )
        }
    }

    // Back closes whatever is open, then steps back from payment, and does
    // nothing on the sell screen. On a shop tablet the gesture is easy to
    // trigger by accident, and backing out of selling would drop the cashier to
    // the launcher mid-sale.
    BackHandler(enabled = overlay != Overlay.None) {
        overlay = Overlay.None
        vm.clearApprovalPrompt()
    }
    BackHandler(enabled = overlay == Overlay.None && state.screen is TillScreen.Paying) {
        vm.cancelPayment()
    }
    BackHandler(enabled = overlay == Overlay.None && state.screen is TillScreen.Refunding) {
        vm.closeRefund()
    }
    BackHandler(enabled = overlay == Overlay.None && state.screen is TillScreen.Settings) {
        vm.closeSettings()
    }
    BackHandler(enabled = overlay == Overlay.None && state.screen is TillScreen.Selling) {
        /* swallowed */
    }
}
