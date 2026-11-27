plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.1.0"
    id("org.jetbrains.intellij.platform") version "2.5.0"
}

group = "com.tank4444"
version = "0.4.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.2.5")
    }
}

kotlin {
    jvmToolchain(21)
}

val syncWebviewDist by tasks.registering(Copy::class) {
    val distDir = file("../dist")
    from(distDir)
    into(layout.buildDirectory.dir("generated-webview/webview"))
    onlyIf { distDir.exists() }
}

sourceSets {
    main {
        resources {
            srcDir(layout.buildDirectory.dir("generated-webview"))
        }
    }
}

tasks {
    processResources {
        dependsOn(syncWebviewDist)
    }

    patchPluginXml {
        sinceBuild.set("242")
        untilBuild.set("261.*")
    }

    buildSearchableOptions {
        enabled = false
    }
}

