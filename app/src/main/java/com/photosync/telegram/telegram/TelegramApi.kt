package com.photosync.telegram.telegram

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.Response
import okio.BufferedSink
import okio.source
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

enum class ErrorKind { NETWORK, RATE_LIMIT, UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, SERVER, FILE, UNKNOWN }

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Err(
        val kind: ErrorKind,
        /** رسالة عربية مناسبة للعرض للمستخدم (لا تحتوي على التوكن). */
        val message: String,
        val retryAfterSec: Int? = null,
        /** وصف Telegram الأصلي (بعد إزالة التوكن) للمطابقة البرمجية. */
        val detail: String = "",
    ) : ApiResult<Nothing>
}

data class BotInfo(val id: Long, val username: String, val name: String)
data class ChatInfo(val id: Long, val title: String, val type: String)

/** حدود Telegram Bot API. */
object SendPolicy {
    const val PHOTO_MAX_BYTES = 10L * 1024 * 1024
    const val DOCUMENT_MAX_BYTES = 50L * 1024 * 1024

    enum class Mode { PHOTO, DOCUMENT, TOO_LARGE }

    fun decide(sizeBytes: Long, wantDocument: Boolean): Mode = when {
        sizeBytes > DOCUMENT_MAX_BYTES -> Mode.TOO_LARGE
        wantDocument || sizeBytes > PHOTO_MAX_BYTES -> Mode.DOCUMENT
        else -> Mode.PHOTO
    }
}

fun redact(text: String, token: String): String =
    if (token.isBlank()) text else text.replace(token, "***")

