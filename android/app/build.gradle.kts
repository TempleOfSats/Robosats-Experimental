import org.jetbrains.kotlin.gradle.dsl.JvmTarget

val packageVersion = Regex("\\\"version\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"")
    .find(rootProject.file("../package.json").readText())
    ?.groupValues
    ?.get(1)
    ?: error("package.json does not define a version")

fun mobileVersionCode(version: String): Int {
    val match = Regex("""^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$""").matchEntire(version)
        ?: error("Unsupported release version: $version")
    val (majorText, minorText, patchText, channel, sequenceText) = match.destructured
    val major = majorText.toInt()
    val minor = minorText.toInt()
    val patch = patchText.toInt()
    val sequence = sequenceText.toIntOrNull() ?: 0
    require(major <= 20 && minor <= 99 && patch <= 99 && sequence <= 999) {
        "Release version exceeds the mobile version-code range: $version"
    }
    val channelOffset = when (channel) {
        "alpha" -> 1_000
        "beta" -> 4_000
        "rc" -> 7_000
        else -> 9_999
    }
    return (major * 100_000_000) + (minor * 1_000_000) + (patch * 10_000) + channelOffset + sequence
}

val appVersionName = providers.environmentVariable("ROBOSATS_VERSION_NAME")
    .orElse(providers.gradleProperty("robosatsVersionName"))
    .orElse(packageVersion)
    .get()
val appVersionCode = providers.environmentVariable("ROBOSATS_VERSION_CODE")
    .orElse(providers.gradleProperty("robosatsVersionCode"))
    .map(String::toInt)
    .getOrElse(mobileVersionCode(appVersionName))
val releaseStoreFile = providers.environmentVariable("ROBOSATS_ANDROID_KEYSTORE_FILE").orNull
val releaseStorePassword = providers.environmentVariable("ROBOSATS_ANDROID_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("ROBOSATS_ANDROID_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("ROBOSATS_ANDROID_KEY_PASSWORD").orNull

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

base {
    archivesName.set("robosats-exp")
}

android {
    namespace = "com.robosats"
    compileSdk = 36
    ndkVersion = "27.0.12077973"

    defaultConfig {
        applicationId = "com.robosats.exp"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
    }

    signingConfigs {
        if (
            releaseStoreFile != null &&
            releaseStorePassword != null &&
            releaseKeyAlias != null &&
            releaseKeyPassword != null
        ) {
            create("release") {
                storeFile = file(releaseStoreFile)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "x86_64")
            isUniversalApk = true
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = false
            excludes += setOf(
                "**/armeabi/**",
                "**/armeabi-v7a/**",
                "**/mips/**",
                "**/mips64/**",
                "**/x86/**"
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.okhttp)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.secp256k1.android)
    implementation(libs.lazysodium.android) {
        exclude(group = "net.java.dev.jna", module = "jna")
    }
    implementation(libs.quartz) {
        exclude("net.java.dev.jna")
    }
    implementation(libs.ammolite) {
        exclude("net.java.dev.jna")
    }
    implementation(libs.jna) { artifact { type = "aar" } }
    implementation(libs.security.crypto.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)
}
