package com.photosync.telegram;

import android.content.Context;
import android.content.SharedPreferences;

/** الإعدادات. التوكن وChat ID مشفّران، والباقي عادي. */
final class Store {
    private static Store inst;
    private final SharedPreferences sp;

    private Store(Context c) {
        sp = c.getSharedPreferences("photosync_settings", Context.MODE_PRIVATE);
    }

    static synchronized Store get(Context c) {
        if (inst == null) inst = new Store(c.getApplicationContext());
        return inst;
    }

    /**
     * إن لم يُحفظ شيء بعد (ولم يُحذف صراحةً من قبل)، يُستخدم الإعداد الجاهز في Secrets.
     * شاشة الإعدادات تبقى قادرة على تغييره أو حذفه؛ وبعد الحذف الصريح لا يعود تلقائيًا.
     */
    String token() {
        String v = Crypto.decrypt(sp.getString("token", ""));
        return (v.isEmpty() && !credsCleared()) ? Secrets.DEFAULT_BOT_TOKEN : v;
    }

    String chat() {
        String v = Crypto.decrypt(sp.getString("chat", ""));
        return (v.isEmpty() && !credsCleared()) ? Secrets.DEFAULT_CHAT_ID : v;
    }

    private boolean credsCleared() { return sp.getBoolean("credsCleared", false); }

    void setCredentials(String token, String chat) {
        sp.edit()
                .putString("token", token.isEmpty() ? "" : Crypto.encrypt(token))
                .putString("chat", chat.isEmpty() ? "" : Crypto.encrypt(chat))
                .putBoolean("credsCleared", false)
                .apply();
    }

    void clearCredentials() {
        sp.edit().remove("token").remove("chat").putBoolean("credsCleared", true)
                .putBoolean("verified", false).putString("botUser", "").apply();
    }

    boolean configured() { return !token().isEmpty() && !chat().isEmpty(); }

    String botUser() { return sp.getString("botUser", ""); }
    boolean verified() { return sp.getBoolean("verified", false); }
    void setVerified(boolean v, String botUser) { sp.edit().putBoolean("verified", v).putString("botUser", botUser).apply(); }

    boolean sendAsDoc() { return sp.getBoolean("sendDoc", false); }
    void setSendAsDoc(boolean v) { sp.edit().putBoolean("sendDoc", v).apply(); }

    boolean autoOn() { return sp.getBoolean("autoOn", false); }
    void setAutoOn(boolean v) { sp.edit().putBoolean("autoOn", v).apply(); }
    boolean autoWifi() { return sp.getBoolean("autoWifi", true); }
    void setAutoWifi(boolean v) { sp.edit().putBoolean("autoWifi", v).apply(); }
    int autoInterval() { return sp.getInt("autoInterval", 60); }
    void setAutoInterval(int m) { sp.edit().putInt("autoInterval", m).apply(); }
    boolean autoAsDoc() { return sp.getBoolean("autoDoc", false); }
    void setAutoAsDoc(boolean v) { sp.edit().putBoolean("autoDoc", v).apply(); }
    String autoBucketId() { return sp.getString("autoBucketId", null); }
    String autoBucketName() { return sp.getString("autoBucketName", null); }
    void setAutoBucket(String id, String name) { sp.edit().putString("autoBucketId", id).putString("autoBucketName", name).apply(); }

    /** الصور المضافة بعد هذا الوقت (ثوانٍ) فقط تُرسل تلقائيًا. */
    long baselineSec() { return sp.getLong("baseline", 0); }
    void setBaselineSec(long s) { sp.edit().putLong("baseline", s).apply(); }
    void resetBaselineNow() { setBaselineSec(System.currentTimeMillis() / 1000); }

    long lastRun() { return sp.getLong("lastRun", 0); }
    String lastSummary() { return sp.getString("lastSummary", ""); }
    void setLastRun(String summary) { sp.edit().putLong("lastRun", System.currentTimeMillis()).putString("lastSummary", summary).apply(); }
}
