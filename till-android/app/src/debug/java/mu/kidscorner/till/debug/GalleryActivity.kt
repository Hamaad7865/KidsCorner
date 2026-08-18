package mu.kidscorner.till.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.AppliedDiscountLocal
import kotlin.math.absoluteValue
import mu.kidscorner.till.data.CartLine
import mu.kidscorner.till.data.Cashier
import mu.kidscorner.till.data.CloseShiftResponse
import mu.kidscorner.till.data.Customer
import mu.kidscorner.till.data.DiscountRule
import mu.kidscorner.till.data.HeldSale
import mu.kidscorner.till.data.ShiftTotals
import mu.kidscorner.till.data.CatalogVariant
import mu.kidscorner.till.data.cartTotals
import mu.kidscorner.till.data.withLineDiscount
import mu.kidscorner.till.data.withQty
import mu.kidscorner.till.data.withVariant
import mu.kidscorner.till.data.without
import mu.kidscorner.till.data.ReceiptPrint
import mu.kidscorner.till.data.SaleDetail
import mu.kidscorner.till.data.SaleDetailDiscount
import mu.kidscorner.till.data.SaleDetailLine
import mu.kidscorner.till.data.SaleDetailPayment
import mu.kidscorner.till.data.SaleSummary
import mu.kidscorner.till.data.StockCheckLocation
import mu.kidscorner.till.data.StockCheckQuantity
import mu.kidscorner.till.StockCheckUiState
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.ShopIdentity
import mu.kidscorner.till.print.toPlainText
import mu.kidscorner.till.print.buildReceipt
import mu.kidscorner.till.print.PrinterSettings
import mu.kidscorner.till.ui.ActionsDialog
import mu.kidscorner.till.ui.BasketDiscountDialog
import mu.kidscorner.till.ui.CloseShiftScreen
import mu.kidscorner.till.ui.DeviceSetupScreen
import mu.kidscorner.till.ui.RefundScreen
import mu.kidscorner.till.ui.LockScreen
import mu.kidscorner.till.ui.OfflineScreen
import mu.kidscorner.till.ui.PrinterSettingsDialog
import mu.kidscorner.till.ui.RefundScreen
import mu.kidscorner.till.ui.ReceiptPreviewDialog
import mu.kidscorner.till.ui.CustomItemDialog
import mu.kidscorner.till.ui.CustomerDialog
import mu.kidscorner.till.ui.HeldSalesDialog
import mu.kidscorner.till.ui.ManagerApprovalDialog
import mu.kidscorner.till.ui.MovementDialog
import mu.kidscorner.till.ui.OpenShiftScreen
import mu.kidscorner.till.ui.PaymentScreen
import mu.kidscorner.till.ui.SaleCompleteScreen
import mu.kidscorner.till.ui.SaleNoteDialog
import mu.kidscorner.till.ui.SellScreen
import mu.kidscorner.till.ui.SettingsScreen
import mu.kidscorner.till.ui.StockCheckScreen
import mu.kidscorner.till.ui.ToastPill
import mu.kidscorner.till.ui.TodaysSalesDialog
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.KidsCornerTillTheme

/**
 * Every handoff screen, on invented data, without a PIN.
 *
 * The real screens sit behind a login, an open shift and a completed sale, and
 * checking a layout against `Kids Corner POS.dc.html` should not mean ringing a
 * sale up against the live shop — nor should it mean guessing at someone's PIN
 * and tripping the lockout. Debug source set only; it is not in a release APK.
 *
 * ```
 * adb shell am start -n mu.kidscorner.till/.debug.GalleryActivity -e screen closeShift
 * ```
 *
 * With no `-e screen`, it lists what it can draw.
 */
class GalleryActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val requested = intent.getStringExtra("screen")

        setContent {
            KidsCornerTillTheme {
                var showing by remember { mutableStateOf(requested) }

                // Back returns to the index rather than leaving the app.
                //
                // Every screen here is drawn on invented data with no-op
                // handlers, so nothing on one responds to a tap — without this
                // a full-screen entry is a dead end you can only get out of by
                // force-stopping the app.
                BackHandler(enabled = showing != null) { showing = null }
                // Same inset padding MainActivity applies, so a screenshot
                // taken here shows the same top edge the real app does.
                Surface(
                    Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing),
                    color = Handoff.Canvas,
                ) {
                    Box(Modifier.fillMaxSize()) {
                    when (showing) {
                        "pin" -> LockScreen(
                            shopName = "Kids Corner · Curepipe",
                            cashiers = SAMPLE_STAFF,
                            busy = false,
                            error = null,
                            lockedFor = 0,
                            offline = false,
                            reconnecting = false,
                            onSubmit = { _, _ -> },
                            onErrorShown = {},
                            onRetry = {},
                        )

                        "pinError" -> LockScreen(
                            shopName = "Kids Corner · Curepipe",
                            cashiers = SAMPLE_STAFF,
                            busy = false,
                            error = "Wrong PIN.",
                            lockedFor = 0,
                            offline = false,
                            reconnecting = false,
                            onSubmit = { _, _ -> },
                            onErrorShown = {},
                            onRetry = {},
                        )

                        "pinChecking" -> LockScreen(
                            shopName = "Kids Corner · Curepipe",
                            cashiers = SAMPLE_STAFF,
                            busy = true,
                            error = null,
                            lockedFor = 0,
                            offline = false,
                            reconnecting = false,
                            onSubmit = { _, _ -> },
                            onErrorShown = {},
                            onRetry = {},
                        )

                        // The shop's line is down. Kevin greys out — he is the
                        // one this till holds no verifier for — and the reason
                        // sits under the tiles rather than waiting to be
                        // discovered at the keypad.
                        "pinOffline" -> LockScreen(
                            shopName = "Kids Corner · Curepipe",
                            cashiers = SAMPLE_STAFF,
                            busy = false,
                            error = null,
                            lockedFor = 0,
                            offline = true,
                            reconnecting = false,
                            onSubmit = { _, _ -> },
                            onErrorShown = {},
                            onRetry = {},
                        )

                        // A till that has never synced: nobody can be admitted
                        // until the line comes back once.
                        "pinOfflineCold" -> LockScreen(
                            shopName = "Kids Corner · Curepipe",
                            cashiers = SAMPLE_STAFF.map { it.copy(verifier = null) },
                            busy = false,
                            error = null,
                            lockedFor = 0,
                            offline = true,
                            reconnecting = false,
                            onSubmit = { _, _ -> },
                            onErrorShown = {},
                            onRetry = {},
                        )

                        "refund" -> RefundScreen(
                            sale = SAMPLE_DETAIL,
                            alreadyReturned = mapOf(2 to 1),
                            paymentMethods = listOf("cash", "card", "juice", "bank"),
                            busy = false,
                            error = null,
                            onBack = { showing = null },
                            onRefund = { _, _, _, _ -> },
                        )

                        "actions" -> ActionsDialog(
                            lastReceiptNo = "KC-00412",
                            onReprintLast = {},
                            onOpenHistory = {},
                            onOpenDrawer = {},
                            onCustomItem = {},
                            onSaleNote = { showing = "note" },
                            onSettings = {},
                            onDismiss = { showing = null },
                        )

                        "toast" -> Box(Modifier.fillMaxSize()) {
                            SaleCompleteScreen(
                                saleNo = "KC-00413",
                                total = 1_306.28,
                                change = 193.72,
                                itemCount = 3,
                                methods = "Cash",
                                queued = false,
                                receiptPreview = null,
                                onPrint = {},
                                onPrintGift = {},
                                onNewSale = { showing = null },
                            )
                            ToastPill("Basket discount removed")
                        }

                        "basket" -> BasketDiscountDialog(
                            basket = 1_451.42,
                            rules = SAMPLE_RULES,
                            current = null,
                            onApply = { showing = null },
                            onDismiss = { showing = null },
                        )

                        "txns" -> TodaysSalesDialog(
                            sales = SAMPLE_SALES,
                            loading = false,
                            onSearch = {},
                            onReprint = {},
                            onGiftReceipt = {},
                            onReturn = {},
                            onDismiss = { showing = null },
                        )

                        "custom" -> CustomItemDialog(
                            onAdd = { _, _ -> showing = null },
                            onDismiss = { showing = null },
                        )

                        "note" -> SaleNoteDialog(
                            note = "",
                            onSave = { showing = null },
                            onDismiss = { showing = null },
                        )

                        "settings" -> SettingsScreen(
                            printerConfigured = true,
                            printerLabel = "Counter · 80mm",
                            paper = PaperWidth.Mm80,
                            autoPrint = false,
                            drawerOnCash = true,
                            drawerOnCard = false,
                            beepOnScan = true,
                            roundCash = false,
                            onBack = { showing = null },
                            onOpenPrinter = {},
                            onTestPrint = {},
                            onSetPaper = {},
                            onSetPref = { _, _ -> },
                        )

                        "openShift" -> OpenShiftScreen(
                            shopName = "Kids Corner",
                            cashierName = "Priya Ramdin",
                            busy = false,
                            error = null,
                            offline = false,
                            onOpen = {},
                            onLock = {},
                            onRetry = {},
                        )

                        // Signed in offline, with no drawer open. The one thing
                        // an outage genuinely stops, said before the float is
                        // counted rather than after the button fails.
                        "openShiftOffline" -> OpenShiftScreen(
                            shopName = "Kids Corner",
                            cashierName = "Priya Ramdin",
                            busy = false,
                            error = null,
                            offline = true,
                            onOpen = {},
                            onLock = {},
                            onRetry = {},
                        )

                        "closeShift" -> CloseShiftScreen(
                            totals = SAMPLE_TOTALS,
                            summary = null,
                            cashierName = "Priya Ramdin",
                            openedAt = "2026-07-29T05:02:00Z",
                            busy = false,
                            error = null,
                            onClose = { _, _ -> },
                            onCancel = {},
                            onFinish = {},
                        )

                        "closed" -> CloseShiftScreen(
                            totals = SAMPLE_TOTALS,
                            summary = CloseShiftResponse(
                                ok = true,
                                countedCash = 16_180.00,
                                expectedCash = 16_222.99,
                                variance = -42.99,
                                zNo = "Z00007",
                            ),
                            cashierName = "Priya Ramdin",
                            busy = false,
                            error = null,
                            onClose = { _, _ -> },
                            onCancel = {},
                            onFinish = {},
                        )

                        "sell" -> {
                            var cart by remember { mutableStateOf(SAMPLE_LINES) }
                            var note by remember { mutableStateOf("Coming back Saturday for the second pair") }
                            var basketDisc by remember {
                                mutableStateOf<AppliedDiscountLocal?>(
                                    AppliedDiscountLocal(
                                        null, "Staff discount", "percent", 10.0, 145.14,
                                    ),
                                )
                            }
                            SellScreen(
                            catalog = SAMPLE_CATALOG,
                            lines = cart,
                            // Derived, not hard-coded: taking the discount off
                            // has to move the totals, or this screen cannot
                            // show the no-discount state at all — which is the
                            // state a real basket is in nearly all the time.
                            totals = cartTotals(cart, basketDisc?.amount ?: 0.0, 0.15),
                            cashier = SAMPLE_MANAGERS[0],
                            shopName = "Kids Corner",
                            tillOpen = true,
                            catalogLoading = false,
                            online = true,
                            vatRate = 0.15,
                            customer = SAMPLE_CUSTOMERS[0],
                            discount = basketDisc,
                            heldCount = 2,
                            queuedCount = 0,
                            onSwitchCashier = {},
                            onAdd = { cart = cart.withVariant(it) },
                            onAddScanned = { cart = cart.withVariant(it) },
                            onSetQty = { id, qty -> cart = cart.withQty(id, qty) },
                            onSetLineDiscount = { id, kind, value ->
                                cart = cart.withLineDiscount(id, kind, value)
                            },
                            onOpenActions = { showing = "actions" },
                            onOpenStockCheck = { showing = "stockCheck" },
                            onOpenCustomItem = { showing = "custom" },
                            onOpenNote = {},
                            onSetNote = { note = it },
                            note = note,
                            onRemove = { id -> cart = cart.without(id) },
                            onClear = { cart = emptyList() },
                            onFindBarcode = { code -> SAMPLE_CATALOG.firstOrNull { it.barcode == code } },
                            onPay = {},
                            onLock = {},
                            onHold = {},
                            onOpenHeld = {},
                            onOpenCustomer = {},
                            onDetachCustomer = {},
                            onOpenDiscount = {},
                            onRemoveDiscount = { basketDisc = null },
                            onOpenTill = {},
                            onCloseTill = {},
                            onOpenMovement = {},
                            onOpenHistory = {},
                            )
                        }

                        "sellEmpty" -> SellScreen(
                            catalog = SAMPLE_CATALOG,
                            lines = emptyList(),
                            totals = cartTotals(emptyList(), 0.0, 0.15),
                            cashier = SAMPLE_MANAGERS[0],
                            shopName = "Kids Corner",
                            tillOpen = true,
                            catalogLoading = false,
                            online = false,
                            vatRate = 0.15,
                            customer = null,
                            discount = null,
                            heldCount = 0,
                            queuedCount = 3,
                            onSwitchCashier = {},
                            onAdd = {},
                            onAddScanned = {},
                            onSetQty = { _, _ -> },
                            onSetLineDiscount = { _, _, _ -> },
                            onOpenActions = {},
                            onOpenStockCheck = { showing = "stockCheck" },
                            onOpenCustomItem = {},
                            onOpenNote = {},
                            onSetNote = {},
                            note = "",
                            onRemove = {},
                            onClear = {},
                            onFindBarcode = { code -> SAMPLE_CATALOG.firstOrNull { it.barcode == code } },
                            onPay = {},
                            onLock = {},
                            onHold = {},
                            onOpenHeld = {},
                            onOpenCustomer = {},
                            onDetachCustomer = {},
                            onOpenDiscount = {},
                            onRemoveDiscount = {},
                            onOpenTill = {},
                            onCloseTill = {},
                            onOpenMovement = {},
                            onOpenHistory = {},
                        )

                        "stockCheck" -> StockCheckScreen(
                            catalog = SAMPLE_CATALOG.map {
                                when (it.id) {
                                    101 -> it.copy(shelfLocation = "A12", qtyOnHand = 110)
                                    102 -> it.copy(shelfLocation = "A12", qtyOnHand = 4)
                                    103 -> it.copy(shelfLocation = "A12", qtyOnHand = 2)
                                    else -> it
                                }
                            },
                            state = StockCheckUiState(
                                productId = 10,
                                locations = listOf(
                                    StockCheckLocation(
                                        id = 1,
                                        name = "Shop",
                                        quantities = listOf(
                                            StockCheckQuantity(101, 10),
                                            StockCheckQuantity(102, 4),
                                        ),
                                    ),
                                    StockCheckLocation(
                                        id = 2,
                                        name = "Warehouse",
                                        quantities = listOf(
                                            StockCheckQuantity(101, 100),
                                            StockCheckQuantity(102, 0),
                                        ),
                                    ),
                                ),
                            ),
                            onSelectProduct = {},
                            onRetry = {},
                            onBack = { showing = "sell" },
                        )

                        // Split bill is reached from the header, so the
                        // gallery entry is the same screen — tap "Split bill"
                        // to see the allocation mode.
                        "payment" -> PaymentScreen(
                            totals = cartTotals(SAMPLE_LINES, 0.0, 0.15),
                            lines = SAMPLE_LINES,
                            paymentMethods = listOf("cash", "card", "juice", "bank"),
                            cashierName = "Priya Ramdin",
                            busy = false,
                            error = null,
                            frozen = false,
                            parkable = false,
                            onConfirm = { _, _ -> },
                            onRetry = {},
                            onPark = {},
                            onCancel = {},
                            onOpenDrawer = {},
                        )


                        "setup" -> DeviceSetupScreen(
                            busy = false,
                            error = null,
                            onSignIn = { _, _ -> },
                        )

                        "offline" -> OfflineScreen(
                            message = "The shop's server did not answer. Check the Wi-Fi.",
                            busy = false,
                            onRetry = {},
                        )

                        // Reads whatever this device actually has stored, and
                        // saves nothing — the gallery is for looking at.
                        "printer" -> PrinterSettingsDialog(
                            settings = remember { PrinterSettings(this@GalleryActivity) },
                            describe = "No printer set up on this device",
                            busy = false,
                            testResult = null,
                            onSave = { _, _, _, _ -> },
                            onTest = {},
                            onDismiss = { showing = null },
                        )

                        "receipt" -> ReceiptPreviewDialog(
                            preview = SAMPLE_RECEIPT,
                            paper = PaperWidth.Mm80,
                            onDismiss = { showing = null },
                        )

                        "complete" -> SaleCompleteScreen(
                            saleNo = "KC-00412",
                            total = 1_845.50,
                            change = 154.50,
                            itemCount = 4,
                            methods = "Cash",
                            queued = false,
                            // The slip that just came off the printer, as the
                            // real screen shows it.
                            receiptPreview = buildReceipt(
                                sale = SAMPLE_DETAIL,
                                shop = ShopIdentity(
                                    name = "Kids Corner",
                                    address = "Royal Road, Curepipe",
                                    phone = "5xxx xxxx",
                                    vatNumber = "12345678",
                                ),
                                width = PaperWidth.Mm80,
                            ).toPlainText(PaperWidth.Mm80),
                            onPrint = {},
                            onPrintGift = {},
                            onNewSale = {},
                        )

                        "customer" -> CustomerDialog(
                            results = SAMPLE_CUSTOMERS,
                            searching = false,
                            error = null,
                            onSearch = {},
                            onPick = {},
                            onCreate = { _, _ -> },
                            onDismiss = { showing = null },
                        )

                        "held" -> HeldSalesDialog(
                            held = SAMPLE_HELD,
                            cartBusy = false,
                            onResume = {},
                            onDiscard = {},
                            onDismiss = { showing = null },
                        )


                        "approval" -> ManagerApprovalDialog(
                            managers = SAMPLE_MANAGERS,
                            reason = "10% off the sale needs an owner or manager.",
                            busy = false,
                            onApprove = { _, _ -> },
                            onDismiss = { showing = null },
                        )

                        "movement" -> MovementDialog(
                            busy = false,
                            error = null,
                            done = false,
                            onRecord = { _, _, _ -> },
                            onDismiss = { showing = null },
                        )

                        else -> Menu { showing = it }
                    }

                    if (showing != null) {
                        Surface(
                            onClick = { showing = null },
                            shape = RoundedCornerShape(11.dp),
                            color = Handoff.ScanButton,
                            contentColor = Handoff.ScanGlyph,
                            modifier = Modifier
                                .align(Alignment.TopCenter)
                                .padding(12.dp),
                        ) {
                            Text(
                                "‹ Gallery",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp),
                            )
                        }
                    }
                    }
                }
            }
        }
    }
}

