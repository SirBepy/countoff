import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val ksBase64 = System.getenv("ANDROID_KEYSTORE_BASE64")
val ksStorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val ksKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
val ksKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")
val hasSigningSecrets = !ksBase64.isNullOrBlank() && !ksStorePassword.isNullOrBlank() &&
    !ksKeyAlias.isNullOrBlank() && !ksKeyPassword.isNullOrBlank()

// Decoded once at configuration time so signingConfigs and the fail-fast
// check below see the same file without re-decoding per task.
val decodedKeystore = if (hasSigningSecrets) {
    layout.buildDirectory.file("release.keystore").get().asFile.apply {
        parentFile.mkdirs()
        writeBytes(Base64.getDecoder().decode(ksBase64))
    }
} else null

android {
    namespace = "dev.sirbepy.countoff"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.sirbepy.countoff"
        // Credential Manager's play-services-auth artifact requires 23; 21 fails the manifest merge.
        minSdk = 23
        targetSdk = 35
        versionCode = 2
        versionName = "0.1.1"
    }

    signingConfigs {
        if (decodedKeystore != null) {
            create("release") {
                storeFile = decodedKeystore
                storePassword = ksStorePassword
                keyAlias = ksKeyAlias
                keyPassword = ksKeyPassword
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
    kotlinOptions {
        jvmTarget = "17"
    }
}

// Runs before any task executes, so a missing keystore fails the build up
// front instead of letting packageRelease silently produce an unsigned APK.
gradle.taskGraph.whenReady {
    val buildingRelease = allTasks.any { it.name == "assembleRelease" || it.name == "packageRelease" }
    if (buildingRelease && !hasSigningSecrets) {
        throw GradleException(
            "Release signing needs ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, " +
                "ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD as env vars."
        )
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")
}
