#!/usr/bin/env bash
# يبني APK موقّعًا بدون Gradle ولا Android SDK الكامل.
# المتطلبات (Ubuntu/Debian):  sudo apt install aapt apksigner zipalign dalvik-exchange default-jdk-headless
# ويحتاج android-all.jar (واجهات Android 14) من Maven Central — يُنزَّل تلقائيًا إن لم يوجد.
set -euo pipefail
cd "$(dirname "$0")"
JAR="${ANDROID_JAR:-build/android-all.jar}"
DX="${DX:-/usr/lib/android-sdk/build-tools/debian/dx}"
# رقم الإصدار ونصّه: ارفعهما مع كل تعديل تريد أن يصل كتحديث إلى الأجهزة المثبَّت عليها
# التطبيق (راجع update.json وonCheck في UpdateChecker.java).
VERSION_CODE="${VERSION_CODE:-2}"
VERSION_NAME="${VERSION_NAME:-1.1.0}"
if [ ! -f "src/com/photosync/telegram/Secrets.java" ]; then
  echo "لا يوجد src/com/photosync/telegram/Secrets.java — انسخ Secrets.java.example إليه وعدّل القيم." >&2
  exit 1
fi
OUT=build
mkdir -p "$OUT"
if [ ! -f "$JAR" ]; then
  echo "تنزيل android-all.jar ..."
  curl -fsSL -o "$JAR" "https://repo1.maven.org/maven2/org/robolectric/android-all/14-robolectric-10818077/android-all-14-robolectric-10818077.jar"
fi
rm -rf "$OUT/gen" "$OUT/classes" "$OUT/apk" && mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/apk"

aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$JAR" \
  --min-sdk-version 29 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" -F "$OUT/apk/unsigned.apk"
javac --release 8 -Xlint:-options -cp "$JAR" -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
"$DX" --dex --min-sdk-version=29 --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && cp apk/unsigned.apk apk/with-dex.apk && aapt add apk/with-dex.apk classes.dex >/dev/null)
zipalign -f 4 "$OUT/apk/with-dex.apk" "$OUT/apk/aligned.apk"

# مفتاح توقيع ثابت بين الإصدارات (مُتتبَّع في git، راجع debug-keystore.jks) حتى تُثبَّت
# كل نسخة جديدة فوق القديمة مباشرة دون الحاجة لإلغاء تثبيت التطبيق أولًا.
KS="${KEYSTORE:-debug-keystore.jks}"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias key -keyalg RSA -keysize 2048 \
    -validity 36500 -dname "CN=PhotoSync Debug" >/dev/null 2>&1
fi
apksigner sign --ks "$KS" --ks-pass pass:android --v1-signing-enabled true --v2-signing-enabled true \
  --out "$OUT/photosync-telegram.apk" "$OUT/apk/aligned.apk"
apksigner verify "$OUT/photosync-telegram.apk"
echo "OK -> $OUT/photosync-telegram.apk  (versionCode=$VERSION_CODE versionName=$VERSION_NAME)"
