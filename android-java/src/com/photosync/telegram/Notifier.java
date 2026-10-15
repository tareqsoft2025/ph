package com.photosync.telegram;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

final class Notifier {
    private static final String CH_STATUS = "auto_status";
    private static final String CH_RESULT = "auto_result";
    private static final int ID_ONGOING = 1001, ID_RESULT = 1002;

    private Notifier() {}

    static void createChannels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CH_STATUS, "حالة الإرسال التلقائي", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(CH_RESULT, "نتائج الإرسال التلقائي", NotificationManager.IMPORTANCE_DEFAULT));
    }

    private static PendingIntent openApp(Context c) {
        return PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** إشعار دائم واضح يذكّر بأن الإرسال التلقائي يعمل، مع زر إيقاف فوري. */
    static void showOngoing(Context c) {
        PendingIntent stop = PendingIntent.getBroadcast(c, 1, new Intent(c, StopReceiver.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(c, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("الإرسال التلقائي مفعّل")
                .setContentText("تُفحص الصور الجديدة دوريًا وتُرسل إلى Telegram (ليس فوريًا)")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openApp(c))
                .addAction(new Notification.Action.Builder(0, "إيقاف", stop).build())
                .build();
        notify(c, ID_ONGOING, n);
    }

    static void cancelOngoing(Context c) {
        c.getSystemService(NotificationManager.class).cancel(ID_ONGOING);
    }

    static void result(Context c, String text) {
        Notification n = new Notification.Builder(c, CH_RESULT)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("PhotoSync Telegram")
                .setContentText(text)
                .setAutoCancel(true)
                .setContentIntent(openApp(c))
                .build();
        notify(c, ID_RESULT, n);
    }

    private static void notify(Context c, int id, Notification n) {
        try {
            c.getSystemService(NotificationManager.class).notify(id, n);
        } catch (SecurityException ignored) { }
    }
}
