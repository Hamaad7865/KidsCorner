package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.print.PaperWidth
import mu.kidscorner.till.print.PrinterSettings
import mu.kidscorner.till.print.UsbCandidate
import mu.kidscorner.till.print.usbPrinters
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.ui.theme.PlexMono

/**
 * What would come out of the printer.
 *
 * Monospaced, because the receipt's whole layout is column arithmetic against a
 * fixed character count — rendered in a proportional face the columns would not
 * line up and the preview would be a lie about the paper.
 *
 * Generated from the same line list the printer receives, so this is not an
 * approximation of the receipt; it is the receipt, minus the ink.
 */
@Composable
fun ReceiptPreviewDialog(
    preview: String,
    paper: PaperWidth,
    onDismiss: () -> Unit,
) {
    HandoffDialog(
        title = "Receipt preview",
        subtitle = "${paper.label} · ${paper.columns} characters wide",
        width = 620,
        maxHeight = 680,
        onDismiss = onDismiss,
    ) {
        Column(Modifier.padding(20.dp)) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = 460.dp)
                    .background(Handoff.FieldWell, RoundedCornerShape(10.dp))
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
                // A slip is a narrow column of monospace; left-aligned in a
                // wide panel it sits off to one side of its own box.
                contentAlignment = Alignment.TopCenter,
            ) {
                Text(
                    preview,
                    fontFamily = PlexMono,
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    color = Handoff.Ink,
                )
            }
            HandoffButton(
                label = "Close",
                primary = false,
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                onClick = onDismiss,
            )
        }
    }
}

/**
 * Which printer this tablet uses.
 *
 * Per device rather than per shop: two tills in one shop can have different
 * printers beside them.
 */
@Composable
fun PrinterSettingsDialog(
    settings: PrinterSettings,
    describe: String,
    busy: Boolean,
    testResult: String?,
    onSave: (PrinterSettings.Kind, String, String, PaperWidth) -> Unit,
    onTest: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    var kind by remember { mutableStateOf(settings.kind) }
    var address by remember { mutableStateOf(settings.address) }
    var name by remember { mutableStateOf(settings.name) }
    var paper by remember { mutableStateOf(settings.paper) }
    // Only what a scan turned up: USB devices come and go with the cable, so an
    // empty list means "nothing attached", not "none exist".
    var usbDevices by remember { mutableStateOf(emptyList<UsbCandidate>()) }

    val configured = kind != PrinterSettings.Kind.None

    HandoffDialog(
        title = "Receipt printer",
        subtitle = "Currently: $describe",
        width = 620,
        maxHeight = 700,
        onDismiss = onDismiss,
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FieldLabel("Connection")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrinterSettings.Kind.entries.forEach { option ->
                    Choice(
                        label = when (option) {
                            PrinterSettings.Kind.None -> "None"
                            PrinterSettings.Kind.Bluetooth -> "Bluetooth"
                            PrinterSettings.Kind.Network -> "Network"
                            PrinterSettings.Kind.Usb -> "USB"
                        },
                        selected = kind == option,
                        modifier = Modifier.weight(1f),
                    ) { kind = option }
                }
            }

            if (configured) {
                if (kind == PrinterSettings.Kind.Usb) {
                    FieldLabel("USB printer")
                    HandoffButton(
                        label = "Scan for USB printers",
                        primary = false,
                        modifier = Modifier.fillMaxWidth(),
                    ) { usbDevices = usbPrinters(context) }

                    if (usbDevices.isEmpty()) {
                        Text(
                            "Plug the printer into the tablet — an OTG adapter if it has " +
                                "only a charging port — then scan. Only devices connected " +
                                "right now appear.",
                            fontSize = 11.5.sp,
                            color = Handoff.Muted3,
                        )
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            usbDevices.forEach { device ->
                                val addr = "${device.vendorId}:${device.productId}"
                                Choice(
                                    label = device.label,
                                    selected = address == addr,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    address = addr
                                    if (name.isBlank()) name = device.label
                                }
                            }
                        }
                    }

                    if (address.isNotBlank() &&
                        usbDevices.none { "${it.vendorId}:${it.productId}" == address }
                    ) {
                        Text(
                            "Saved: ${name.ifBlank { address }}. Plug it in and scan to " +
                                "confirm it is connected.",
                            fontSize = 11.5.sp,
                            color = Handoff.Muted3,
                        )
                    }
                } else {
                    FieldLabel(
                        if (kind == PrinterSettings.Kind.Bluetooth) "Bluetooth address"
                        else "IP address or hostname",
                    )
                    HandoffField(
                        value = address,
                        onValueChange = { address = it },
                        placeholder = if (kind == PrinterSettings.Kind.Bluetooth) {
                            "00:11:22:33:44:55"
                        } else {
                            "192.168.1.50"
                        },
                        keyboard = if (kind == PrinterSettings.Kind.Network) {
                            KeyboardType.Uri
                        } else {
                            KeyboardType.Text
                        },
                        mono = true,
                    )
                    Text(
                        if (kind == PrinterSettings.Kind.Bluetooth) {
                            "Pair the printer in Android settings first, then copy its " +
                                "address here."
                        } else {
                            "Port 9100 unless the printer says otherwise."
                        },
                        fontSize = 11.5.sp,
                        color = Handoff.Muted3,
                    )
                }

                FieldLabel("Name (optional)")
                HandoffField(
                    value = name,
                    onValueChange = { name = it },
                    placeholder = "Counter printer",
                )
            }

            Box(Modifier.fillMaxWidth().height(1.dp).background(Handoff.LineFaint))

            FieldLabel("Paper width")
            Text(
                "Getting this wrong does not show an error — the receipt wraps " +
                    "mid-figure, so a total prints across two lines.",
                fontSize = 11.5.sp,
                color = Handoff.Muted3,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PaperWidth.entries.forEach { option ->
                    Choice(
                        label = "${option.label} · ${option.columns} chars",
                        selected = paper == option,
                        modifier = Modifier.weight(1f),
                    ) { paper = option }
                }
            }

            testResult?.let {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(Handoff.FieldWell, RoundedCornerShape(10.dp))
                        .padding(12.dp),
                ) {
                    Text(it, fontSize = 12.5.sp, color = Handoff.Muted2)
                }
            }

            Row(
                Modifier.padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                HandoffButton(
                    label = if (busy) "Testing…" else "Save and test",
                    primary = false,
                    enabled = !busy && configured && address.isNotBlank(),
                    modifier = Modifier.weight(1f),
                ) {
                    onSave(kind, address.trim(), name.trim(), paper)
                    onTest()
                }
                HandoffButton(
                    label = "Save",
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                ) {
                    onSave(kind, address.trim(), name.trim(), paper)
                    onDismiss()
                }
            }
        }
    }
}

/** A segmented choice: tinted when picked, bordered white otherwise. */
@Composable
private fun Choice(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = if (selected) Handoff.AccentTint else Handoff.Surface,
        contentColor = if (selected) Handoff.AccentText else Handoff.Ink,
        border = BorderStroke(1.dp, if (selected) Handoff.AccentSolid else Handoff.LineSoft),
        modifier = modifier.height(60.dp),
    ) {
        Box(Modifier.fillMaxSize().padding(horizontal = 8.dp), Alignment.Center) {
            Text(
                label,
                fontSize = 13.5.sp,
                fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                maxLines = 1,
            )
        }
    }
}