@Composable
private fun Menu(onPick: (String) -> Unit) {
    Box(Modifier.fillMaxSize().background(Handoff.Canvas).padding(40.dp)) {
        Column {
            Text(
                "Handoff gallery",
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
                color = Handoff.Ink,
                modifier = Modifier.padding(bottom = 4.dp),
            )
            Text(
                "adb shell am start -n mu.kidscorner.till/.debug.GalleryActivity -e screen <name>",
                fontSize = 12.sp,
                color = Handoff.Muted3,
                modifier = Modifier.padding(bottom = 18.dp),
            )
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(SCREENS) { name ->
                    Surface(
                        onClick = { onPick(name) },
                        shape = RoundedCornerShape(12.dp),
                        color = Handoff.Surface,
                        contentColor = Handoff.Ink,
                    ) {
                        Text(
                            name,
                            fontSize = 15.sp,
                            modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
                        )
                    }
                }
            }
        }
    }
}

private val SCREENS = listOf(
    "pin", "pinError", "pinChecking", "pinOffline", "pinOfflineCold", "openShiftOffline", "sell", "sellEmpty", "stockCheck", "payment", "openShift", "closeShift", "closed", "complete",
    "customer", "held", "approval", "movement",
    "setup", "offline", "printer", "receipt", "settings", "refund", "actions", "note", "custom", "basket", "txns", "toast",
)

