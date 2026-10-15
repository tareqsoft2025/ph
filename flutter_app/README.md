# PhotoSync Telegram (Flutter)

نسخة Flutter من التطبيق: ترسل صور الاستديو إلى بوت Telegram يدويًا أو تلقائيًا (WorkManager)، بواجهة عربية RTL.

## الميزات
- ربط البوت: Bot Token + Chat ID، اختبار الاتصال، اكتشاف Chat ID، رسالة اختبار. التوكن في تخزين مشفّر (Android Keystore) ولا يُسجَّل أبدًا.
- المعرض (photo_manager) مع ألبومات وتحديد متعدد ومعاينة، ومنتقي الصور الرسمي بدون أذونات.
- إرسال `sendPhoto`/`sendDocument` مع تقدّم وإيقاف وإعادة محاولة وحد الإرسال (429) ومنع التكرار.
- أتمتة: صور جديدة فقط، Wi-Fi فقط، فترة الفحص، إشعار دائم بزر إيقاف.
- سجل SQLite مع إعادة المحاولة والمسح.

## البناء
APK يُبنى تلقائيًا في GitHub Actions (`.github/workflows/build-apk.yml`) وينشر على:
`https://github.com/tareqsoft2025/ph/releases/download/latest-apk/photosync-telegram.apk`

محليًا (Flutter 3.24+ و Android SDK):
```bash
cd flutter_app
flutter create --platforms=android --org com.photosync --project-name photosync_telegram .
python3 tool/patch_android.py      # الصلاحيات + minSdk 23 + desugaring
flutter pub get && flutter test
flutter build apk --release        # build/app/outputs/flutter-apk/app-release.apk
```

## قيود
- الإرسال التلقائي تقريبي (≥15 دقيقة) وغير مضمون مع توفير البطارية/Doze.
- الأتمتة تعتمد على `createDateTime` للصورة مقارنةً بوقت التفعيل.
- حجم الملف يظهر في المعاينة فقط (الشبكة تعرض الأبعاد) لتجنب قراءة آلاف الملفات.
