package com.photosync.telegram;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** زر «إيقاف» في الإشعار: يعطّل الأتمتة فورًا. */
public class StopReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        Auto.disable(context.getApplicationContext());
    }
}
