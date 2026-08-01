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

# ------------------------------------------------------- the sale queue
#
# `queued_sales` holds sales the shop has already been paid for and has not yet
# sent. The payload is JSON, written by one build of the app and read back by
# whichever build is running when the line returns — which, after an update, is a
# different one.
#
# kotlinx-serialization ships its own consumer rules, so the generated serializers
# survive R8 unaided. This keeps the FIELD NAMES of the classes that cross that
# boundary: an obfuscated field is a different JSON key, and a sale queued before
# an update would come back as a parse error afterwards. The money is already in
# the drawer by then, and there is no second chance to read it.
-keepclassmembers,allowobfuscation class mu.kidscorner.till.data.** {
    <fields>;
}
