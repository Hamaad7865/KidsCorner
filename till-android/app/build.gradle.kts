plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

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

android {
    namespace = "mu.kidscorner.till"
    compileSdk = 36

    defaultConfig {
        applicationId = "mu.kidscorner.till"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

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

    buildTypes {
        debug {
            // 10.0.2.2 is the emulator's route to the host machine, and 3001 is
            // the port in .claude/launch.json, so a debug build talks to
            // `npm run dev`. Release must be given a real HTTPS origin.
            buildConfigField("String", "API_ORIGIN", "\"http://10.0.2.2:3001\"")
            isDebuggable = true
        }
        release {
            buildConfigField("String", "API_ORIGIN", "\"https://kidscorner.mu\"")
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

    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.security.crypto)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    testImplementation(libs.junit)
}
