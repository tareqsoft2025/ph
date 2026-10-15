package com.photosync.telegram;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.net.ssl.SSLException;

/** عميل Telegram Bot API. لا يعتمد على android.* كي يُختبر على JVM. لا يسجّل أو يعرض التوكن أبدًا. */
final class Telegram {
    enum Kind { NETWORK, RATE_LIMIT, UNAUTHORIZED, FORBIDDEN, BAD_REQUEST, SERVER, FILE, CANCELLED, UNKNOWN }

    static final long PHOTO_MAX = 10L * 1024 * 1024;
    static final long DOC_MAX = 50L * 1024 * 1024;

    /** قابل للتغيير للاختبارات فقط. */
    static String baseUrl = "https://api.telegram.org";

    static final class Err {
        final Kind kind;
        final String message;   // عربي، بلا توكن
        final int retryAfter;   // ثوانٍ، 0 = غير محدد
        final String detail;    // وصف Telegram الأصلي منقّى
        Err(Kind k, String m, int r, String d) { kind = k; message = m; retryAfter = r; detail = d == null ? "" : d; }
    }

    static final class Result {
        final JSONObject json;
        final Err err;
        Result(JSONObject j, Err e) { json = j; err = e; }
        boolean ok() { return err == null; }
    }

    static final class Chat {
        final long id;
        final String title, type;
        Chat(long id, String title, String type) { this.id = id; this.title = title; this.type = type; }
    }

    /** للإيقاف: يقطع الاتصال الجاري. */
    static final class Cancel {
        volatile boolean cancelled;
        volatile HttpURLConnection conn;
        void cancel() {
            cancelled = true;
            final HttpURLConnection c = conn;
            if (c != null) new Thread(new Runnable() { public void run() { try { c.disconnect(); } catch (Exception ignored) { } } }).start();
        }
    }

    private Telegram() {}

    // ── سياسة الإرسال ──────────────────────────────────────────────────────
    static final int PHOTO = 0, DOCUMENT = 1, TOO_LARGE = 2;

    static int decide(long size, boolean wantDoc) {
        if (size > DOC_MAX) return TOO_LARGE;
        if (wantDoc || size > PHOTO_MAX) return DOCUMENT;
        return PHOTO;
    }

    /** مهلة الانتظار (ms) قبل إعادة المحاولة؛ -1 = توقف نهائي. */
    static long backoffMs(Err e, int attempt) {
        switch (e.kind) {
            case NETWORK:
            case SERVER:
                return attempt < 3 ? 2000L * attempt : -1;
            case RATE_LIMIT:
                int wait = e.retryAfter > 0 ? e.retryAfter : 5;
                return (attempt < 4 && wait <= 60) ? (wait + 1) * 1000L : -1;
            default:
                return -1;
        }
    }

    static String redact(String text, String token) {
        return token == null || token.isEmpty() ? text : text.replace(token, "***");
    }

    // ── الطلبات ────────────────────────────────────────────────────────────
    static Result getMe(String token) {
        return call(token, "getMe", new LinkedHashMap<String, String>(), null, null, null, null, null);
    }

    static Result getChat(String token, String chatId) {
        Map<String, String> f = new LinkedHashMap<>();
        f.put("chat_id", chatId);
        return call(token, "getChat", f, null, null, null, null, null);
    }

    static Result sendMessage(String token, String chatId, String text) {
        Map<String, String> f = new LinkedHashMap<>();
        f.put("chat_id", chatId);
        f.put("text", text);
        return call(token, "sendMessage", f, null, null, null, null, null);
    }

    static Result sendFile(String token, String chatId, boolean asDoc, File file, String fileName, String mime, Cancel cancel) {
        Map<String, String> f = new LinkedHashMap<>();
        f.put("chat_id", chatId);
        return call(token, asDoc ? "sendDocument" : "sendPhoto", f, asDoc ? "document" : "photo", file, fileName, mime, cancel);
    }

    /** آخر المحادثات التي راسلت البوت. يُرجع null في err عند النجاح. */
    static List<Chat> parseChats(JSONObject json) throws JSONException {
        Map<Long, Chat> chats = new LinkedHashMap<>();
        JSONArray arr = json.getJSONArray("result");
        String[] keys = {"message", "channel_post", "edited_message", "my_chat_member"};
        for (int i = 0; i < arr.length(); i++) {
            JSONObject u = arr.getJSONObject(i);
            for (String k : keys) {
                JSONObject m = u.optJSONObject(k);
                JSONObject chat = m == null ? null : m.optJSONObject("chat");
                if (chat != null) {
                    Chat c = chat(chat);
                    chats.put(c.id, c);
                    break;
                }
            }
        }
        return new ArrayList<>(chats.values());
    }

    static Result getUpdates(String token) {
        Map<String, String> f = new LinkedHashMap<>();
        f.put("limit", "100");
        return call(token, "getUpdates", f, null, null, null, null, null);
    }

    static Chat chat(JSONObject c) {
        String title = c.optString("title", "");
        if (title.isEmpty()) {
            title = (c.optString("first_name", "") + " " + c.optString("last_name", "")).trim();
        }
        if (title.isEmpty()) title = c.optString("username", "");
        return new Chat(c.optLong("id"), title, c.optString("type", ""));
    }

