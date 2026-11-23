import java.util.Properties

plugins {
    id("com.android.application")
}

// The release key lives outside git (local/, see .gitignore); android/keystore.properties says where.
val signing = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "app.minihub.phone"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.minihub.phone"
        minSdk = 33
        targetSdk = 36
        versionCode = 5
        versionName = "0.5.0"
        // The owner's phone (and every phone this app targets) is 64-bit ARM; leaving the others out keeps the app small.
        ndk { abiFilters += listOf("arm64-v8a") }
        // On-device tests run in the trial build only, never in the owner's app.
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            if (signing.isNotEmpty()) {
                storeFile = rootProject.file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        // A trial build installs beside the owner's app (its own id), for trials such as T3 with made-up data.
        debug {
            applicationIdSuffix = ".trial"
        }
        release {
            isMinifyEnabled = false
            isDebuggable = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// The look's colours come from design/tokens.json; the build stops if Tokens.kt was not regenerated (npm run tokens).
val tokensCheck by tasks.registering(Exec::class) {
    workingDir = rootProject.file("..")
    commandLine(if (System.getProperty("os.name").startsWith("Windows")) listOf("cmd", "/c", "node", "tools/tokens.mjs", "--check") else listOf("node", "tools/tokens.mjs", "--check"))
}
tasks.named("preBuild") { dependsOn(tokensCheck) }

dependencies {
    // The record, encrypted (docs/08 > The record); its key is wrapped by the Android Keystore.
    implementation("net.zetetic:sqlcipher-android:4.20.0@aar")
    implementation("androidx.sqlite:sqlite:2.7.0")
    // The device link: a WebSocket over TLS with the hub's pinned certificate.
    implementation("com.squareup.okhttp3:okhttp:5.4.0")
    // Scanning the pairing code, on the phone only.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    // Android's own org.json is a stub on the JVM; the real one for unit tests.
    testImplementation("org.json:json:20240303")
}
