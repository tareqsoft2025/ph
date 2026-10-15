package com.photosync.telegram;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** يرسل صورة واحدة مع إعادة المحاولة وتحديث السجل. */
final class Uploader {
    static final class Outcome {
        final boolean ok;
        final Telegram.Kind kind;
        final String message;
        Outcome(boolean ok, Telegram.Kind kind, String message) { this.ok = ok; this.kind = kind; this.message = message; }
    }

    private Uploader() {}

    private static LogDb.Entry entry(Item it, String status, String error, long size, boolean asDoc, boolean auto, int attempts) {
        LogDb.Entry e = new LogDb.Entry();
        e.key = it.key;
        e.name = it.name;
        e.mime = it.mime;
        e.size = size;
        e.status = status;
        e.error = error;
        e.attempts = attempts;
        e.asDoc = asDoc;
        e.auto = auto;
        e.updatedAt = System.currentTimeMillis();
        return e;
    }

    static void markPending(Context c, Item it, boolean asDoc, boolean auto) {
        LogDb db = LogDb.get(c);
        LogDb.Entry ex = db.find(it.key);
        db.upsert(entry(it, LogDb.PENDING, null, ex != null ? ex.size : it.size, asDoc, auto, ex != null ? ex.attempts : 0));
    }

    static void failIfPending(Context c, Item it, String message) {
        LogDb db = LogDb.get(c);
        LogDb.Entry ex = db.find(it.key);
        if (ex != null && LogDb.PENDING.equals(ex.status)) {
            db.upsert(entry(it, LogDb.FAILED, message, ex.size, ex.asDoc, ex.auto, ex.attempts));
        }
    }

    private static Outcome finish(Context c, Item it, String status, Telegram.Kind kind, String error, long size,
                                  boolean asDoc, boolean auto, int attempts) {
        LogDb.get(c).upsert(entry(it, status, error, size, asDoc, auto, attempts));
        return new Outcome(LogDb.SUCCESS.equals(status), kind, error);
    }

    /** ينسخ الملف إلى الكاش ليُعرف حجمه الحقيقي وتُعاد المحاولة دون إعادة قراءة المصدر. */
    private static File copyToCache(Context c, Item it) throws IOException {
        File tmp = File.createTempFile("upload", ".bin", c.getCacheDir());
        try (InputStream in = c.getContentResolver().openInputStream(it.uri); OutputStream out = new FileOutputStream(tmp)) {
            if (in == null) throw new IOException("no stream");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } catch (IOException | SecurityException e) {
            tmp.delete();
            throw e instanceof IOException ? (IOException) e : new IOException("denied");
        }
        return tmp;
    }

    static Outcome upload(Context c, Item it, boolean asDoc, boolean auto, Telegram.Cancel cancel) {
        Store s = Store.get(c);
        LogDb db = LogDb.get(c);
        LogDb.Entry ex = db.find(it.key);
        int attempts = (ex != null ? ex.attempts : 0) + 1;
        String token = s.token(), chat = s.chat();
        if (token.isEmpty() || chat.isEmpty()) {
            return finish(c, it, LogDb.FAILED, Telegram.Kind.UNAUTHORIZED, "إعدادات Telegram غير مكتملة", it.size, asDoc, auto, attempts);
        }
        File tmp;
        try {
            tmp = copyToCache(c, it);
        } catch (IOException e) {
            return finish(c, it, LogDb.FAILED, Telegram.Kind.FILE, "تعذّر قراءة الملف (حُذف أو لم تعد الصلاحية متاحة)", it.size, asDoc, auto, attempts);
        }
        try {
            long size = tmp.length();
            int mode = Telegram.decide(size, asDoc);
            if (mode == Telegram.TOO_LARGE) {
                return finish(c, it, LogDb.FAILED, Telegram.Kind.FILE, "حجم الملف يتجاوز 50MB (حد Telegram)", size, asDoc, auto, attempts);
            }
            boolean useDoc = mode == Telegram.DOCUMENT;
            int attempt = 0;
            while (true) {
                if (cancel != null && cancel.cancelled) {
                    return finish(c, it, LogDb.FAILED, Telegram.Kind.CANCELLED, "أُلغي الإرسال", size, asDoc, auto, attempts);
                }
                attempt++;
                Telegram.Result r = Telegram.sendFile(token, chat, useDoc, tmp, it.name, it.mime, cancel);
                if (r.ok()) return finish(c, it, LogDb.SUCCESS, null, null, size, useDoc, auto, attempts);
                Telegram.Err err = r.err;
                if (err.kind == Telegram.Kind.CANCELLED) {
                    return finish(c, it, LogDb.FAILED, Telegram.Kind.CANCELLED, "أُلغي الإرسال", size, asDoc, auto, attempts);
                }
                if (!useDoc && err.kind == Telegram.Kind.BAD_REQUEST && err.detail.toLowerCase().contains("dimension")) {
                    useDoc = true; // أبعاد غير مناسبة كصورة: نرسلها كملف أصلي
                    continue;
                }
                long wait = Telegram.backoffMs(err, attempt);
                if (wait < 0) return finish(c, it, LogDb.FAILED, err.kind, err.message, size, asDoc, auto, attempts);
                try {
                    Thread.sleep(wait);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return finish(c, it, LogDb.FAILED, Telegram.Kind.CANCELLED, "أُلغي الإرسال", size, asDoc, auto, attempts);
                }
            }
        } finally {
            tmp.delete();
        }
    }
}
