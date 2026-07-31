package mu.kidscorner.till.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mu.kidscorner.till.ui.theme.Handoff

/**
 * One-time device setup, done by the owner when the tablet is installed.
 *
 * This is NOT the daily sign-in — that is the PIN keypad. This account is the
 * device itself, and once it is signed in the token is refreshed silently and
 * this screen is not seen again. Which is the point: a shop worker should never
 * be asked for an email and password across a counter.
 *
 * Built on `atOpenShift`'s card — 520px, radius 18, `padding:24px 26px 26px` —
 * because it is the same shape of moment: one figure or one credential, typed
 * once, before the till can be used.
 */
@Composable
fun DeviceSetupScreen(
    busy: Boolean,
    error: String?,
    onSignIn: (String, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var revealed by remember { mutableStateOf(false) }

    val ready = !busy && email.isNotBlank() && password.isNotBlank()
    val submit = { if (ready) onSignIn(email.trim(), password) }

    Box(modifier.fillMaxSize().background(Handoff.Canvas).padding(20.dp), Alignment.Center) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = Handoff.Surface,
            border = BorderStroke(1.dp, Handoff.LineSoft),
            shadowElevation = 12.dp,
            modifier = Modifier.width(520.dp),
        ) {
            Column(
                Modifier.padding(start = 26.dp, end = 26.dp, top = 24.dp, bottom = 26.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                KcMark()

                Text(
                    "Set up this till",
                    fontSize = 19.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.38).sp,
                    color = Handoff.Ink,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Text(
                    "Sign in once with the shop's account. Staff use their PIN after this.",
                    fontSize = 12.5.sp,
                    color = Handoff.Muted3,
                    modifier = Modifier.padding(bottom = 6.dp),
                )

                FieldLabel("Email")
                HandoffField(
                    value = email,
                    onValueChange = { email = it },
                    placeholder = "owner@shop.mu",
                    keyboard = KeyboardType.Email,
                    enabled = !busy,
                    imeAction = ImeAction.Next,
                )

                FieldLabel("Password")
                HandoffField(
                    value = password,
                    onValueChange = { password = it },
                    placeholder = "••••••••",
                    keyboard = KeyboardType.Password,
                    enabled = !busy,
                    masked = !revealed,
                    imeAction = ImeAction.Done,
                    onImeAction = submit,
                    trailing = {
                        Surface(
                            onClick = { revealed = !revealed },
                            shape = RoundedCornerShape(10.dp),
                            color = Color.Transparent,
                            contentColor = Handoff.Muted4,
                            modifier = Modifier.size(44.dp),
                        ) {
                            Box(Modifier.fillMaxSize(), Alignment.Center) {
                                Icon(
                                    if (revealed) Icons.Default.VisibilityOff
                                    else Icons.Default.Visibility,
                                    if (revealed) "Hide password" else "Show password",
                                    Modifier.size(19.dp),
                                )
                            }
                        }
                    },
                )

                if (error != null) {
                    Text(
                        error,
                        fontSize = 12.5.sp,
                        color = Handoff.Danger,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }

                Surface(
                    onClick = submit,
                    enabled = ready,
                    shape = RoundedCornerShape(14.dp),
                    color = if (ready) Handoff.AccentSolid else Handoff.Blocked,
                    contentColor = if (ready) Color.White else Handoff.BlockedText,
                    shadowElevation = if (ready) 6.dp else 0.dp,
                    modifier = Modifier.fillMaxWidth().height(68.dp).padding(top = 4.dp),
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        if (busy) {
                            CircularProgressIndicator(Modifier.size(24.dp), Color.White, 2.dp)
                        } else {
                            Text(
                                if (ready) "Sign in" else "Email and password",
                                fontSize = if (ready) 18.sp else 15.5.sp,
                                fontWeight = if (ready) FontWeight.Bold else FontWeight.SemiBold,
                            )
                        }
                    }
                }

                Text(
                    "The password is sent to the shop's own server and is never stored " +
                        "on this tablet — only the token it hands back.",
                    fontSize = 11.5.sp,
                    color = Handoff.Muted4,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(top = 5.dp),
                )
            }
        }
    }
}
