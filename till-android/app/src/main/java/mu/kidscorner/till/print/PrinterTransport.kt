package mu.kidscorner.till.print

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID

/**
 * How the bytes get to the paper.
 *
 * Three transports, because shop thermal printers arrive three ways: Bluetooth
 * for the small battery ones beside the till, TCP for the ones wired into the
 * shop's network, and USB for a printer plugged straight into the tablet (over
 * OTG on a tablet with one port). All three are behind one interface so the
 * receipt code never learns which is in use.
 *
 * None of this has been tested against real hardware — there is no printer, and
 * an emulator has no Bluetooth radio or USB host to answer with. The bytes are
 * known good because `EscPos` is tested; whether a given printer accepts them
 * over a given link is not something this project can prove without one on a
 * bench.
 */

sealed interface PrintResult {
    data object Sent : PrintResult
    data class Failed(val reason: String) : PrintResult
}

interface PrinterTransport {
    /** Human-readable, for the settings screen. */
    val describe: String

    suspend fun send(bytes: ByteArray): PrintResult
}

/**
 * The state a shop is in before anyone configures a printer.
 *
 * A real object rather than a null, so every caller has to deal with it. The
 * alternative — a nullable transport — invites `printer?.send(...)`, which
 * silently succeeds at doing nothing and leaves a cashier waiting for paper.
 */
object NoPrinter : PrinterTransport {
    override val describe = "No printer set up"
    override suspend fun send(bytes: ByteArray): PrintResult =
        PrintResult.Failed("No printer is set up. Add one in printer settings.")
}

/**
 * A Bluetooth serial printer.
 *
 * Uses the well-known SPP UUID, which is what every ESC/POS Bluetooth printer
 * exposes. The socket is opened per job and closed after: these printers hold
 * one connection and a till that kept it open would lock out every other device
 * — and would itself fail to reconnect after the printer's idle timeout.
 */
class BluetoothPrinter(
    private val context: Context,
    private val address: String,
    private val name: String,
) : PrinterTransport {

    override val describe = "$name ($address)"

    @SuppressLint("MissingPermission")
    override suspend fun send(bytes: ByteArray): PrintResult = withContext(Dispatchers.IO) {
        if (!hasBluetoothPermission(context)) {
            return@withContext PrintResult.Failed(
                "The till needs Bluetooth permission to reach the printer.",
            )
        }

        val manager = context.getSystemService(BluetoothManager::class.java)
        val adapter: BluetoothAdapter? = manager?.adapter
            ?: return@withContext PrintResult.Failed("This device has no Bluetooth.")

        if (adapter?.isEnabled != true) {
            return@withContext PrintResult.Failed("Bluetooth is switched off.")
        }

        val device = runCatching { adapter.getRemoteDevice(address) }.getOrNull()
            ?: return@withContext PrintResult.Failed("That printer address is not valid.")

        var socket: android.bluetooth.BluetoothSocket? = null
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP)
            // Discovery and connecting compete for the same radio, and a scan
            // left running makes connect fail intermittently — the classic
            // "works sometimes" Bluetooth bug.
            runCatching { adapter.cancelDiscovery() }

            withTimeout(CONNECT_TIMEOUT_MS) { socket.connect() }
            socket.outputStream.writeAndFlush(bytes)
            PrintResult.Sent
        } catch (cause: Exception) {
            PrintResult.Failed(cause.message ?: "Could not reach the printer.")
        } finally {
            runCatching { socket?.close() }
        }
    }

    private companion object {
        /** The Serial Port Profile UUID. Every ESC/POS Bluetooth printer uses it. */
        val SPP: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        const val CONNECT_TIMEOUT_MS = 8_000L
    }
}

/**
 * A network printer, almost always on port 9100.
 *
 * 9100 is the raw JetDirect port: no protocol, no handshake, no acknowledgement
 * — bytes in, ink out. Which means a successful write proves the socket
 * accepted the data and nothing about whether anything printed. That limitation
 * is real and is why the till records a print as *intent*, not as fact.
 */