// ─────────────────────────────────────────────── invented, but plausible ──
//
// The figures are the ones the Z report reconciled against during testing, so
// a screen drawn here shows the same shapes and column widths a real day does.

private val SAMPLE_TOTALS = ShiftTotals(
    saleCount = 38,
    salesTotal = 16_222.99,
    vatTotal = 2_116.04,
    discountTotal = 340.00,
    itemCount = 91,
    averageBasket = 426.92,
    byMethod = mapOf(
        "cash" to 9_140.50,
        "card" to 4_882.49,
        "juice" to 1_450.00,
        "myt_money" to 750.00,
    ),
    openingFloat = 2_000.00,
    cashTaken = 9_140.50,
    tillMovements = -300.00,
    expectedCash = 10_840.50,
)

private val SAMPLE_CUSTOMERS = listOf(
    Customer(1, "Anjali Seenauth", "5729 4410"),
    Customer(2, "Kevin Louis", "5812 7736"),
    Customer(3, "Fatima Bhugaloo", null),
)

private fun line(
    name: String,
    variant: String,
    price: Double,
    qty: Int,
    category: Int = 1,
    size: String = "",
    colour: String = "",
    hex: String = "#F0806B",
    stock: Int = 12,
) = CartLine(
    variantId = name.hashCode().absoluteValue,
    productName = name,
    variantLabel = variant,
    sizeLabel = size,
    colourName = colour,
    colourHex = hex,
    sku = "KC-${name.take(3).uppercase()}",
    unitPrice = price,
    qty = qty,
    qtyOnHand = stock,
    categoryId = category,
)

