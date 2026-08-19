package mu.kidscorner.till.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.ui.theme.Handoff

/**
 * "Update to vX?" — offered only when [MainActivity] has already checked the
 * basket is empty; this dialog itself has no opinion on timing, only on the
 * two things a cashier can do once it is showing.
 */
@Composable
fun UpdateDialog(
    versionName: String,
    onInstall: () -> Unit,
    onDismiss: () -> Unit,
) {
    HandoffDialog(title = "Update available", width = 460, maxHeight = 260, onDismiss = onDismiss) {
        Column(Modifier.padding(20.dp)) {
            Text(
                "$versionName is ready to install. This takes a few seconds and " +
                    "the till reopens on this screen afterwards.",
                fontSize = 13.5.sp,
                color = Handoff.Muted2,
            )
            Row(
                Modifier.fillMaxWidth().padding(top = 18.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                HandoffButton(
                    label = "Later",
                    primary = false,
                    modifier = Modifier.weight(1f),
                    onClick = onDismiss,
                )
                HandoffButton(
                    label = "Install now",
                    modifier = Modifier.weight(1f),
                    onClick = onInstall,
                )
            }
        }
    }
}
