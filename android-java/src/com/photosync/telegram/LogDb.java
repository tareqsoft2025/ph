package com.photosync.telegram;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.Handler;
import android.os.Looper;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;

/** سجل الإرسال (SQLite). pkey فريد: لا تُسجَّل الصورة نفسها مرتين. */
final class LogDb extends SQLiteOpenHelper {
    static final String PENDING = "pending", SUCCESS = "success", FAILED = "failed";
    private static final String T = "send_log";
    private static LogDb inst;
    private static final List<Runnable> listeners = new CopyOnWriteArrayList<>();
    private static final Handler main = new Handler(Looper.getMainLooper());

    static final class Entry {
        long id, size, updatedAt;
        String key, name, mime, status, error;
        int attempts;
        boolean asDoc, auto;
    }

    private LogDb(Context c) { super(c, "photosync.db", null, 1); }

    static synchronized LogDb get(Context c) {
        if (inst == null) inst = new LogDb(c.getApplicationContext());
        return inst;
    }

    static void addListener(Runnable r) { listeners.add(r); }
    static void removeListener(Runnable r) { listeners.remove(r); }

    private static void changed() {
        for (final Runnable r : listeners) main.post(r);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + T + "(id INTEGER PRIMARY KEY AUTOINCREMENT, pkey TEXT NOT NULL UNIQUE, "
                + "name TEXT NOT NULL, mime TEXT, size INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, "
                + "attempts INTEGER NOT NULL DEFAULT 0, as_doc INTEGER NOT NULL DEFAULT 0, auto INTEGER NOT NULL DEFAULT 0, "
                + "updated_at INTEGER NOT NULL)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int o, int n) {}

    private static Entry read(Cursor c) {
        Entry e = new Entry();
        e.id = c.getLong(c.getColumnIndexOrThrow("id"));
        e.key = c.getString(c.getColumnIndexOrThrow("pkey"));
        e.name = c.getString(c.getColumnIndexOrThrow("name"));
        e.mime = c.getString(c.getColumnIndexOrThrow("mime"));
        e.size = c.getLong(c.getColumnIndexOrThrow("size"));
        e.status = c.getString(c.getColumnIndexOrThrow("status"));
        e.error = c.getString(c.getColumnIndexOrThrow("error"));
        e.attempts = c.getInt(c.getColumnIndexOrThrow("attempts"));
        e.asDoc = c.getInt(c.getColumnIndexOrThrow("as_doc")) == 1;
        e.auto = c.getInt(c.getColumnIndexOrThrow("auto")) == 1;
        e.updatedAt = c.getLong(c.getColumnIndexOrThrow("updated_at"));
        return e;
    }

    synchronized Entry find(String key) {
        try (Cursor c = getReadableDatabase().query(T, null, "pkey=?", new String[]{key}, null, null, null, "1")) {
            return c.moveToFirst() ? read(c) : null;
        }
    }

    synchronized void upsert(Entry e) {
        ContentValues v = new ContentValues();
        v.put("pkey", e.key);
        v.put("name", e.name);
        v.put("mime", e.mime);
        v.put("size", e.size);
        v.put("status", e.status);
        v.put("error", e.error);
        v.put("attempts", e.attempts);
        v.put("as_doc", e.asDoc ? 1 : 0);
        v.put("auto", e.auto ? 1 : 0);
        v.put("updated_at", e.updatedAt);
        SQLiteDatabase db = getWritableDatabase();
        if (db.update(T, v, "pkey=?", new String[]{e.key}) == 0) db.insert(T, null, v);
        changed();
    }

    synchronized List<Entry> all() {
        List<Entry> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().query(T, null, null, null, null, null, "updated_at DESC")) {
            while (c.moveToNext()) out.add(read(c));
        }
        return out;
    }

    synchronized int count(String status) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM " + T + " WHERE status=?", new String[]{status})) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    synchronized Set<String> successKeys() {
        Set<String> s = new HashSet<>();
        try (Cursor c = getReadableDatabase().query(T, new String[]{"pkey"}, "status=?", new String[]{SUCCESS}, null, null, null)) {
            while (c.moveToNext()) s.add(c.getString(0));
        }
        return s;
    }

    /** مفاتيح يجب ألا يعيد الإرسال التلقائي إرسالها الآن. */
    synchronized Set<String> blockedKeys(List<String> keys, int maxAttempts) {
        Set<String> blocked = new HashSet<>();
        long cutoff = System.currentTimeMillis() - 30 * 60 * 1000L;
        for (int i = 0; i < keys.size(); i += 400) {
            List<String> chunk = keys.subList(i, Math.min(keys.size(), i + 400));
            StringBuilder marks = new StringBuilder();
            List<String> args = new ArrayList<>(chunk);
            for (int j = 0; j < chunk.size(); j++) marks.append(j == 0 ? "?" : ",?");
            args.add(String.valueOf(cutoff));
            args.add(String.valueOf(maxAttempts));
            String sql = "SELECT pkey FROM " + T + " WHERE pkey IN (" + marks + ") AND (status='success' OR "
                    + "(status='pending' AND updated_at>?) OR (status='failed' AND attempts>=?))";
            try (Cursor c = getReadableDatabase().rawQuery(sql, args.toArray(new String[0]))) {
                while (c.moveToNext()) blocked.add(c.getString(0));
            }
        }
        return blocked;
    }

    synchronized void delete(long id) {
        getWritableDatabase().delete(T, "id=?", new String[]{String.valueOf(id)});
        changed();
    }

    /** يمسح السجل؛ إن كانت الأتمتة مفعّلة تُعاد نقطة البداية إلى الآن حتى لا تُرسل الصور القديمة مجددًا. */
    synchronized void clear(Context c) {
        getWritableDatabase().delete(T, null, null);
        Store s = Store.get(c);
        if (s.autoOn()) s.resetBaselineNow();
        changed();
    }
}