private val SAMPLE_HELD = listOf(
    HeldSale(
        id = "a",
        label = "Anjali Seenauth",
        lines = listOf(line("Cotton romper", "6–9m · Coral", 565.71, 2)),
        customer = SAMPLE_CUSTOMERS[0],
        discount = null,
        heldAt = System.currentTimeMillis() - 6 * 60_000L,
    ),
    HeldSale(
        id = "b",
        label = "Walk-in",
        lines = listOf(
            line("Denim dungaree", "18–24m · Blue", 1_240.00, 1),
            line("Sun hat", "One size", 320.00, 3),
        ),
        customer = null,
        discount = AppliedDiscountLocal(null, "Manager 10%", "percent", 10.0, 220.00),
        heldAt = System.currentTimeMillis() - 6 * 60_000L,
    ),
)

private val SAMPLE_RULES = listOf(
    DiscountRule(1, "Staff discount", "STAFF", "percent", 15.0, requiresManager = true),
    DiscountRule(2, "Rs 200 off Rs 2,000", "SAVE200", "amount", 200.0, minSpend = 2_000.0),
    DiscountRule(3, "End of season", "EOS", "percent", 25.0, requiresManager = true),
)

private fun variant(
    id: Int,
    name: String,
    category: String,
    size: String,
    colour: String,
    hex: String,
    price: Double,
    stock: Int = 8,
) = CatalogVariant(
    id = id,
    productId = id / 10,
    productName = name,
    categoryId = category.hashCode(),
    categoryName = category,
    sizeLabel = size,
    sizeSort = id % 10,
    colourName = colour,
    colourHex = hex,
    sku = "KC-%04d".format(id),
    barcode = "600000%06d".format(id),
    price = price,
    qtyOnHand = stock,
)

