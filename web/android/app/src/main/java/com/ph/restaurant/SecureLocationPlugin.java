package com.ph.restaurant;

import android.Manifest;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * قراءة موقع موثوقة لتسجيل الحضور:
 * - موقع جديد من GPS/الشبكة (لا يُقبل موقع مخزّن)
 * - كشف المواقع الوهمية (Mock / Fake GPS)
 * - كشف المحاكي والأجهزة المكسورة الحماية (Root)
 * - معرّف ثابت للجهاز لربط الحضور بجهاز الموظف
 */
@CapacitorPlugin(
    name = "SecureLocation",
    permissions = { @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }) }
)
public class SecureLocationPlugin extends Plugin {

    @PluginMethod
    public void getPosition(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "permissionCallback");
            return;
        }
        fetch(call);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) fetch(call);
        else call.reject("يجب السماح بتحديد الموقع", "permission_denied");
    }

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("deviceId", deviceId());
        ret.put("emulator", isEmulator());
        ret.put("rooted", isRooted());
        call.resolve(ret);
    }

    private void fetch(PluginCall call) {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean gps = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        boolean net = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        if (!gps && !net) {
            call.reject("خدمة الموقع متوقفة، فعّل GPS", "location_disabled");
            return;
        }
        final AtomicBoolean done = new AtomicBoolean(false);
        final Handler handler = new Handler(Looper.getMainLooper());
        final LocationListener[] listeners = new LocationListener[2];

        final java.util.function.Consumer<Location> finish = (loc) -> {
            if (loc == null || !done.compareAndSet(false, true)) return;
            for (LocationListener l : listeners) if (l != null) try { lm.removeUpdates(l); } catch (Exception ignored) {}
            boolean mock = Build.VERSION.SDK_INT >= 31 ? loc.isMock() : loc.isFromMockProvider();
            long ageMs = (SystemClock.elapsedRealtimeNanos() - loc.getElapsedRealtimeNanos()) / 1_000_000L;
            JSObject ret = new JSObject();
            ret.put("lat", loc.getLatitude());
            ret.put("lng", loc.getLongitude());
            ret.put("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : 9999);
            ret.put("provider", loc.getProvider());
            ret.put("mock", mock);
            ret.put("ageMs", ageMs);
            ret.put("deviceId", deviceId());
            ret.put("emulator", isEmulator());
            ret.put("rooted", isRooted());
            call.resolve(ret);
        };

        // نطلب قراءة جديدة من كل مزود متاح ونأخذ أول نتيجة دقيقة (GPS أولاً)
        String[] providers = gps && net ? new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }
            : new String[] { gps ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER };
        try {
            for (int i = 0; i < providers.length; i++) {
                final String p = providers[i];
                listeners[i] = new LocationListener() {
                    @Override public void onLocationChanged(Location location) {
                        // نتجاهل قراءة الشبكة الضعيفة جداً إن كان GPS لا يزال يعمل
                        if (LocationManager.NETWORK_PROVIDER.equals(p) && location.getAccuracy() > 200 && providers.length > 1) return;
                        finish.accept(location);
                    }
                    @Override public void onStatusChanged(String s, int i, Bundle b) {}
                    @Override public void onProviderEnabled(String s) {}
                    @Override public void onProviderDisabled(String s) {}
                };
                lm.requestLocationUpdates(p, 0L, 0f, listeners[i], Looper.getMainLooper());
            }
        } catch (SecurityException e) {
            call.reject("يجب السماح بتحديد الموقع", "permission_denied");
            return;
        }
        handler.postDelayed(() -> {
            if (done.get()) return;
            // آخر محاولة: قراءة الشبكة حتى لو ضعيفة، ثم الرفض
            Location best = null;
            try { best = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER); } catch (SecurityException ignored) {}
            if (best != null && (SystemClock.elapsedRealtimeNanos() - best.getElapsedRealtimeNanos()) / 1_000_000L < 60_000L) {
                finish.accept(best);
            } else if (done.compareAndSet(false, true)) {
                for (LocationListener l : listeners) if (l != null) try { lm.removeUpdates(l); } catch (Exception ignored) {}
                call.reject("تعذّر تحديد موقعك، انتقل لمكان مفتوح وحاول مجدداً", "no_fix");
            }
        }, 20000);
    }

    private String deviceId() {
        String id = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);
        return id == null ? "" : "android-" + id;
    }

    private boolean isEmulator() {
        String fp = Build.FINGERPRINT == null ? "" : Build.FINGERPRINT;
        String model = Build.MODEL == null ? "" : Build.MODEL;
        String hw = Build.HARDWARE == null ? "" : Build.HARDWARE;
        return fp.startsWith("generic") || fp.contains("emulator") || fp.contains("vbox") || fp.contains("test-keys") && fp.contains("generic")
            || model.contains("Emulator") || model.contains("Android SDK built for")
            || hw.contains("goldfish") || hw.contains("ranchu") || hw.contains("vbox86")
            || (Build.BRAND != null && Build.BRAND.startsWith("generic") && Build.DEVICE != null && Build.DEVICE.startsWith("generic"))
            || "google_sdk".equals(Build.PRODUCT) || (Build.PRODUCT != null && (Build.PRODUCT.contains("sdk_gphone") || Build.PRODUCT.contains("emulator")));
    }

    private boolean isRooted() {
        String[] paths = { "/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/app/Superuser.apk", "/data/local/xbin/su",
            "/data/local/bin/su", "/system/sd/xbin/su", "/data/adb/magisk", "/system/bin/.ext/su", "/su/bin/su" };
        for (String p : paths) if (new File(p).exists()) return true;
        String tags = Build.TAGS;
        return tags != null && tags.contains("test-keys");
    }
}
