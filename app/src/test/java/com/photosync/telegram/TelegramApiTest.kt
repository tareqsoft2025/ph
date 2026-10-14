package com.photosync.telegram

import com.photosync.telegram.telegram.ApiResult
import com.photosync.telegram.telegram.ErrorKind
import com.photosync.telegram.telegram.TelegramApi
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TelegramApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: TelegramApi
    private val token = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefgh"

    @Before fun setUp() {
        server = MockWebServer().apply { start() }
        api = TelegramApi(OkHttpClient(), server.url("/").toString().trimEnd('/'))
    }

    @After fun tearDown() = runCatching { server.shutdown() }.let { }

    @Test fun getMe_parsesBot() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"result":{"id":42,"first_name":"Photo","username":"photo_bot"}}"""))
        val r = api.getMe(token)
        assertTrue(r is ApiResult.Ok)
        assertEquals("photo_bot", (r as ApiResult.Ok).value.username)
        assertEquals("/bot$token/getMe", server.takeRequest().path)
    }

    @Test fun unauthorized_mapsAndNeverLeaksToken() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"ok":false,"error_code":401,"description":"Unauthorized $token"}"""))
        val r = api.getMe(token) as ApiResult.Err
        assertEquals(ErrorKind.UNAUTHORIZED, r.kind)
        assertFalse(r.message.contains(token))
        assertFalse(r.detail.contains(token))
    }

    @Test fun rateLimit_exposesRetryAfter() = runBlocking {
        server.enqueue(
            MockResponse().setResponseCode(429)
                .setBody("""{"ok":false,"error_code":429,"description":"Too Many Requests","parameters":{"retry_after":7}}""")
        )
        val r = api.sendMessage(token, "1", "x") as ApiResult.Err
        assertEquals(ErrorKind.RATE_LIMIT, r.kind)
        assertEquals(7, r.retryAfterSec)
    }

    @Test fun chatNotFound_isBadRequestWithArabicMessage() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}"""))
        val r = api.getChat(token, "999") as ApiResult.Err
        assertEquals(ErrorKind.BAD_REQUEST, r.kind)
        assertTrue(r.message.contains("Chat ID"))
    }

    @Test fun sendPhoto_postsMultipartWithChatAndFile() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"ok":true,"result":{"message_id":1}}"""))
        val bytes = ByteArray(2048) { it.toByte() }
        val r = api.sendPhoto(token, "-100500", "a.jpg", "image/jpeg", bytes.size.toLong()) { bytes.inputStream() }
        assertTrue(r is ApiResult.Ok)
        val req = server.takeRequest()
        assertEquals("/bot$token/sendPhoto", req.path)
        val body = req.body.readUtf8()
        assertTrue(body.contains("name=\"chat_id\""))
        assertTrue(body.contains("-100500"))
        assertTrue(body.contains("name=\"photo\"; filename=\"a.jpg\""))
    }

    @Test fun getRecentChats_collectsDistinctChats() = runBlocking {
        server.enqueue(
            MockResponse().setBody(
                """{"ok":true,"result":[
                {"update_id":1,"message":{"chat":{"id":10,"type":"private","first_name":"Ali"}}},
                {"update_id":2,"message":{"chat":{"id":10,"type":"private","first_name":"Ali"}}},
                {"update_id":3,"channel_post":{"chat":{"id":-100,"type":"channel","title":"News"}}}]}"""
            )
        )
        val chats = (api.getRecentChats(token) as ApiResult.Ok).value
        assertEquals(listOf(10L, -100L), chats.map { it.id })
        assertEquals("News", chats[1].title)
    }

    @Test fun networkFailure_isNetworkErrorWithoutToken() = runBlocking {
        server.shutdown()
        val r = api.getMe(token) as ApiResult.Err
        assertEquals(ErrorKind.NETWORK, r.kind)
        assertFalse(r.message.contains(token))
    }
}
