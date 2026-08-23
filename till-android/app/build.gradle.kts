plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

import java.util.Properties

/**
 * Supabase connection details, read from the web app's own `.env.local`.
 *
 * One source of truth on purpose: a till pointed at a different project than
 * the back office is a failure that looks like "no products" rather than like a
 * misconfiguration. Both values are public — the anon key is shipped in the web
 * bundle too and is guarded by RLS, not by secrecy.
 */
val webEnv: Map<String, String> = rootProject.file("../.env.local").let { file ->
    if (!file.exists()) emptyMap()
    else file.readLines()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("#") && it.contains("=") }
        .associate { line ->
            val key = line.substringBefore("=").trim()
            val value = line.substringAfter("=").trim().trim('"', '\'')
            key to value
        }
}

fun env(key: String): String =
    webEnv[key] ?: throw GradleException(
        "$key is missing from .env.local at the repository root. " +
            "The till reads Supabase details from the same file the web app does.",
    )

/**
 * Where the till reaches its own API — the Next.js `/api/till` routes, distinct
 * from Supabase auth. Overridable with `-PapiOrigin=https://…` or an `apiOrigin`
 * line in gradle.properties, so a debug APK on a real tablet can point at the
 * live deployment without a dev server, while a plain emulator build keeps its
 * localhost default. Falls back to the argument when nothing is set.
 */
fun apiOrigin(fallback: String): String =
    (project.findProperty("apiOrigin") as String?)?.trim()?.takeIf { it.isNotEmpty() }
        ?: fallback

/**
 * The release signing key, read from `app/keystore.properties` — gitignored,
 * because the keystore's passwords are exactly as sensitive as the keystore
 * file itself. The `.jks` it points at lives outside this repo entirely.
 *
 * Every release build must be signed with the same key from here on, or
 * Android refuses to install it over whatever the previous release put there
 * — the whole point of AppUpdater existing is that this stops being true.
 * A missing file fails `assembleRelease` outright rather than silently
 * falling back to an unsigned or differently-signed build, which is exactly
 * the ambiguity that made every release this project shipped before this one
 * need a manual uninstall first.
 */
val keystoreProperties = Properties().apply {
    val file = project.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "mu.kidscorner.till"
    compileSdk = 36

    defaultConfig {
        applicationId = "mu.kidscorner.till"
        minSdk = 26
        targetSdk = 36
        versionCode = 13
        versionName = "0.12.0"

        buildConfigField("String", "SUPABASE_URL", "\"${env("NEXT_PUBLIC_SUPABASE_URL")}\"")
        buildConfigField(
            "String",
            "SUPABASE_ANON_KEY",
            "\"${env("NEXT_PUBLIC_SUPABASE_ANON_KEY")}\"",
        )
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Room writes the schema here on every build. Committed, so the next schema
    // change can be diffed and given a real migration — the queue table holds
    // money and must never be dropped to satisfy a version bump.
    ksp { arg("room.schemaLocation", "$projectDir/schemas") }

    signingConfigs {
        create("release") {
            if (keystoreProperties.isEmpty) return@create
            storeFile = file(keystoreProperties.getProperty("storeFile"))
            storePassword = keystoreProperties.getProperty("storePassword")
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
        }
    }

    buildTypes {
        debug {
            // Default: 10.0.2.2 is the emulator's route to the host machine and
            // 3001 the port in .claude/launch.json, so a plain debug build talks
            // to `npm run dev`. The `apiOrigin` property (set in gradle.properties
            // to the live deployment) overrides this, so a debug APK sideloaded
            // onto a real tablet reaches production without a dev server.
            buildConfigField("String", "API_ORIGIN", "\"${apiOrigin("http://10.0.2.2:3001")}\"")
            isDebuggable = true
        }
        release {
            // The live deployment. Replace with a first-party domain once one is
            // set up; the `apiOrigin` property overrides this too.
            buildConfigField(
                "String",
                "API_ORIGIN",
                "\"${apiOrigin("https://kidscorner.boodoo-sheik786.workers.dev")}\"",
            )
            if (keystoreProperties.isEmpty) {
                throw GradleException(
                    "app/keystore.properties is missing, so this release build cannot be " +
                        "signed with the till's real release key. Every release must share one " +
                        "key or updates cannot install over each other. This is deliberate: a " +
                        "silent fallback here is how the till ended up needing a manual " +
                        "uninstall before every previous release.",
                )
            }
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.kotlinx.serialization.json)

    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.security.crypto)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    testImplementation(libs.junit)
}