private val SAMPLE_CATALOG = listOf(
    variant(101, "Cotton romper", "Babywear", "0–3m", "Coral", "#F0806B", 565.71),
    variant(102, "Cotton romper", "Babywear", "3–6m", "Coral", "#F0806B", 565.71),
    variant(103, "Cotton romper", "Babywear", "6–9m", "Sky", "#8CC6E8", 565.71, stock = 2),
    variant(111, "Denim dungaree", "Toddler", "12–18m", "Indigo", "#3B4A8C", 1_240.00),
    variant(112, "Denim dungaree", "Toddler", "18–24m", "Indigo", "#3B4A8C", 1_240.00),
    variant(121, "Sun hat", "Accessories", "One size", "Butter", "#FBF0D6", 320.00),
    variant(131, "Muslin swaddle", "Babywear", "One size", "Sage", "#CFE8E3", 480.00),
    variant(141, "Party frock", "Girls", "3–4y", "Blush", "#FDE4DE", 1_890.00, stock = 0),
    variant(151, "Sneakers", "Footwear", "24", "White", "#FFFFFF", 1_450.00),
    variant(161, "Rain jacket", "Outerwear", "4–5y", "Lemon", "#F7E9A0", 1_120.00),
)

private val SAMPLE_LINES = listOf(
    line("Cotton romper", "Coral · 3–6m", 565.71, 2, 1, "3-6 mths", "Coral", "#F0806B"),
    line("Denim dungarees", "Indigo · 1–2y", 1_240.00, 1, 1, "1-2 yrs", "Indigo", "#3B4A7A"),
    line("Sun hat", "Butter · One size", 320.00, 1, 2, "One size", "Butter", "#F7E9A0", stock = 1),
)

