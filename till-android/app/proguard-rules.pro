# R8 rules for the release till.
#
# Until now this file said "nothing app-specific yet", and that was true — because
# nobody had ever run `assembleRelease`. The first attempt failed outright, so the
# till could not be packaged for a shop at all. What follows is what R8 asked for,
# and nothing else.

# ---------------------------------------------------------------- Tink
#
# `androidx.security.crypto` encrypts the till's stored session. It pulls in
# Google Tink, which is annotated with Error Prone's compile-time annotations —
# `@CanIgnoreReturnValue` and friends. Those have CLASS retention and are
# deliberately not shipped at runtime, so R8 sees 50-odd dangling references and
# stops.
#
# `-dontwarn` rather than a keep rule: there is nothing to keep. The classes do
# not exist in any artifact and are not needed at runtime, so telling R8 to stop
# worrying is the whole fix. Listed one by one, exactly as R8 generated them,
# rather than as `com.google.errorprone.**` — a wildcard here would also silence
# a genuinely missing dependency later.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi

# ------------------------------------------------ kotlinx-serialization
#
# The comment here used to say the generated serializers "survive R8 unaided"
# because kotlinx-serialization ships consumer rules. That held under R8's legacy
# mode, but AGP 8 turns on R8 FULL mode, which is more aggressive: it drops the
# `Companion.serializer()` lookup the runtime uses to find a class's serializer.
# The first release build to actually reach the server proved it — every
# `/api/till/*` response is a 200, but the till decoded none of them and sat on
# "Offline", because the decode threw before the status was ever read. The debug
# build, unminified, parsed the identical bytes fine.
#
# These are the official kotlinx-serialization rules for R8 full mode: keep each
# @Serializable class's Companion and its `serializer()`, and the runtime
# annotations polymorphic decoding reads.
-keepattributes RuntimeVisibleAnnotations,AnnotationDefault

-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}

-if @kotlinx.serialization.Serializable class ** {
    static **$Companion Companion;
}
-keepclassmembers class <1>$Companion {
    kotlinx.serialization.KSerializer serializer(...);
}

-if @kotlinx.serialization.Serializable class ** {
    public static ** INSTANCE;
}
-keepclassmembers class <1> {
    public static <1> INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}

# The synthetic `$$serializer` R8 full mode would otherwise remove or rename.
-keepclasseswithmembers,includedescriptorclasses class mu.kidscorner.till.data.**$$serializer {
    *;
}

# ------------------------------------------------------- the sale queue
#
# `queued_sales` holds sales the shop has already been paid for and has not yet
# sent. The payload is JSON, written by one build of the app and read back by
# whichever build is running when the line returns — which, after an update, is a
# different one.
#
# This keeps the FIELD NAMES of the classes that cross that boundary: an
# obfuscated field is a different JSON key, and a sale queued before an update
# would come back as a parse error afterwards. The money is already in the drawer
# by then, and there is no second chance to read it.
-keepclassmembers,allowobfuscation class mu.kidscorner.till.data.** {
    <fields>;
}
