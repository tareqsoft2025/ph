#!/usr/bin/env bash
# إصدار جديد: يبني الواجهة والنسخة التجريبية وتطبيق الأندرويد، ثم يضع الـ APK في apk/ و docs/apk/
# الاستخدام:  bash scripts/release.sh            (يرفع الإصدار تلقائياً)
#             bash scripts/release.sh --no-bump  (بدون رفع رقم الإصدار)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRADLE="$ROOT/web/android/app/build.gradle"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"

if [[ "${1:-}" != "--no-bump" ]]; then
  code=$(grep -oE 'versionCode [0-9]+' "$GRADLE" | grep -oE '[0-9]+')
  name=$(grep -oE 'versionName "[^"]+"' "$GRADLE" | grep -oE '[0-9]+\.[0-9]+')
  major=${name%%.*}; minor=${name##*.}
  sed -i "s/versionCode $code/versionCode $((code + 1))/; s/versionName \"$name\"/versionName \"$major.$((minor + 1))\"/" "$GRADLE"
fi
code=$(grep -oE 'versionCode [0-9]+' "$GRADLE" | grep -oE '[0-9]+')
name=$(grep -oE 'versionName "[^"]+"' "$GRADLE" | grep -oE '[0-9]+\.[0-9]+')

cd "$ROOT/web"
npm run build
npm run deploy:demo          # النسخة التجريبية في docs/
npx cap sync android
(cd android && ./gradlew assembleRelease --no-daemon -q)

APK="$ROOT/web/android/app/build/outputs/apk/release/app-release.apk"
for dir in "$ROOT/apk" "$ROOT/docs/apk"; do
  mkdir -p "$dir"
  cp "$APK" "$dir/restaurant-app.apk"
  printf '{"version":"%s","code":%s,"size":%s,"date":"%s","file":"restaurant-app.apk"}\n' \
    "$name" "$code" "$(stat -c %s "$APK")" "$(date +%F)" > "$dir/version.json"
done
echo "✅ الإصدار $name ($code) جاهز في apk/ و docs/apk/"
