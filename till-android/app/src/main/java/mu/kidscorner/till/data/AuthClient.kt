package mu.kidscorner.till.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import mu.kidscorner.till.BuildConfig

/**
 * The device's own sign-in, straight to Supabase Auth.
 *
 * This is the one thing the till does NOT route through the Next app. Password
 * grant and refresh are GoTrue's job, and proxying them would mean the shop's
 * password passing through a second server for no gain.
 *
 * Note the two identities in play. This is the *device* — one shared account
 * the owner signs in once, on setup. Which cashier is at the till is a separate,
 * PIN-gated thing that changes many times a day and never touches this.
 */

@Serializable
data class AuthSession(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_in") val expiresIn: Long = 3600,
) {
    /** Epoch seconds, stamped on receipt — GoTrue returns a duration, not a time. */
    val expiresAt: Long get() = System.currentTimeMillis() / 1000 + expiresIn
}

@Serializable
private data class AuthError(
    val error: String? = null,
    @SerialName("error_description") val errorDescription: String? = null,
    val msg: String? = null,
    val message: String? = null,
) {
    fun readable(): String? =
        errorDescription?.takeIf { it.isNotBlank() }
            ?: msg?.takeIf { it.isNotBlank() }
            ?: message?.takeIf { it.isNotBlank() }
            ?: error?.takeIf { it.isNotBlank() }
}

@Serializable
private data class PasswordGrant(val email: String, val password: String)

@Serializable
private data class RefreshGrant(@SerialName("refresh_token") val refreshToken: String)

class AuthClient(private val http: HttpClient) {

    private val tokenUrl = "${BuildConfig.SUPABASE_URL}/auth/v1/token"

    suspend fun signIn(email: String, password: String): Result<AuthSession> =
        grant("password", PasswordGrant(email.trim(), password))

    suspend fun refresh(refreshToken: String): Result<AuthSession> =
        grant("refresh_token", RefreshGrant(refreshToken))

    private suspend inline fun <reified T> grant(type: String, body: T): Result<AuthSession> =
        runCatching {
            val response = http.post("$tokenUrl?grant_type=$type") {
                header("apikey", BuildConfig.SUPABASE_ANON_KEY)
                contentType(ContentType.Application.Json)
                setBody(body)
            }

            if (response.status == HttpStatusCode.OK) {
                response.body<AuthSession>()
            } else {
                // GoTrue's error shape has changed across versions, so the text
                // is parsed leniently and the status is the fallback. A sign-in
                // screen that says "400" helps nobody.
                val detail = runCatching {
                    lenient.decodeFromString<AuthError>(response.bodyAsText()).readable()
                }.getOrNull()

                error(
                    detail ?: when (response.status) {
                        HttpStatusCode.BadRequest,
                        HttpStatusCode.Unauthorized,
                        -> "That email and password did not match."
                        else -> "Could not sign in (${response.status.value})."
                    },
                )
            }
        }

    private companion object {
        val lenient = Json { ignoreUnknownKeys = true; isLenient = true }
    }
}
