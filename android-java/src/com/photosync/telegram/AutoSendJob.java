package com.photosync.telegram;

import android.app.job.JobParameters;
import android.app.job.JobService;

public class AutoSendJob extends JobService {
    private volatile Telegram.Cancel cancel;

    @Override public boolean onStartJob(final JobParameters params) {
        final Telegram.Cancel flag = new Telegram.Cancel();
        cancel = flag;
        new Thread(new Runnable() {
            public void run() {
                boolean again = false;
                try {
                    again = Auto.runOnce(getApplicationContext(), flag);
                } catch (Exception ignored) {
                    again = true;
                }
                jobFinished(params, again);
            }
        }, "auto-send").start();
        return true; // العمل مستمر في خيط خلفي
    }

    @Override public boolean onStopJob(JobParameters params) {
        Telegram.Cancel c = cancel;
        if (c != null) c.cancel();
        return true;
    }
}
