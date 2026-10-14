#!/usr/bin/env python3
"""يُشغَّل بعد `flutter create --platforms=android .` لضبط الصلاحيات وإعدادات Gradle."""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent / "android" / "app"

# ── AndroidManifest ─────────────────────────────────────────────────────────
mf = root / "src" / "main" / "AndroidManifest.xml"
text = mf.read_text(encoding="utf-8")
perms = """    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
"""
if "READ_MEDIA_IMAGES" not in text:
    text = text.replace("<application", perms + "    <application", 1)
text = re.sub(r'android:label="[^"]*"', 'android:label="PhotoSync Telegram"', text, count=1)
if "allowBackup" not in text:
    text = text.replace("<application", '<application android:allowBackup="false"', 1)
mf.write_text(text, encoding="utf-8")

# ── build.gradle (Groovy) أو build.gradle.kts ───────────────────────────────
g = root / "build.gradle"
kts = False
if not g.exists():
    g = root / "build.gradle.kts"
    kts = True
src = g.read_text(encoding="utf-8")

# minSdk 23 (flutter_secure_storage)
src = re.sub(r"minSdk(Version)?\s*=?\s*flutter\.minSdkVersion", "minSdk = 23" if kts else "minSdkVersion 23", src)

# desugaring (flutter_local_notifications)
if "coreLibraryDesugaringEnabled" not in src:
    flag = "isCoreLibraryDesugaringEnabled = true" if kts else "coreLibraryDesugaringEnabled true"
    src = re.sub(r"(compileOptions\s*\{)", r"\1\n        " + flag, src, count=1)
    dep = ('\ndependencies {\n    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")\n}\n' if kts
           else "\ndependencies {\n    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.0.4'\n}\n")
    src += dep
g.write_text(src, encoding="utf-8")
print("patched", mf, g)
