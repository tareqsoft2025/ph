package com.photosync.telegram.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.photosync.telegram.PhotoSyncApp

/** زر «إيقاف» في الإشعار: يعطّل الأتمتة فورًا. */
class StopAutoReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        (context.applicationContext as PhotoSyncApp).container.autoSend.disable()
    }
}
