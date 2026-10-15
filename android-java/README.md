# PhotoSync Telegram — نسخة Java (APK جاهز)

تطبيق Android أصلي بلغة **Java** بدون Gradle ولا مكتبات خارجية، يُبنى بأدوات `aapt`/`dx`/`apksigner`.

**الملف الجاهز:** `dist/photosync-telegram.apk` (Android 10 فأحدث).

## التثبيت
1. انقل الملف إلى الهاتف وافتحه (اسمح بالتثبيت من مصدر غير معروف لهذا التطبيق).
2. الإعدادات داخل التطبيق: **الرئيسية ← إعداد Telegram** ← الصق Bot Token و Chat ID ← «اختبار الاتصال».
   - Token: من @BotFather (`/newbot`). Chat ID: افتح بوتك وأرسل `/start` ثم «اكتشاف Chat ID».

## الميزات
- معرض الصور (ألبومات، تحديد متعدد، معاينة، تاريخ وحجم) + منتقي الصور الرسمي بلا أذونات.
- إرسال `sendPhoto`/`sendDocument` مع تقدم وإيقاف وإعادة محاولة ومعالجة حد الإرسال ومنع التكرار.
- أتمتة (JobScheduler): صور جديدة فقط، Wi-Fi فقط، فترة الفحص، إشعار دائم بزر إيقاف.
- سجل SQLite مع إعادة المحاولة والمسح. التوكن مشفّر بـ Android Keystore ولا يُسجَّل.

## البناء من المصدر
```bash
sudo apt install aapt apksigner zipalign dalvik-exchange default-jdk-headless
./build.sh        # ينزّل android-all.jar ويُخرج build/photosync-telegram.apk
./test.sh         # اختبارات JVM لطبقة Telegram (junit4 + libandroid-json-org-java)
```

## قيود
- الإرسال التلقائي تقريبي (≥15 دقيقة) وغير مضمون مع Doze/توفير البطارية.
- الإرسال اليدوي يعمل ما دامت عملية التطبيق حية.
- موقّع بمفتاح تجريبي؛ APK بُني بمفتاح مختلف لا يُثبَّت فوق هذا (أزل القديم أولًا).
- لم يُشغَّل على جهاز/محاكي في بيئة التطوير؛ المتحقق منه: البناء والتوقيع وفحص البيان واختبارات Telegram.
