package mu.kidscorner.till.print

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
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
 * Two transports, because shop thermal printers come two ways: Bluetooth for
 * the small battery ones that sit beside the till, and TCP for the ones wired
 * into the shop's network. Both are behind one interface so the receipt code
 * never learns which is in use.
 *
 * None of this has been tested against real hardware — there is no printer.
 * The bytes are known good because `EscPos` is tested; whether a given printer
 * accepts them over a given link is not something the emulator can answer.
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
