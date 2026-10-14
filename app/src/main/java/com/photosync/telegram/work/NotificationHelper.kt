package com.photosync.telegram.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.photosync.telegram.MainActivity
import com.photosync.telegram.R

object NotificationHelper {
    private const val CH_STATUS = "auto_status"
    private const val CH_RESULT = "auto_result"
    private const val ID_ONGOING = 1001
    private const val ID_RESULT = 1002

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CH_STATUS, ctx.getString(R.string.channel_status), NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_RESULT, ctx.getString(R.string.channel_result), NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    private fun canNotify(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun openApp(ctx: Context) = PendingIntent.getActivity(
        ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** إشعار دائم واضح يذكّر المستخدم أن الإرسال التلقائي يعمل، مع زر إيقاف فوري. */
    fun showAutoOngoing(ctx: Context) {
        if (!canNotify(ctx)) return
        val stop = PendingIntent.getBroadcast(
            ctx, 1, Intent(ctx, StopAutoReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, CH_STATUS)
            .setSmallIcon(R.drawable.ic_stat_sync)
            .setContentTitle(ctx.getString(R.string.notif_auto_title))
            .setContentText(ctx.getString(R.string.notif_auto_text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp(ctx))
            .addAction(0, ctx.getString(R.string.notif_stop), stop)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(ID_ONGOING, n) }
    }

    fun cancelAutoOngoing(ctx: Context) = NotificationManagerCompat.from(ctx).cancel(ID_ONGOING)

    fun notifyResult(ctx: Context, text: String) {
        if (!canNotify(ctx)) return
        val n = NotificationCompat.Builder(ctx, CH_RESULT)
            .setSmallIcon(R.drawable.ic_stat_sync)
            .setContentTitle(ctx.getString(R.string.notif_result_title))
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx))
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(ID_RESULT, n) }
    }
}
