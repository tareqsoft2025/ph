package com.photosync.telegram.telegram

import android.content.Context
import com.photosync.telegram.data.PhotoItem
import com.photosync.telegram.data.SendLogDao
import com.photosync.telegram.data.SendLogEntity
import com.photosync.telegram.data.SendStatus
import com.photosync.telegram.data.SettingsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.FileNotFoundException

data class UploadOutcome(val status: SendStatus, val errorKind: ErrorKind? = null, val message: String? = null)

/** يرسل صورة واحدة مع إعادة المحاولة وتحديث سجل الإرسال. */
class PhotoUploader(
    private val context: Context,
    private val api: TelegramApi,
    private val settings: SettingsRepository,
    private val dao: SendLogDao,
) {
    suspend fun markPending(item: PhotoItem, asDocument: Boolean, auto: Boolean) {
        val existing = dao.find(item.key)
        dao.upsert(entity(item, existing, SendStatus.PENDING, null, asDocument, auto, existing?.attempts ?: 0))
    }

    suspend fun failIfPending(item: PhotoItem, message: String) {
        val existing = dao.find(item.key) ?: return
        if (existing.status == SendStatus.PENDING) {
            dao.upsert(existing.copy(status = SendStatus.FAILED, error = message, updatedAt = System.currentTimeMillis()))
        }
    }

    suspend fun upload(item: PhotoItem, asDocument: Boolean, auto: Boolean): UploadOutcome {
        val existing = dao.find(item.key)
        val attempts = (existing?.attempts ?: 0) + 1
        suspend fun finish(status: SendStatus, kind: ErrorKind? = null, error: String? = null): UploadOutcome {
            withContext(NonCancellable) {
                dao.upsert(entity(item, dao.find(item.key), status, error, asDocument, auto, attempts))
            }
            return UploadOutcome(status, kind, error)
        }

        val s = settings.current
        if (!s.isConfigured) return finish(SendStatus.FAILED, ErrorKind.UNAUTHORIZED, "إعدادات Telegram غير مكتملة")

        var asDoc = when (SendPolicy.decide(item.sizeBytes, asDocument)) {
            SendPolicy.Mode.TOO_LARGE ->
                return finish(SendStatus.FAILED, ErrorKind.FILE, "حجم الملف يتجاوز 50MB (حد Telegram)")
            SendPolicy.Mode.DOCUMENT -> true
            SendPolicy.Mode.PHOTO -> false
        }

        // نتحقق أن الملف ما زال قابلًا للقراءة قبل بدء الرفع.
        try {
            (context.contentResolver.openInputStream(item.uri) ?: throw FileNotFoundException()).close()
        } catch (e: Exception) {
            return finish(SendStatus.FAILED, ErrorKind.FILE, "تعذّر قراءة الملف (حُذف أو لم تعد الصلاحية متاحة)")
        }

        val opener = { context.contentResolver.openInputStream(item.uri) ?: throw FileNotFoundException() }
        try {
            var attempt = 0
            while (true) {
                attempt++
                val result = if (asDoc) {
                    api.sendDocument(s.botToken, s.chatId, item.name, item.mime, item.sizeBytes, opener)
                } else {
                    api.sendPhoto(s.botToken, s.chatId, item.name, item.mime, item.sizeBytes, opener)
                }
                when (result) {
                    is ApiResult.Ok -> return finish(SendStatus.SUCCESS)
                    is ApiResult.Err -> {
                        if (!asDoc && result.kind == ErrorKind.BAD_REQUEST && "dimension" in result.detail.lowercase()) {
                            asDoc = true // أبعاد غير مناسبة كصورة: نرسلها كملف أصلي
                            continue
                        }
                        val wait = backoffMillis(result, attempt)
                            ?: return finish(SendStatus.FAILED, result.kind, result.message)
                        delay(wait)
                    }
                }
            }
        } catch (e: CancellationException) {
            finish(SendStatus.FAILED, null, "أُلغي الإرسال")
            throw e
        }
    }

    private fun entity(
        item: PhotoItem, existing: SendLogEntity?, status: SendStatus, error: String?,
        asDocument: Boolean, auto: Boolean, attempts: Int,
    ) = SendLogEntity(
        id = existing?.id ?: 0,
        photoKey = item.key,
        uri = item.uri.toString(),
        name = item.name,
        mime = item.mime,
        sizeBytes = item.sizeBytes,
        status = status,
        error = error,
        attempts = attempts,
        asDocument = asDocument,
        auto = auto,
        updatedAt = System.currentTimeMillis(),
    )

    internal companion object {
        /** سياسة إعادة المحاولة: null يعني التوقف نهائيًا. */
        fun backoffMillis(err: ApiResult.Err, attempt: Int): Long? = when (err.kind) {
            ErrorKind.NETWORK, ErrorKind.SERVER -> if (attempt < 3) 2_000L * attempt else null
            ErrorKind.RATE_LIMIT -> {
                val wait = err.retryAfterSec ?: 5
                if (attempt < 4 && wait <= 60) (wait + 1) * 1000L else null
            }
            else -> null
        }
    }
}
