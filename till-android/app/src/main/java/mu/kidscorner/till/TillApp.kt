package mu.kidscorner.till

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import okio.Path.Companion.toOkioPath

/**
 * The till's image loader, built here rather than left to Coil's defaults.
 *
 * Two reasons, both about this being a shop till rather than a phone app:
 *
 *   THE DISK CACHE IS THE POINT. The catalogue is cached on device so the
 *   counter keeps selling when the line drops, and a Browse screen full of grey
 *   squares on that morning would undo half of what the cache is for. 128 MB is
 *   generous for a few hundred garments and cheap on a tablet that does nothing
 *   else.
 *
 *   THE NETWORK FETCHER IS REGISTERED EXPLICITLY. Coil finds it through a
 *   ServiceLoader entry, which works — until R8 runs on a release build and
 *   removes a class nothing appears to reference. That failure mode is photos
 *   that work all through development and are simply absent in the shop, which
 *   is the worst kind. Naming the factory here means it cannot be shaken out.
 */
class TillApp : Application(), SingletonImageLoader.Factory {
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory()) }
            .diskCache {
                DiskCache.Builder()
                    // The app's own cache directory, named rather than taken
                    // from `java.io.tmpdir`: it is the same place, but this
                    // says so, and it is the directory Android clears first
                    // when the tablet runs short — which is correct for
                    // pictures and would not be for the sale queue.
                    .directory(context.cacheDir.resolve("kc_images").toOkioPath())
                    .maxSizeBytes(128L * 1024 * 1024)
                    .build()
            }
            // No fade. A tile that dissolves into place reads as "still
            // loading" to somebody deciding whether to tap it, and the sell
            // screen already spends its one animation on the scan landing.
            .crossfade(false)
            .build()
}
