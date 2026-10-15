package com.photosync.telegram;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/** ينفّذ الإرسال اليدوي بالتتابع في خيط خلفي، مع تقدّم وإيقاف. */
final class SendQueue {
    static boolean active, finished, cancelled;
    static int total, succeeded, failed;
    static String current;

    private static final List<Runnable> listeners = new CopyOnWriteArrayList<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Telegram.Cancel cancel;

    private SendQueue() {}

    static void addListener(Runnable r) { listeners.add(r); }
    static void removeListener(Runnable r) { listeners.remove(r); }

    private static void fire() {
        for (final Runnable r : listeners) main.post(r);
    }

    static float fraction() { return total == 0 ? 0 : (float) (succeeded + failed) / total; }

    /** false إن كانت هناك عملية جارية أو لا توجد عناصر. */
    static synchronized boolean start(Context ctx, final List<Item> items, final boolean asDoc) {
        if (active || items.isEmpty()) return false;
        final Context c = ctx.getApplicationContext();
        active = true;
        finished = false;
        cancelled = false;
        total = items.size();
        succeeded = 0;
        failed = 0;
        current = null;
        cancel = new Telegram.Cancel();
        final Telegram.Cancel flag = cancel;
        fire();
        new Thread(new Runnable() {
            public void run() { runAll(c, items, asDoc, flag); }
        }, "send-queue").start();
        return true;
    }

    private static void runAll(Context c, List<Item> items, boolean asDoc, Telegram.Cancel flag) {
        int processed = 0;
        try {
            for (Item it : items) Uploader.markPending(c, it, asDoc, false);
            for (Item it : items) {
                if (flag.cancelled) break;
                current = it.name;
                fire();
                Uploader.Outcome o = Uploader.upload(c, it, asDoc, false, flag);
                processed++;
                if (o.ok) succeeded++; else failed++;
                fire();
                if (processed < items.size() && !flag.cancelled) {
                    try { Thread.sleep(1100); } catch (InterruptedException e) { break; } // حد Telegram ~1 رسالة/ثانية
                }
            }
        } finally {
            if (flag.cancelled) {
                for (int i = processed; i < items.size(); i++) Uploader.failIfPending(c, items.get(i), "أُلغي الإرسال");
            }
            cancelled = flag.cancelled;
            current = null;
            active = false;
            finished = true;
            fire();
        }
    }

    static void cancel() {
        Telegram.Cancel c = cancel;
        if (c != null) c.cancel();
    }

    static void dismiss() {
        if (active) return;
        finished = false;
        fire();
    }
}
