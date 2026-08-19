package mu.kidscorner.till.data

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * Downloads and installs the till's own update APK.
 *
 * `DownloadManager` does the fetch — it survives the app being backgrounded
 * or killed mid-download, retries transient failures, and needs no Ktor
 * plumbing for a job that can take a while on a shop's own Wi-Fi. This class
 * only tracks which job belongs to which version and turns a finished
 * download into an install [Intent]; [TillViewModel] owns *when* that intent
 * is safe to fire (never mid-sale — see its own polling of [poll]).
 *
 * The file lands in this app's private external-files "Download" directory,
 * which needs no storage permission, and [FileProvider] (declared in the
 * manifest, scoped to exactly that directory) is what turns it into a
 * `content://` URI the system installer is allowed to open — a bare `file://`
 * URI crossing that boundary throws `FileUriExposedException` since Nougat.
 */
class AppUpdater(private val context: Context) {

    private val downloadManager = context.getSystemService(DownloadManager::class.java)
    private var enqueuedId: Long? = null
    private var enqueuedVersionCode: Long? = null

    private val destinationFile: File
        get() = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FILE_NAME)

    /**
     * Starts the download, unless this exact version is already in flight or
     * already finished — repeated heartbeats must not queue the same file
     * over and over while a cashier is mid-shift.
     */
    fun start(versionCode: Long, apkUrl: String) {
        if (enqueuedVersionCode == versionCode) return

        destinationFile.delete() // A stale file from an older, abandoned attempt.
        val request = DownloadManager.Request(Uri.parse(apkUrl))
            .setTitle("Kids Corner Till update")
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, FILE_NAME)
            // The system's own download notification would sit in the tray
            // for however long a shop's connection takes — this has its own,
            // quieter indicator on the sync pill instead.
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN)

        enqueuedId = downloadManager.enqueue(request)
        enqueuedVersionCode = versionCode
    }

    /**
     * Polled from the same heartbeat that calls [start] — no broadcast
     * receiver, matching how the rest of the till already prefers polling
     * ([mu.kidscorner.till.TillViewModel.startQueuePump]) over registering
     * for system callbacks.
     */
    fun poll(): DownloadState {
        val id = enqueuedId ?: return DownloadState.None
        val cursor = downloadManager.query(DownloadManager.Query().setFilterById(id))
        cursor.use {
            if (!it.moveToFirst()) return DownloadState.None
            val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            return when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> DownloadState.Ready(uriFor(destinationFile))
                DownloadManager.STATUS_FAILED -> {
                    // Cleared so the next heartbeat's version check retries
                    // from scratch rather than being stuck reporting Failed.
                    enqueuedId = null
                    enqueuedVersionCode = null
                    DownloadState.Failed
                }
                else -> DownloadState.InProgress
            }
        }
    }

    /** Whether this device currently permits installing from this app. */
    fun canInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Sends the cashier to the one-time "allow installs from this app" toggle. */
    fun requestInstallPermissionIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** The install prompt itself, once [canInstall] is true and a file is [DownloadState.Ready]. */
    fun installIntent(apkUri: Uri): Intent =
        Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

    private fun uriFor(file: File): Uri =
        FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

    private companion object {
        const val FILE_NAME = "till-update.apk"
    }
}

sealed interface DownloadState {
    data object None : DownloadState
    data object InProgress : DownloadState
    data class Ready(val apkUri: Uri) : DownloadState
    data object Failed : DownloadState
}
