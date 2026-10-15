package com.photosync.telegram;

import static org.junit.Assert.*;

import com.sun.net.httpserver.HttpServer;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/** اختبارات JVM لطبقة Telegram (لا تعتمد على android.*). */
public class TelegramTest {
    private static final String TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefgh";
    private HttpServer server;
    private final AtomicReference<String> path = new AtomicReference<>();
    private final AtomicReference<String> body = new AtomicReference<>();
    private volatile int code = 200;
    private volatile String response = "{}";

    @Before public void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            path.set(ex.getRequestURI().getPath());
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            InputStream in = ex.getRequestBody();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            body.set(new String(b.toByteArray(), StandardCharsets.ISO_8859_1));
            byte[] out = response.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(code, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.start();
        Telegram.baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @After public void stop() { server.stop(0); }

    @Test public void getMe_ok() {
        response = "{\"ok\":true,\"result\":{\"id\":42,\"username\":\"photo_bot\"}}";
        Telegram.Result r = Telegram.getMe(TOKEN);
        assertTrue(r.ok());
        assertEquals("photo_bot", r.json.optJSONObject("result").optString("username"));
        assertEquals("/bot" + TOKEN + "/getMe", path.get());
    }

    @Test public void unauthorized_noTokenLeak() {
        code = 401;
        response = "{\"ok\":false,\"error_code\":401,\"description\":\"Unauthorized " + TOKEN + "\"}";
        Telegram.Err e = Telegram.getMe(TOKEN).err;
        assertEquals(Telegram.Kind.UNAUTHORIZED, e.kind);
        assertFalse(e.message.contains(TOKEN));
        assertFalse(e.detail.contains(TOKEN));
    }

    @Test public void rateLimit_retryAfter() {
        code = 429;
        response = "{\"ok\":false,\"error_code\":429,\"description\":\"Too Many Requests\",\"parameters\":{\"retry_after\":7}}";
        Telegram.Err e = Telegram.sendMessage(TOKEN, "1", "x").err;
        assertEquals(Telegram.Kind.RATE_LIMIT, e.kind);
        assertEquals(7, e.retryAfter);
        assertEquals(8000L, Telegram.backoffMs(e, 1));
    }

    @Test public void chatNotFound() {
        code = 400;
        response = "{\"ok\":false,\"error_code\":400,\"description\":\"Bad Request: chat not found\"}";
        Telegram.Err e = Telegram.getChat(TOKEN, "9").err;
        assertEquals(Telegram.Kind.BAD_REQUEST, e.kind);
        assertTrue(e.message.contains("Chat ID"));
    }

    @Test public void sendPhoto_multipart() throws Exception {
        response = "{\"ok\":true,\"result\":{\"message_id\":1}}";
        File f = File.createTempFile("ttt", ".jpg");
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(new byte[3000]); }
        Telegram.Result r = Telegram.sendFile(TOKEN, "-100500", false, f, "a.jpg", "image/jpeg", null);
        assertTrue(r.ok());
        assertEquals("/bot" + TOKEN + "/sendPhoto", path.get());
        String b = body.get();
        assertTrue(b.contains("name=\"chat_id\""));
        assertTrue(b.contains("-100500"));
        assertTrue(b.contains("name=\"photo\"; filename=\"a.jpg\""));
        assertTrue(b.contains("Content-Type: image/jpeg"));
        f.delete();
    }

    @Test public void sendDocument_path() throws Exception {
        response = "{\"ok\":true,\"result\":{}}";
        File f = File.createTempFile("ttt", ".png");
        assertTrue(Telegram.sendFile(TOKEN, "1", true, f, "b.png", "image/png", null).ok());
        assertEquals("/bot" + TOKEN + "/sendDocument", path.get());
        assertTrue(body.get().contains("name=\"document\""));
        f.delete();
    }

    @Test public void recentChats_distinct() throws Exception {
        response = "{\"ok\":true,\"result\":[{\"message\":{\"chat\":{\"id\":10,\"type\":\"private\",\"first_name\":\"Ali\"}}},"
                + "{\"message\":{\"chat\":{\"id\":10,\"type\":\"private\",\"first_name\":\"Ali\"}}},"
                + "{\"channel_post\":{\"chat\":{\"id\":-100,\"type\":\"channel\",\"title\":\"News\"}}}]}";
        List<Telegram.Chat> chats = Telegram.parseChats(Telegram.getUpdates(TOKEN).json);
        assertEquals(2, chats.size());
        assertEquals(10L, chats.get(0).id);
        assertEquals("News", chats.get(1).title);
    }

    @Test public void networkDown_noTokenLeak() {
        server.stop(0);
        Telegram.Err e = Telegram.getMe(TOKEN).err;
        assertEquals(Telegram.Kind.NETWORK, e.kind);
        assertFalse(e.message.contains(TOKEN));
    }

    @Test public void cancel_midUpload() throws Exception {
        File f = File.createTempFile("ttt", ".jpg");
        try (FileOutputStream o = new FileOutputStream(f)) { o.write(new byte[200000]); }
        Telegram.Cancel c = new Telegram.Cancel();
        c.cancelled = true;
        Telegram.Err e = Telegram.sendFile(TOKEN, "1", false, f, "a.jpg", "image/jpeg", c).err;
        assertEquals(Telegram.Kind.CANCELLED, e.kind);
        f.delete();
    }

    @Test public void policy() {
        long mb = 1024 * 1024;
        assertEquals(Telegram.PHOTO, Telegram.decide(2 * mb, false));
        assertEquals(Telegram.DOCUMENT, Telegram.decide(2 * mb, true));
        assertEquals(Telegram.DOCUMENT, Telegram.decide(12 * mb, false));
        assertEquals(Telegram.TOO_LARGE, Telegram.decide(51 * mb, true));
    }

    @Test public void backoff() {
        Telegram.Err net = new Telegram.Err(Telegram.Kind.NETWORK, "x", 0, "");
        assertEquals(2000L, Telegram.backoffMs(net, 1));
        assertEquals(4000L, Telegram.backoffMs(net, 2));
        assertEquals(-1L, Telegram.backoffMs(net, 3));
        assertEquals(-1L, Telegram.backoffMs(new Telegram.Err(Telegram.Kind.RATE_LIMIT, "x", 300, ""), 1));
        assertEquals(-1L, Telegram.backoffMs(new Telegram.Err(Telegram.Kind.FORBIDDEN, "x", 0, ""), 1));
    }

    @Test public void redact() { assertEquals("u/bot***/x", Telegram.redact("u/bot123:abc/x", "123:abc")); }
}
