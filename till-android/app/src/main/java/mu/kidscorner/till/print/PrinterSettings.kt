package mu.kidscorner.till.print

import android.content.Context

/**
 * Which printer this tablet uses, and how wide its paper is.
 *
 * Per device, not per shop. Two tills in the same shop can have different
 * printers beside them, so this belongs in local preferences rather than in the
 * `settings` table the back office owns.
 *
 * Plain SharedPreferences, unlike the session tokens: a Bluetooth MAC address
 * and a paper width are not secrets, and encrypting them would only make them
 * harder to fix when a printer is replaced.
 */
class PrinterSettings(context: Context) {

    private val prefs = context.getSharedPreferences("printer", Context.MODE_PRIVATE)

    enum class Kind { None, Bluetooth, Network, Usb }

    var kind: Kind
        get() = runCatching { Kind.valueOf(prefs.getString(KEY_KIND, null) ?: "None") }
            .getOrDefault(Kind.None)
        set(value) = prefs.edit().putString(KEY_KIND, value.name).apply()

    /**
     * A Bluetooth MAC, a hostname/IP for a network printer, or `vendorId:productId`
     * (decimal) for a USB one. USB devices have no stable path across reconnects,
     * but the vendor/product pair identifies the model, which is enough to find it
     * again in the attached-device list.
     */
    var address: String
        get() = prefs.getString(KEY_ADDRESS, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_ADDRESS, value.trim()).apply()

    var name: String
        get() = prefs.getString(KEY_NAME, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_NAME, value.trim()).apply()

    var port: Int
        get() = prefs.getInt(KEY_PORT, 9100)
        set(value) = prefs.edit().putInt(KEY_PORT, value).apply()

    var paper: PaperWidth
        get() = runCatching { PaperWidth.valueOf(prefs.getString(KEY_PAPER, null) ?: "Mm80") }
            .getOrDefault(PaperWidth.Mm80)
        set(value) = prefs.edit().putString(KEY_PAPER, value.name).apply()

    // ── till behaviour, from `atSettings` ─────────────────────────────────
    //
    // POS v2 gives the till a settings screen of switches. They live here
    // beside the printer for the same reason: they are per-device. Two tills in
    // one shop can reasonably disagree about whether to print automatically.
    //
    // `askReceipt` used to sit here too, storing whether the payment screen
    // should offer print / email / none. It always offers Print and Gift
    // receipt, unconditionally, and the till cannot send an email at all — so
    // the switch described neither a choice nor a capability.

    /** Print every completed sale without asking. */
    var autoPrint: Boolean
        get() = prefs.getBoolean(KEY_AUTO_PRINT, false)
        set(value) = prefs.edit().putBoolean(KEY_AUTO_PRINT, value).apply()

    /** Kick the drawer as a cash sale completes. */
    var drawerOnCash: Boolean
        get() = prefs.getBoolean(KEY_DRAWER_CASH, true)
        set(value) = prefs.edit().putBoolean(KEY_DRAWER_CASH, value).apply()

    /** And on a card sale — off for card-only tills. */
    var drawerOnCard: Boolean
        get() = prefs.getBoolean(KEY_DRAWER_CARD, false)
        set(value) = prefs.edit().putBoolean(KEY_DRAWER_CARD, value).apply()

    /** Audible confirm when a barcode lands. */
    var beepOnScan: Boolean
        get() = prefs.getBoolean(KEY_BEEP, true)
        set(value) = prefs.edit().putBoolean(KEY_BEEP, value).apply()

    /**
     * Round cash to the nearest Rs 5.
     *
     * Off by default and deliberately so: it changes what a customer pays, and
     * a till that quietly rounds without the shop having chosen to is a till
     * that is wrong. Mauritius has 5c upward in circulation, so this is a
     * convenience some shops want and others must not have.
     */
    var roundCash: Boolean
        get() = prefs.getBoolean(KEY_ROUND_CASH, false)
        set(value) = prefs.edit().putBoolean(KEY_ROUND_CASH, value).apply()

    /**
     * Builds the transport this device is configured for.
     *
     * Returns `NoPrinter` rather than null when nothing is set up, so callers
     * cannot accidentally no-op their way past an unconfigured printer and
     * leave a cashier waiting for paper that was never coming.
     */
    fun transport(context: Context): PrinterTransport = when (kind) {
        Kind.None -> NoPrinter
        Kind.Bluetooth ->
            if (address.isBlank()) NoPrinter
            else BluetoothPrinter(context, address, name.ifBlank { "Printer" })
        Kind.Network ->
            if (address.isBlank()) NoPrinter else NetworkPrinter(address, port)
        Kind.Usb ->
            parseUsbAddress(address)?.let { (vendorId, productId) ->
                UsbPrinter(context, vendorId, productId, name.ifBlank { "USB printer" })
            } ?: NoPrinter
    }

    private companion object {
        const val KEY_KIND = "kind"
        const val KEY_ADDRESS = "address"
        const val KEY_NAME = "name"
        const val KEY_PORT = "port"
        const val KEY_PAPER = "paper"
        const val KEY_AUTO_PRINT = "auto_print"
        const val KEY_DRAWER_CASH = "drawer_on_cash"
        const val KEY_DRAWER_CARD = "drawer_on_card"
        const val KEY_BEEP = "beep_on_scan"
        const val KEY_ROUND_CASH = "round_cash"
    }
}