class TelegramApi(
    private val client: OkHttpClient,
    private val baseUrl: String = "https://api.telegram.org",
) {
    suspend fun getMe(token: String): ApiResult<BotInfo> =
        execute(token, "getMe", FormBody.Builder().build()) { json ->
            val r = json.getJSONObject("result")
            BotInfo(r.getLong("id"), r.optString("username"), r.optString("first_name"))
        }

    suspend fun getChat(token: String, chatId: String): ApiResult<ChatInfo> =
        execute(token, "getChat", FormBody.Builder().add("chat_id", chatId).build()) { json ->
            parseChat(json.getJSONObject("result"))
        }

    /** يعرض المحادثات التي راسلت البوت مؤخرًا (لمساعدة المستخدم في معرفة Chat ID). */
    suspend fun getRecentChats(token: String): ApiResult<List<ChatInfo>> =
        execute(token, "getUpdates", FormBody.Builder().add("limit", "100").build()) { json ->
            val arr = json.getJSONArray("result")
            val chats = LinkedHashMap<Long, ChatInfo>()
            for (i in 0 until arr.length()) {
                val u = arr.getJSONObject(i)
                val chat = listOf("message", "channel_post", "edited_message", "my_chat_member")
                    .firstNotNullOfOrNull { u.optJSONObject(it)?.optJSONObject("chat") }
                    ?: continue
                val info = parseChat(chat)
                chats[info.id] = info
            }
            chats.values.toList()
        }

    suspend fun sendMessage(token: String, chatId: String, text: String): ApiResult<Unit> =
        execute(
            token, "sendMessage",
            FormBody.Builder().add("chat_id", chatId).add("text", text).build(),
        ) { }

    suspend fun sendPhoto(
        token: String, chatId: String, fileName: String, mime: String, sizeBytes: Long,
        opener: () -> InputStream,
    ): ApiResult<Unit> = sendFile(token, "sendPhoto", "photo", chatId, fileName, mime, sizeBytes, opener)

    suspend fun sendDocument(
        token: String, chatId: String, fileName: String, mime: String, sizeBytes: Long,
        opener: () -> InputStream,
    ): ApiResult<Unit> = sendFile(token, "sendDocument", "document", chatId, fileName, mime, sizeBytes, opener)

    private suspend fun sendFile(
        token: String, method: String, field: String, chatId: String, fileName: String,
        mime: String, sizeBytes: Long, opener: () -> InputStream,
    ): ApiResult<Unit> {
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("chat_id", chatId)
            .addFormDataPart(field, fileName, StreamBody(mime.toMediaTypeOrNull(), sizeBytes, opener))
            .build()
        return execute(token, method, body) { }
    }

    private suspend fun <T> execute(
        token: String, method: String, body: RequestBody, parse: (JSONObject) -> T,
    ): ApiResult<T> {
        val url = try {
            "$baseUrl/bot$token/$method".toHttpUrl()
        } catch (e: IllegalArgumentException) {
            return ApiResult.Err(ErrorKind.BAD_REQUEST, "صيغة رمز البوت غير صحيحة")
        }
        val request = Request.Builder().url(url).post(body).build()
        return try {
            client.newCall(request).await().use { resp ->
                parseResponse(resp.code, resp.body?.string().orEmpty(), token, parse)
            }
        } catch (e: IOException) {
            networkError(e)
        }
    }

    private fun <T> parseResponse(
        code: Int, text: String, token: String, parse: (JSONObject) -> T,
    ): ApiResult<T> {
        val json = try {
            JSONObject(text)
        } catch (e: JSONException) {
            return if (code in 200..299) {
                ApiResult.Err(ErrorKind.UNKNOWN, "رد غير مفهوم من Telegram")
            } else {
                mapError(code, "", null)
            }
        }
        if (json.optBoolean("ok")) {
            return try {
                ApiResult.Ok(parse(json))
            } catch (e: JSONException) {
                ApiResult.Err(ErrorKind.UNKNOWN, "رد غير متوقع من Telegram")
            }
        }
        val detail = redact(json.optString("description"), token)
        val retry = json.optJSONObject("parameters")?.optInt("retry_after", 0)?.takeIf { it > 0 }
        return mapError(json.optInt("error_code", code), detail, retry)
    }

    private fun parseChat(c: JSONObject): ChatInfo {
        val title = c.optString("title").ifBlank {
            listOf(c.optString("first_name"), c.optString("last_name"))
                .filter { it.isNotBlank() }.joinToString(" ")
                .ifBlank { c.optString("username") }
        }
        return ChatInfo(c.getLong("id"), title, c.optString("type"))
    }

    internal fun mapError(code: Int, detail: String, retryAfter: Int?): ApiResult.Err {
        val lower = detail.lowercase()
        return when {
            code == 401 || code == 404 ->
                ApiResult.Err(ErrorKind.UNAUTHORIZED, "رمز البوت غير صحيح أو تم إلغاؤه", detail = detail)
            code == 403 ->
                ApiResult.Err(
                    ErrorKind.FORBIDDEN,
                    "البوت لا يملك صلاحية الإرسال إلى هذه المحادثة (ابدأ محادثة معه أو أضِفه كمشرف في القناة/المجموعة)",
                    detail = detail,
                )
            code == 429 ->
                ApiResult.Err(
                    ErrorKind.RATE_LIMIT,
                    "تجاوزت حد الإرسال في Telegram" + (retryAfter?.let { "، الانتظار $it ثانية" } ?: ""),
                    retryAfter, detail,
                )
            code == 409 ->
                ApiResult.Err(ErrorKind.BAD_REQUEST, "تعارض: للبوت webhook مفعّل، لا يمكن قراءة التحديثات", detail = detail)
            code == 413 ->
                ApiResult.Err(ErrorKind.BAD_REQUEST, "الملف كبير جدًا بالنسبة لـ Telegram", detail = detail)
            code == 400 -> {
                val msg = when {
                    "chat not found" in lower -> "لم يُعثر على المحادثة، تأكد من Chat ID"
                    "dimension" in lower -> "أبعاد الصورة غير مدعومة كصورة"
                    "too big" in lower || "too large" in lower -> "الملف كبير جدًا بالنسبة لـ Telegram"
                    else -> "طلب مرفوض من Telegram"
                }
                ApiResult.Err(ErrorKind.BAD_REQUEST, msg, detail = detail)
            }
            code >= 500 ->
                ApiResult.Err(ErrorKind.SERVER, "خطأ مؤقت في خوادم Telegram", detail = detail)
            else ->
                ApiResult.Err(ErrorKind.UNKNOWN, "خطأ غير متوقع (رمز $code)", detail = detail)
        }
    }

    private fun networkError(e: IOException): ApiResult.Err {
        val msg = when (e) {
            is UnknownHostException -> "لا يوجد اتصال بالإنترنت"
            is SocketTimeoutException -> "انتهت مهلة الاتصال بـ Telegram"
            is SSLException -> "فشل الاتصال الآمن بـ Telegram"
            else -> "تعذّر الاتصال بـ Telegram"
        }
        // نتعمد عدم تضمين e.message لأنه قد يحتوي على عنوان الطلب (وفيه التوكن).
        return ApiResult.Err(ErrorKind.NETWORK, msg)
    }

    private class StreamBody(
        private val type: MediaType?,
        private val size: Long,
        private val opener: () -> InputStream,
    ) : RequestBody() {
        override fun contentType() = type
        override fun contentLength() = if (size > 0) size else -1L
        override fun writeTo(sink: BufferedSink) {
            opener().use { sink.writeAll(it.source()) }
        }
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (cont.isActive) cont.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            if (cont.isActive) cont.resume(response) else response.close()
        }
    })
}