class NetworkPrinter(
    private val host: String,
    private val port: Int = 9100,
) : PrinterTransport {

    override val describe = "$host:$port"

    override suspend fun send(bytes: ByteArray): PrintResult = withContext(Dispatchers.IO) {
        var socket: Socket? = null
        try {
            socket = Socket()
            socket.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
            socket.getOutputStream().writeAndFlush(bytes)
            PrintResult.Sent
        } catch (cause: Exception) {
            PrintResult.Failed(cause.message ?: "Could not reach the printer.")
        } finally {
            runCatching { socket?.close() }
        }
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 5_000
    }
}

/**
 * A USB thermal printer, plugged into the tablet.
 *
 * Identified by vendor and product id rather than the kernel device path, which
 * is `/dev/bus/usb/00X/00Y` and changes every time the cable is pulled — the id
 * pair names the model and survives a reconnect. The connection is opened per
 * job and released after, matching the other two: a till that held the interface
 * would keep any other app off the printer and gain nothing for it.
 *
 * Access is gated twice by Android. USB host has to be present (a tablet with
 * only a charging port and no OTG cannot do this), and the user has to grant
 * this app permission for the specific device — a per-device runtime prompt with
 * nothing to do with the manifest. Both are re-checked here, on the same
 * principle as `BluetoothPrinter`: the layer holding the connection is the one
 * that must decide what a missing capability means, and it answers with a line a
 * cashier can act on rather than a silent no-op.
 */
class UsbPrinter(
    private val context: Context,
    private val vendorId: Int,
    private val productId: Int,
    private val label: String,
) : PrinterTransport {

    override val describe = "$label (USB $vendorId:$productId)"

    override suspend fun send(bytes: ByteArray): PrintResult = withContext(Dispatchers.IO) {
        val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager
            ?: return@withContext PrintResult.Failed("This device has no USB support.")

        val device = manager.deviceList.values.firstOrNull {
            it.vendorId == vendorId && it.productId == productId
        } ?: return@withContext PrintResult.Failed("That USB printer is not plugged in.")

        if (!manager.hasPermission(device)) {
            return@withContext PrintResult.Failed(
                "The till needs USB permission for this printer. Open printer settings, " +
                    "pick it again and tap Save and test, then allow the prompt.",
            )
        }

        val iface = printerInterface(device)
            ?: return@withContext PrintResult.Failed("That USB device is not a printer.")
        val endpoint = bulkOut(iface)
            ?: return@withContext PrintResult.Failed("That USB printer exposes no way in for data.")

        val connection = runCatching { manager.openDevice(device) }.getOrNull()
            ?: return@withContext PrintResult.Failed("Could not open the USB printer.")

        try {
            if (!connection.claimInterface(iface, true)) {
                return@withContext PrintResult.Failed("The USB printer is busy.")
            }
            // Sent in chunks: a printer's bulk buffer is small, and a single
            // oversized transfer is where a long receipt gets truncated. The
            // offset overload (API 18+, minSdk here is 26) avoids copying each
            // slice out just to move the start.
            var offset = 0
            while (offset < bytes.size) {
                val chunk = minOf(CHUNK_BYTES, bytes.size - offset)
                val moved = connection.bulkTransfer(endpoint, bytes, offset, chunk, WRITE_TIMEOUT_MS)
                if (moved <= 0) {
                    return@withContext PrintResult.Failed("The USB printer stopped taking data.")
                }
                offset += moved
            }
            PrintResult.Sent
        } catch (cause: Exception) {
            PrintResult.Failed(cause.message ?: "Could not reach the USB printer.")
        } finally {
            runCatching { connection.releaseInterface(iface) }
            runCatching { connection.close() }
        }
    }

    private companion object {
        const val CHUNK_BYTES = 16_384
        const val WRITE_TIMEOUT_MS = 5_000
    }
}

/** One attached USB device, reduced to what the settings picker shows and stores. */
data class UsbCandidate(val vendorId: Int, val productId: Int, val label: String)

