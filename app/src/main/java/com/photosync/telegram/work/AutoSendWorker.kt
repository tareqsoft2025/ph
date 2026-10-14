package com.photosync.telegram.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.photosync.telegram.PhotoSyncApp
import com.photosync.telegram.data.SendStatus
import com.photosync.telegram.telegram.ErrorKind
import kotlinx.coroutines.delay

class AutoSendWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val c = (applicationContext as PhotoSyncApp).container
        val s = c.settings.current
        if (!s.autoEnabled) return Result.success()
        NotificationHelper.showAutoOngoing(applicationContext)

        fun summary(text: String) {
            c.settings.update { it.copy(lastAutoRunMillis = System.currentTimeMillis(), lastAutoSummary = text) }
        }

        if (!s.isConfigured) {
            summary("إعدادات Telegram غير مكتملة")
            return Result.success()
        }
        if (!c.media.hasAccess()) {
            summary("صلاحية الصور غير ممنوحة")
            NotificationHelper.notifyResult(applicationContext, "الإرسال التلقائي متوقف: صلاحية الصور غير ممنوحة")
            return Result.success()
        }

        val candidates = c.media.queryImages(bucketId = s.autoBucketId, sinceSec = s.autoBaselineSec, limit = 200)
        val blocked = HashSet<String>()
        val pendingCutoff = System.currentTimeMillis() - 30 * 60_000L
        candidates.map { it.key }.chunked(500).forEach {
            blocked += c.dao.blockedKeys(it, pendingCutoff, MAX_ATTEMPTS)
        }
        val todo = candidates.filter { it.key !in blocked }.reversed() // الأقدم أولًا
        if (todo.isEmpty()) {
            summary("لا توجد صور جديدة")
            return Result.success()
        }

        var ok = 0
        var failed = 0
        var networkProblem = false
        for ((i, item) in todo.withIndex()) {
            c.uploader.markPending(item, s.autoAsDocument, auto = true)
            val out = c.uploader.upload(item, s.autoAsDocument, auto = true)
            if (out.status == SendStatus.SUCCESS) ok++ else failed++
            if (out.errorKind == ErrorKind.NETWORK || out.errorKind == ErrorKind.RATE_LIMIT) {
                networkProblem = true
                todo.drop(i + 1).forEach { c.uploader.failIfPending(it, "") }
                break
            }
            if (i < todo.lastIndex) delay(1_100)
        }
        val text = "أُرسلت $ok صورة" + if (failed > 0) "، وفشلت $failed" else ""
        summary(text)
        NotificationHelper.notifyResult(applicationContext, text)
        return if (networkProblem) Result.retry() else Result.success()
    }

    private companion object {
        const val MAX_ATTEMPTS = 5
    }
}