    private static Result call(String token, String method, Map<String, String> fields, String fileField,
                               File file, String fileName, String mime, Cancel cancel) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(baseUrl + "/bot" + token + "/" + method);
            String boundary = "----PhotoSync" + System.nanoTime();
            ByteArrayOutputStream head = new ByteArrayOutputStream();
            for (Map.Entry<String, String> e : fields.entrySet()) {
                head.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + e.getKey() + "\"\r\n\r\n").getBytes("UTF-8"));
                head.write(e.getValue().getBytes("UTF-8"));
                head.write("\r\n".getBytes("UTF-8"));
            }
            if (file != null) {
                String safe = fileName.replace("\"", "_").replace("\r", "").replace("\n", "");
                head.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + fileField + "\"; filename=\"" + safe
                        + "\"\r\nContent-Type: " + (mime == null || mime.isEmpty() ? "application/octet-stream" : mime) + "\r\n\r\n").getBytes("UTF-8"));
            }
            byte[] tail = ((file != null ? "\r\n" : "") + "--" + boundary + "--\r\n").getBytes("UTF-8");
            long total = head.size() + tail.length + (file != null ? file.length() : 0);

            c = (HttpURLConnection) url.openConnection();
            if (cancel != null) cancel.conn = c;
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(20000);
            c.setReadTimeout(120000);
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            c.setFixedLengthStreamingMode(total);
            try (OutputStream out = c.getOutputStream()) {
                head.writeTo(out);
                if (file != null) {
                    try (InputStream in = new FileInputStream(file)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (cancel != null && cancel.cancelled) throw new IOException("cancelled");
                            out.write(buf, 0, n);
                        }
                    }
                }
                out.write(tail);
            }
            int code = c.getResponseCode();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            return parse(code, is == null ? "" : read(is), token);
        } catch (MalformedURLException e) {
            return fail(Kind.BAD_REQUEST, "صيغة رمز البوت غير صحيحة");
        } catch (UnknownHostException e) {
            return cancelled(cancel) ? cancelledResult() : fail(Kind.NETWORK, "لا يوجد اتصال بالإنترنت");
        } catch (SocketTimeoutException e) {
            return cancelled(cancel) ? cancelledResult() : fail(Kind.NETWORK, "انتهت مهلة الاتصال بـ Telegram");
        } catch (SSLException e) {
            return cancelled(cancel) ? cancelledResult() : fail(Kind.NETWORK, "فشل الاتصال الآمن بـ Telegram");
        } catch (IOException e) {
            // لا نعرض e.getMessage(): قد يحوي عنوان الطلب وفيه التوكن.
            return cancelled(cancel) ? cancelledResult() : fail(Kind.NETWORK, "تعذّر الاتصال بـ Telegram");
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static boolean cancelled(Cancel c) { return c != null && c.cancelled; }

    private static Result cancelledResult() { return fail(Kind.CANCELLED, "أُلغي الإرسال"); }

    private static Result fail(Kind k, String m) { return new Result(null, new Err(k, m, 0, "")); }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return b.toString("UTF-8");
    }

    static Result parse(int httpCode, String body, String token) {
        JSONObject json;
        try {
            json = new JSONObject(body);
        } catch (JSONException e) {
            return httpCode >= 200 && httpCode < 300 ? fail(Kind.UNKNOWN, "رد غير مفهوم من Telegram")
                    : new Result(null, mapError(httpCode, "", 0));
        }
        if (json.optBoolean("ok")) return new Result(json, null);
        String detail = redact(json.optString("description", ""), token);
        JSONObject params = json.optJSONObject("parameters");
        int retry = params == null ? 0 : params.optInt("retry_after", 0);
        return new Result(null, mapError(json.optInt("error_code", httpCode), detail, retry));
    }

    static Err mapError(int code, String detail, int retry) {
        String lower = detail.toLowerCase();
        if (code == 401 || code == 404) return new Err(Kind.UNAUTHORIZED, "رمز البوت غير صحيح أو تم إلغاؤه", 0, detail);
        if (code == 403) return new Err(Kind.FORBIDDEN,
                "البوت لا يملك صلاحية الإرسال إلى هذه المحادثة (ابدأ محادثة معه بإرسال /start أو أضِفه كمشرف)", 0, detail);
        if (code == 429) return new Err(Kind.RATE_LIMIT,
                "تجاوزت حد الإرسال في Telegram" + (retry > 0 ? "، الانتظار " + retry + " ثانية" : ""), retry, detail);
        if (code == 409) return new Err(Kind.BAD_REQUEST, "تعارض: للبوت webhook مفعّل، لا يمكن قراءة التحديثات", 0, detail);
        if (code == 413) return new Err(Kind.BAD_REQUEST, "الملف كبير جدًا بالنسبة لـ Telegram", 0, detail);
        if (code == 400) {
            String m = lower.contains("chat not found") ? "لم يُعثر على المحادثة، تأكد من Chat ID"
                    : lower.contains("dimension") ? "أبعاد الصورة غير مدعومة كصورة"
                    : (lower.contains("too big") || lower.contains("too large")) ? "الملف كبير جدًا بالنسبة لـ Telegram"
                    : "طلب مرفوض من Telegram";
            return new Err(Kind.BAD_REQUEST, m, 0, detail);
        }
        if (code >= 500) return new Err(Kind.SERVER, "خطأ مؤقت في خوادم Telegram", 0, detail);
        return new Err(Kind.UNKNOWN, "خطأ غير متوقع (رمز " + code + ")", 0, detail);
    }
}
