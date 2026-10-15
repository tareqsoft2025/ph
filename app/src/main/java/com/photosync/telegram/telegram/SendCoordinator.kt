package com.photosync.telegram.telegram

import com.photosync.telegram.data.PhotoItem
import com.photosync.telegram.data.SendStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class SendProgress(
    val total: Int = 0,
    val succeeded: Int = 0,
    val failed: Int = 0,
    val current: String? = null,
    val active: Boolean = false,
    val finished: Boolean = false,
    val cancelled: Boolean = false,
) {
    val processed: Int get() = succeeded + failed
    val fraction: Float get() = if (total == 0) 0f else processed.toFloat() / total
}

/** ينفّذ عمليات الإرسال اليدوي بالتتابع في نطاق التطبيق (تستمر عند تغيير الشاشة) ويدعم الإيقاف. */
class SendCoordinator(
    private val uploader: PhotoUploader,
    private val scope: CoroutineScope,
) {
    private val _progress = MutableStateFlow(SendProgress())
    val progress: StateFlow<SendProgress> = _progress.asStateFlow()
    private var job: Job? = null

    /** @return false إن كانت هناك عملية جارية أو لا توجد عناصر. */
    @Synchronized
    fun start(items: List<PhotoItem>, asDocument: Boolean): Boolean {
        if (items.isEmpty() || job?.isActive == true) return false
        _progress.value = SendProgress(total = items.size, active = true)
        job = scope.launch { run(items, asDocument) }
        return true
    }

    fun cancel() {
        job?.cancel()
    }

    fun dismissResult() {
        if (!_progress.value.active) _progress.value = SendProgress()
    }

    private suspend fun run(items: List<PhotoItem>, asDocument: Boolean) {
        var processed = 0
        var cancelled = false
        try {
            items.forEach { uploader.markPending(it, asDocument, auto = false) }
            for (item in items) {
                _progress.update { it.copy(current = item.name) }
                val outcome = uploader.upload(item, asDocument, auto = false)
                processed++
                _progress.update {
                    if (outcome.status == SendStatus.SUCCESS) it.copy(succeeded = it.succeeded + 1)
                    else it.copy(failed = it.failed + 1)
                }
                if (processed < items.size) delay(1_100) // احترام حد Telegram (~1 رسالة/ثانية لكل محادثة)
            }
        } catch (e: CancellationException) {
            cancelled = true
            throw e
        } finally {
            withContext(NonCancellable) {
                if (cancelled) items.drop(processed).forEach { uploader.failIfPending(it, "أُلغي الإرسال") }
                _progress.update { it.copy(active = false, finished = true, cancelled = cancelled, current = null) }
            }
        }
    }
}
