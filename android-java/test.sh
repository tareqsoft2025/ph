#!/usr/bin/env bash
# اختبارات JVM لطبقة Telegram:  sudo apt install junit4 libandroid-json-org-java default-jdk-headless
set -euo pipefail
cd "$(dirname "$0")"
CP=/usr/share/java/junit4.jar:/usr/share/java/hamcrest-core.jar:/usr/share/java/json-android.jar
rm -rf build/test && mkdir -p build/test
javac -cp "$CP" -d build/test src/com/photosync/telegram/Telegram.java test/com/photosync/telegram/TelegramTest.java
java -cp "build/test:$CP" org.junit.runner.JUnitCore com.photosync.telegram.TelegramTest