/**
 * The USB devices attached right now, for the settings picker.
 *
 * Everything is listed rather than only class-7 printers: cheap ESC/POS units
 * very often present as a vendor-specific class, so filtering to the printer
 * class would hide exactly the printers this exists to find. The shop picks the
 * one that is theirs.
 */
fun usbPrinters(context: Context): List<UsbCandidate> {
    val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return emptyList()
    return manager.deviceList.values
        .map { device ->
            val named = listOfNotNull(device.manufacturerName, device.productName)
                .joinToString(" ")
                .trim()
            UsbCandidate(
                vendorId = device.vendorId,
                productId = device.productId,
                label = named.ifBlank { "USB device ${device.vendorId}:${device.productId}" },
            )
        }
        .sortedBy { it.label.lowercase() }
}

/**
 * Ask Android for permission to talk to this printer.
 *
 * Fire-and-forget, like the Bluetooth prompt: the result is delivered to a
 * PendingIntent, but `UsbPrinter` re-reads `hasPermission` before every job, so
 * the grant is picked up on the next test or print without anything here having
 * to catch the broadcast. The intent is explicit (`setPackage`) so it is legal
 * as an immutable broadcast on modern Android; a no-op target is enough because
 * the system records the user's choice regardless of who receives it.
 */
fun requestUsbPermission(context: Context, address: String) {
    val (vendorId, productId) = parseUsbAddress(address) ?: return
    val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return
    val device = manager.deviceList.values.firstOrNull {
        it.vendorId == vendorId && it.productId == productId
    } ?: return
    if (manager.hasPermission(device)) return

    val intent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(USB_PERMISSION_ACTION).setPackage(context.packageName),
        PendingIntent.FLAG_IMMUTABLE,
    )
    runCatching { manager.requestPermission(device, intent) }
}

/** `vendorId:productId`, decimal, both non-negative — or null if it is anything else. */
fun parseUsbAddress(address: String): Pair<Int, Int>? {
    val parts = address.split(":")
    if (parts.size != 2) return null
    val vendorId = parts[0].trim().toIntOrNull() ?: return null
    val productId = parts[1].trim().toIntOrNull() ?: return null
    if (vendorId < 0 || productId < 0) return null
    return vendorId to productId
}

/** The interface to print through: a real printer interface if there is one, else the first with a bulk-out endpoint. */
private fun printerInterface(device: UsbDevice): UsbInterface? {
    val interfaces = (0 until device.interfaceCount).map { device.getInterface(it) }
    return interfaces.firstOrNull { it.interfaceClass == UsbConstants.USB_CLASS_PRINTER && bulkOut(it) != null }
        ?: interfaces.firstOrNull { bulkOut(it) != null }
}

/** The endpoint bytes leave by: bulk, host-to-device. */
private fun bulkOut(iface: UsbInterface): UsbEndpoint? =
    (0 until iface.endpointCount)
        .map { iface.getEndpoint(it) }
        .firstOrNull {
            it.type == UsbConstants.USB_ENDPOINT_XFER_BULK && it.direction == UsbConstants.USB_DIR_OUT
        }

private const val USB_PERMISSION_ACTION = "mu.kidscorner.till.USB_PERMISSION"

/**
 * Flushed explicitly before the stream is closed.
 *
 * Closing a socket does flush it, but the printer needs a moment with the
 * connection still open to take the last bytes off the wire. Dropping the link
 * the instant the write returns truncates long receipts — which shows up as a
 * receipt that prints fine until the shop has a big basket.
 */
private fun OutputStream.writeAndFlush(bytes: ByteArray) {
    write(bytes)
    flush()
    Thread.sleep(SETTLE_MS)
}

private const val SETTLE_MS = 250L

/** BLUETOOTH_CONNECT is runtime-granted from API 31; before that it is implicit. */
fun hasBluetoothPermission(context: Context): Boolean =
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        true
    } else {
        ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.BLUETOOTH_CONNECT,
        ) == PackageManager.PERMISSION_GRANTED
    }
