package com.photosync.telegram.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.photosync.telegram.data.SettingsRepository
import java.util.concurrent.TimeUnit

/** نقطة التحكم الوحيدة في الإرسال التلقائي (تفعيل/إيقاف/جدولة). */
class AutoSendManager(private val context: Context, private val settings: SettingsRepository) {

    private fun constraints(wifiOnly: Boolean) = Constraints.Builder()
        .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
        .build()

    /** يفعّل الميزة. الصور المضافة قبل هذه اللحظة لا تُرسل أبدًا. */
    fun enable() {
        settings.update { s ->
            val baseline = if (s.autoEnabled) s.autoBaselineSec else System.currentTimeMillis() / 1000
            s.copy(autoEnabled = true, autoBaselineSec = baseline)
        }
        schedule()
        NotificationHelper.showAutoOngoing(context)
    }

    fun disable() {
        settings.update { it.copy(autoEnabled = false) }
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        WorkManager.getInstance(context).cancelUniqueWork(ONCE)
        NotificationHelper.cancelAutoOngoing(context)
    }

    /** يعيد الجدولة بعد تغيير الفترة أو قيد Wi-Fi. */
    fun schedule() {
        val s = settings.current
        if (!s.autoEnabled) return
        val request = PeriodicWorkRequestBuilder<AutoSendWorker>(s.autoIntervalMin.toLong(), TimeUnit.MINUTES)
            .setConstraints(constraints(s.autoWifiOnly))
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /** فحص فوري واحد (يحترم القيود نفسها). */
    fun runNow() {
        val s = settings.current
        if (!s.autoEnabled) return
        val request = OneTimeWorkRequestBuilder<AutoSendWorker>()
            .setConstraints(constraints(s.autoWifiOnly))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, request)
    }

    private companion object {
        const val PERIODIC = "auto_send_periodic"
        const val ONCE = "auto_send_once"
    }
}
