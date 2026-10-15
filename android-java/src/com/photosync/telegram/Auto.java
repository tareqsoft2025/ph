package com.photosync.telegram;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** نقطة التحكم الوحيدة في الإرسال التلقائي (JobScheduler). */
final class Auto {
    static final int JOB_PERIODIC = 4001, JOB_ONCE = 4002;
    private static final int MAX_ATTEMPTS = 5;

    private Auto() {}

    private static JobInfo.Builder base(Context c, int id) {
        return new JobInfo.Builder(id, new ComponentName(c, AutoSendJob.class))
                .setRequiredNetworkType(Store.get(c).autoWifi() ? JobInfo.NETWORK_TYPE_UNMETERED : JobInfo.NETWORK_TYPE_ANY);
    }

    /** يفعّل الميزة. الصور المضافة قبل هذه اللحظة لا تُرسل أبدًا. */
    static void enable(Context c) {
        Store s = Store.get(c);
        if (!s.autoOn()) s.resetBaselineNow();
        s.setAutoOn(true);
        schedule(c);
        Notifier.showOngoing(c);
    }

    static void disable(Context c) {
        Store.get(c).setAutoOn(false);
        JobScheduler js = c.getSystemService(JobScheduler.class);
        js.cancel(JOB_PERIODIC);
        js.cancel(JOB_ONCE);
        Notifier.cancelOngoing(c);
    }

    /** يعيد الجدولة بعد تغيير الفترة أو قيد Wi-Fi. */
    static void schedule(Context c) {
        Store s = Store.get(c);
        if (!s.autoOn()) return;
        c.getSystemService(JobScheduler.class).schedule(
                base(c, JOB_PERIODIC).setPeriodic(s.autoInterval() * 60_000L).setPersisted(true).build());
    }

    static void runNow(Context c) {
        if (!Store.get(c).autoOn()) return;
        c.getSystemService(JobScheduler.class).schedule(base(c, JOB_ONCE).setOverrideDeadline(60_000L).build());
    }

    /** يفحص الصور الجديدة ويرسلها. يُرجع true إن لزمت إعادة الجدولة (مشكلة شبكة). */
    static boolean runOnce(Context c, Telegram.Cancel cancel) {
        Store s = Store.get(c);
        if (!s.autoOn()) return false;
        Notifier.showOngoing(c);
        if (!s.configured()) { s.setLastRun("إعدادات Telegram غير مكتملة"); return false; }
        if (!Media.hasAccess(c)) {
            s.setLastRun("صلاحية الصور غير ممنوحة");
            Notifier.result(c, "الإرسال التلقائي متوقف: صلاحية الصور غير ممنوحة");
            return false;
        }
        List<Item> fresh = Media.query(c, s.autoBucketId(), s.baselineSec(), 200);
        List<String> keys = new ArrayList<>();
        for (Item it : fresh) keys.add(it.key);
        Set<String> blocked = new HashSet<>(LogDb.get(c).blockedKeys(keys, MAX_ATTEMPTS));
        List<Item> todo = new ArrayList<>();
        for (int i = fresh.size() - 1; i >= 0; i--) { // الأقدم أولًا
            if (!blocked.contains(fresh.get(i).key)) todo.add(fresh.get(i));
        }
        if (todo.isEmpty()) { s.setLastRun("لا توجد صور جديدة"); return false; }

        int ok = 0, failed = 0;
        boolean retry = false;
        for (int i = 0; i < todo.size() && !cancel.cancelled; i++) {
            Item it = todo.get(i);
            Uploader.markPending(c, it, s.autoAsDoc(), true);
            Uploader.Outcome o = Uploader.upload(c, it, s.autoAsDoc(), true, cancel);
            if (o.ok) ok++; else failed++;
            if (o.kind == Telegram.Kind.NETWORK || o.kind == Telegram.Kind.RATE_LIMIT) { retry = true; break; }
            if (i < todo.size() - 1) {
                try { Thread.sleep(1100); } catch (InterruptedException e) { break; }
            }
        }
        String text = "أُرسلت " + ok + " صورة" + (failed > 0 ? "، وفشلت " + failed : "");
        s.setLastRun(text);
        Notifier.result(c, text);
        return retry;
    }
}
