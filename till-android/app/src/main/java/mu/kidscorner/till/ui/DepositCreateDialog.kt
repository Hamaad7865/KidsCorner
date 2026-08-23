package mu.kidscorner.till.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.data.Approval
import mu.kidscorner.till.ui.theme.Handoff
import mu.kidscorner.till.data.formatRs
import java.time.LocalDate

/**
 * Basket → deposit.
 *
 * The basket is already built and a customer already attached — this dialog
 * only asks what is taken NOW, when to expect them back, and (only when the
 * basket carries money off) who is standing behind the price. Everything else
 * — prices frozen, stock reserved, cash into the drawer's books — is the
 * server's doing.
 */
@Composable
fun DepositCreateDialog(
    total: Double,
    hasDiscounts: Boolean,
    managers: List<mu.kidscorner.till.data.Cashier>,
    busy: Boolean,
    error: String?,
    shiftOpen: Boolean,
    paymentMethods: List<String>,
    onConfirm: (
        method: String,
        amount: Double,
        collectByIso: String?,
        note: String?,
        approval: Approval?,
    ) -> Unit,
    onDismiss: () -> Unit,
) {
    var method by remember { mutableStateOf("cash") }
    var amountText by remember { mutableStateOf("") }
    var dateText by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var managerId by remember { mutableStateOf(managers.firstOrNull()?.id ?: "") }
    var pin by remember { mutableStateOf("") }

    val amount = amountText.toDoubleOrNull() ?: 0.0
    val clamped = amount.coerceIn(0.0, total)
    val dateOk = dateText.isBlank() || Regex("""\d{4}-\d{2}-\d{2}""").matches(dateText)
    val approvalNeeded = hasDiscounts
    val approvalReady = !approvalNeeded || (managerId.isNotBlank() && pin.length == 4)
    val cashBlocked = method == "cash" && !shiftOpen
    val valid = !busy && dateOk && approvalReady && !cashBlocked && clamped >= 0

    DepositDialogShell(
        title = "Take deposit",
        subtitle = "Reserves every item in this basket",
        scrollable = true,
        onDismiss = onDismiss,
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(Handoff.Well)
                .padding(horizontal = 14.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Basket total", fontSize = 12.sp, color = Handoff.Muted)
            Text(
                formatRs(total),
                fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Handoff.Ink,
            )
        }

        MethodChips(paymentMethods.filter { it != "credit" }, method) { method = it }
        AmountField(amountText) { if (it.length <= 12) amountText = it }

        // Nothing down is legal too — a pure reservation. The quick chips exist
        // because "a third now" is how laybys are actually quoted at counters.
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            QuickAmount("Nothing") { amountText = "" }
            QuickAmount("Third") { amountText = formatPlain(total / 3) }
            QuickAmount("Half") { amountText = formatPlain(total / 2) }
            QuickAmount("Full") { amountText = formatPlain(total) }
        }
        if (clamped < amount) {
            Text("More than the basket — clamped to ${formatRs(total)}", fontSize = 11.5.sp, color = Handoff.WarnText)
        }

        BasicTextField(
            value = dateText,
            onValueChange = { if (it.length <= 10) dateText = it },
            singleLine = true,
            textStyle = LocalTextStyle.current.copy(fontSize = 14.sp, color = Handoff.Ink),
            cursorBrush = SolidColor(Handoff.Accent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .clip(RoundedCornerShape(11.dp))
                        .background(Handoff.FieldWell)
                        .border(1.dp, Handoff.LineField, RoundedCornerShape(11.dp))
                        .padding(horizontal = 14.dp),
                    Alignment.CenterStart,
                ) {
                    if (dateText.isEmpty()) {
                        Text("Collect by (YYYY-MM-DD) — optional", fontSize = 13.sp, color = Handoff.Muted3)
                    }
                    inner()
                }
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(7 to "+7 days", 14 to "+14 days", 30 to "+30 days").forEach { (days, label) ->
                Surface(
                    onClick = {
                        dateText = LocalDate.now().plusDays(days.toLong()).toString()
                    },
                    shape = RoundedCornerShape(9.dp),
                    color = Handoff.Well,
                    contentColor = Handoff.Muted,
                    border = androidx.compose.foundation.BorderStroke(1.dp, Handoff.LineSoft),
                ) {
                    Text(label, fontSize = 10.5.sp, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp))
                }
            }
        }

        BasicTextField(
            value = note,
            onValueChange = { if (it.length <= 200) note = it },
            singleLine = true,
            textStyle = LocalTextStyle.current.copy(fontSize = 14.sp, color = Handoff.Ink),
            cursorBrush = SolidColor(Handoff.Accent),
            modifier = Modifier.fillMaxWidth(),
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .clip(RoundedCornerShape(11.dp))
                        .background(Handoff.FieldWell)
                        .border(1.dp, Handoff.LineField, RoundedCornerShape(11.dp))
                        .padding(horizontal = 14.dp),
                    Alignment.CenterStart,
                ) {
                    if (note.isEmpty()) {
                        Text("Note (prints on the slip)", fontSize = 13.sp, color = Handoff.Muted3)
                    }
                    inner()
                }
            },
        )

        if (!shiftOpen) {
            Text(
                "Cash needs an open till — take card, or open first.",
                fontSize = 11.5.sp, color = Handoff.WarnText,
            )
        }
        if (!dateOk) {
            Text("The date should read YYYY-MM-DD.", fontSize = 11.5.sp, color = Handoff.WarnText)
        }

        // Money off needs a manager AT THE MOMENT it is committed — same rule,
        // and same shape, as a discounted sale.
        if (approvalNeeded) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFFEEEAFA))
                    .padding(horizontal = 14.dp, vertical = 11.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Text(
                    "Money off needs a manager",
                    fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF5B4B9E),
                )
                ManagerPicker(managers, managerId) { managerId = it }
                BasicTextField(
                    value = pin,
                    onValueChange = { if (it.length <= 4 && it.all(Char::isDigit)) pin = it },
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(fontSize = 15.sp, color = Handoff.Ink),
                    cursorBrush = SolidColor(Handoff.Accent),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        Box(Modifier.fillMaxWidth().height(44.dp), Alignment.CenterStart) {
                            if (pin.isEmpty()) {
                                Text("Manager PIN", fontSize = 13.sp, color = Handoff.Muted3)
                            }
                            inner()
                        }
                    },
                )
            }
        }

        error?.let {
            Text(it, fontSize = 12.sp, color = Color(0xFFB4552F))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            DialogButton("Back", Modifier.weight(1f).height(54.dp)) { onDismiss() }
            DialogButton(
                if (clamped > 0) "Take ${formatRs(clamped)} & open deposit" else "Open deposit (nothing down)",
                Modifier.weight(2f).height(54.dp),
                enabled = valid,
                solid = true,
            ) {
                onConfirm(
                    method,
                    clamped,
                    dateText.ifBlank { null },
                    note.trim().ifBlank { null },
                    if (approvalNeeded) Approval(managerId, pin) else null,
                )
            }
        }
    }
}

@Composable
private fun QuickAmount(label: String, onPick: () -> Unit) {
    Surface(
        onClick = onPick,
        shape = RoundedCornerShape(9.dp),
        color = Handoff.Well,
        contentColor = Handoff.Muted,
        border = androidx.compose.foundation.BorderStroke(1.dp, Handoff.LineSoft),
    ) {
        Text(
            label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

/** Same roster the discount prompt uses — stripped of any offline secret. */
@Composable
private fun ManagerPicker(
    managers: List<mu.kidscorner.till.data.Cashier>,
    currentId: String,
    onPick: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        managers.forEach { manager ->
            Surface(
                onClick = { onPick(manager.id) },
                shape = RoundedCornerShape(9.dp),
                color = if (manager.id == currentId) Color.White else Color(0xFFE3DDF6),
                contentColor = Color(0xFF5B4B9E),
            ) {
                Text(
                    manager.fullName,
                    fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                )
            }
        }
    }
}
