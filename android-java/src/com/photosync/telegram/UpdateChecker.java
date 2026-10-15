package com.photosync.telegram;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * يتحقق من توفر نسخة أحدث عبر ملف وصف صغير (update.json) في المستودع، ويعرض إشعارًا
 * يفتح رابط تنزيل الـAPK الجديد (المستخدم يثبّته يدويًا فوق النسخة الحالية، لأن التوقيع
 * نفسه محفوظ بين الإصدارات فلا حاجة لإلغاء التثبيت أولًا).
 * لا يُثبَّت أي شيء تلقائيًا دون علم المستخدم.
 */
final class UpdateChecker {
    /** JSON: {"versionCode": N, "versionName": "x.y.z", "url": "...", "notes": "..."} */
    static String manifestUrl = "https://raw.githubusercontent.com/tareqsoft2025/ph/claude/funny-gauss-3qf2tw/android-java/update.json";

    private UpdateChecker() {}

    interface Callback { void onResult(boolean hasUpdate, String versionName, String notes, String error); }

    /** يُنفَّذ في خيط خلفي ثم يستدعي cb على الخيط الرئيسي. */
    static void check(final Context ctx, final Callback cb) {
        final Context c = ctx.getApplicationContext();
        new Thread(new Runnable() {
            public void run() {
                String err = null;
                boolean update = false;
                String versionName = "", notes = "", url = "";
                try {
                    JSONObject j = new JSONObject(fetch(manifestUrl));
                    int remoteCode = j.getInt("versionCode");
                    versionName = j.optString("versionName", "");
                    notes = j.optString("notes", "");
                    url = j.optString("url", "");
                    int localCode = installedVersionCode(c);
                    update = remoteCode > localCode && !url.isEmpty();
                } catch (Exception e) {
                    err = "تعذّر التحقق من وجود تحديث";
                }
                if (update) Notifier.notifyUpdate(c, versionName, notes, url);
                if (cb != null) {
                    final boolean u = update;
                    final String vn = versionName, no = notes, e2 = err;
                    android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
                    main.post(new Runnable() { public void run() { cb.onResult(u, vn, no, e2); } });
                }
            }
        }, "update-check").start();
    }

    // minSdk هنا 29، لذا getLongVersionCode() متوفرة دائمًا (مضافة في API 28).
    static int installedVersionCode(Context c) {
        try {
            return (int) c.getPackageManager().getPackageInfo(c.getPackageName(), 0).getLongVersionCode();
        } catch (PackageManager.NameNotFoundException e) {
            return 0;
        }
    }

    static String installedVersionName(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "?";
        }
    }

    /** يفتح رابط التنزيل في المتصفح؛ لا نثبّت أي شيء مباشرة من داخل التطبيق. */
    static void openDownload(Context c, String url) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }

    private static String fetch(String urlStr) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(urlStr).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        try {
            InputStream in = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
            StringBuilder sb = new StringBuilder();
            BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            return sb.toString();
        } finally {
            c.disconnect();
        }
    }
}