private val SAMPLE_RECEIPT = """
            KIDS CORNER
        Curepipe  ·  Till 1
       VAT  VAT12345678

Sale     KC-00412
Date     29/07/2026 14:32
Cashier  Priya Ramdin
Customer Anjali Seenauth
------------------------------------------------
2 x 565.71  Cotton romper           1,131.42
            Coral · 3-6m
1 x 320.00  Sun hat                   320.00
            Butter · One size
1 x 480.00  Muslin swaddle            480.00
            Sage · One size
------------------------------------------------
Subtotal                            2,065.50
Staff discount                       -220.00
Includes VAT 15%                      240.72
TOTAL                               1,845.50
------------------------------------------------
Cash                                2,000.00
Change                                154.50

        Thank you — please keep
         this receipt for
            exchanges.
""".trimIndent()

private val SAMPLE_SALES = listOf(
    SaleSummary(412, "KC-00412", "2026-07-29T14:32:11Z", 1_845.50, itemCount = 4, customerName = "Anjali Seenauth"),
    SaleSummary(411, "KC-00411", "2026-07-29T14:07:02Z", 320.00, itemCount = 1),
    SaleSummary(410, "KC-00410", "2026-07-29T13:44:58Z", 2_680.00, itemCount = 3, customerName = "Kevin Louis"),
    SaleSummary(409, "KC-00409", "2026-07-29T13:12:20Z", 565.71, itemCount = 1, status = "refunded"),
)

private val SAMPLE_DETAIL = SaleDetail(
    id = 412,
    saleNo = "KC-00412",
    saleDate = "2026-07-29T14:32:11Z",
    subtotal = 2_065.50,
    discount = 220.00,
    vatAmount = 240.72,
    total = 1_845.50,
    cashierName = "Priya Ramdin",
    customerName = "Anjali Seenauth",
    lines = listOf(
        SaleDetailLine(1, "Cotton romper", "3–6m", "Coral", "#F0806B", "KC-0102", qty = 2, unitPrice = 565.71, lineTotal = 1_131.42),
        SaleDetailLine(2, "Sun hat", "One size", "Butter", "#FBF0D6", "KC-0121", qty = 1, unitPrice = 320.00, lineTotal = 320.00),
        SaleDetailLine(3, "Muslin swaddle", "One size", "Sage", "#CFE8E3", "KC-0131", qty = 1, unitPrice = 480.00, lineTotal = 480.00),
    ),
    payments = listOf(SaleDetailPayment(1, "cash", 1_845.50, tendered = 2_000.00)),
    discounts = listOf(
        SaleDetailDiscount("Staff discount", "percent", 10.0, 220.00, approvedByName = "Fatima Bhugaloo"),
    ),
    prints = listOf(ReceiptPrint(1, "2026-07-29T14:32:40Z", by = "Priya Ramdin")),
)

/**
 * Kevin has no verifier on purpose — he is the cashier whose PIN was set from
 * Settings and who has not signed in on this till since, so the `pinOffline`
 * screen shows both halves of the rule at once.
 */
private const val SAMPLE_VERIFIER =
    "pbkdf2:sha256:1000:S2lkc0Nvcm5lclRpbGwhIQ==:AC4CSs7AfaJLrvK/10tjh3K/JebHyW4cydmO8KKHW8A="

private val SAMPLE_STAFF = listOf(
    Cashier("s1", "Priya Ramdin", "Owner", hasPin = true, verifier = SAMPLE_VERIFIER),
    Cashier("s2", "Anjali Seenauth", "Cashier", hasPin = true, verifier = SAMPLE_VERIFIER),
    Cashier("s3", "Kevin Louis", "Cashier", hasPin = true),
    Cashier("s4", "Fatima Bhugaloo", "Manager", hasPin = true, verifier = SAMPLE_VERIFIER),
)

private val SAMPLE_MANAGERS = listOf(
    Cashier("m1", "Priya Ramdin", "owner", hasPin = true),
    Cashier("m2", "Fatima Bhugaloo", "manager", hasPin = true),
)
