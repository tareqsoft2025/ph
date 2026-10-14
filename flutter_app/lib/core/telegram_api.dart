import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

enum ErrorKind { network, rateLimit, unauthorized, forbidden, badRequest, server, file, cancelled, unknown }

class ApiError {
  const ApiError(this.kind, this.message, {this.retryAfter, this.detail = ''});

  final ErrorKind kind;

  /// رسالة عربية للمستخدم (لا تحتوي على التوكن أبدًا).
  final String message;
  final int? retryAfter;

  /// وصف Telegram الأصلي بعد إزالة التوكن.
  final String detail;
}

class ApiResult<T> {
  const ApiResult.ok(this.value) : error = null;
  const ApiResult.err(this.error) : value = null;

  final T? value;
  final ApiError? error;
  bool get ok => error == null;
}

class BotInfo {
  const BotInfo(this.id, this.username, this.name);
  final int id;
  final String username;
  final String name;
}

class ChatInfo {
  const ChatInfo(this.id, this.title, this.type);
  final int id;
  final String title;
  final String type;
}

/// حدود Telegram Bot API.
class SendPolicy {
  static const photoMaxBytes = 10 * 1024 * 1024;
  static const documentMaxBytes = 50 * 1024 * 1024;

  /// 'photo' | 'document' | 'tooLarge'
  static String decide(int sizeBytes, bool wantDocument) {
    if (sizeBytes > documentMaxBytes) return 'tooLarge';
    if (wantDocument || sizeBytes > photoMaxBytes) return 'document';
    return 'photo';
  }

  /// مهلة الانتظار قبل إعادة المحاولة؛ null = توقف نهائي.
  static Duration? backoff(ApiError e, int attempt) {
    switch (e.kind) {
      case ErrorKind.network:
      case ErrorKind.server:
        return attempt < 3 ? Duration(seconds: 2 * attempt) : null;
      case ErrorKind.rateLimit:
        final wait = e.retryAfter ?? 5;
        return (attempt < 4 && wait <= 60) ? Duration(seconds: wait + 1) : null;
      default:
        return null;
    }
  }
}

String redact(String text, String token) => token.isEmpty ? text : text.replaceAll(token, '***');

class TelegramApi {
  TelegramApi({http.Client? client, this.baseUrl = 'https://api.telegram.org'})
      : _client = client ?? http.Client();

  http.Client _client;
  final String baseUrl;

  /// يقطع أي طلب جارٍ (لزر الإيقاف).
  void cancelInFlight() {
    _client.close();
    _client = http.Client();
  }

  Future<ApiResult<BotInfo>> getMe(String token) async {
    final r = await _call(token, 'getMe', {});
    if (!r.ok) return ApiResult.err(r.error);
    final m = r.value!['result'] as Map<String, dynamic>;
    return ApiResult.ok(BotInfo(m['id'] as int, (m['username'] ?? '') as String, (m['first_name'] ?? '') as String));
  }

  Future<ApiResult<ChatInfo>> getChat(String token, String chatId) async {
    final r = await _call(token, 'getChat', {'chat_id': chatId});
    if (!r.ok) return ApiResult.err(r.error);
    return ApiResult.ok(_chat(r.value!['result'] as Map<String, dynamic>));
  }

  /// آخر المحادثات التي راسلت البوت (لمعرفة Chat ID).
  Future<ApiResult<List<ChatInfo>>> getRecentChats(String token) async {
    final r = await _call(token, 'getUpdates', {'limit': '100'});
    if (!r.ok) return ApiResult.err(r.error);
    final chats = <int, ChatInfo>{};
    for (final u in (r.value!['result'] as List)) {
      final m = u as Map<String, dynamic>;
      for (final k in ['message', 'channel_post', 'edited_message', 'my_chat_member']) {
        final chat = (m[k] as Map<String, dynamic>?)?['chat'];
        if (chat is Map<String, dynamic>) {
          final c = _chat(chat);
          chats[c.id] = c;
          break;
        }
      }
    }
    return ApiResult.ok(chats.values.toList());
  }

  Future<ApiResult<void>> sendMessage(String token, String chatId, String text) async {
    final r = await _call(token, 'sendMessage', {'chat_id': chatId, 'text': text});
    return r.ok ? const ApiResult.ok(null) : ApiResult.err(r.error);
  }

  Future<ApiResult<void>> sendFile(
    String token,
    String chatId, {
    required bool asDocument,
    required String path,
    required String fileName,
  }) async {
    final field = asDocument ? 'document' : 'photo';
    final file = await http.MultipartFile.fromPath(field, path, filename: fileName);
    final r = await _call(token, asDocument ? 'sendDocument' : 'sendPhoto', {'chat_id': chatId}, file: file);
    return r.ok ? const ApiResult.ok(null) : ApiResult.err(r.error);
  }

  ChatInfo _chat(Map<String, dynamic> c) {
    var title = (c['title'] ?? '') as String;
    if (title.isEmpty) {
      title = [c['first_name'], c['last_name']].whereType<String>().where((s) => s.isNotEmpty).join(' ');
    }
    if (title.isEmpty) title = (c['username'] ?? '') as String;
    return ChatInfo(c['id'] as int, title, (c['type'] ?? '') as String);
  }

  Future<ApiResult<Map<String, dynamic>>> _call(
    String token,
    String method,
    Map<String, String> fields, {
    http.MultipartFile? file,
  }) async {
    final Uri uri;
    try {
      uri = Uri.parse('$baseUrl/bot$token/$method');
    } on FormatException {
      return const ApiResult.err(ApiError(ErrorKind.badRequest, 'صيغة رمز البوت غير صحيحة'));
    }
    try {
      final req = http.MultipartRequest('POST', uri)..fields.addAll(fields);
      if (file != null) req.files.add(file);
      final streamed = await _client.send(req).timeout(const Duration(minutes: 5));
      final res = await http.Response.fromStream(streamed);
      return parseResponse(res.statusCode, utf8.decode(res.bodyBytes, allowMalformed: true), token);
    } on TimeoutException {
      return const ApiResult.err(ApiError(ErrorKind.network, 'انتهت مهلة الاتصال بـ Telegram'));
    } on SocketException {
      return const ApiResult.err(ApiError(ErrorKind.network, 'لا يوجد اتصال بالإنترنت'));
    } on HandshakeException {
      return const ApiResult.err(ApiError(ErrorKind.network, 'فشل الاتصال الآمن بـ Telegram'));
    } on http.ClientException {
      // رسالة الاستثناء قد تحوي عنوان الطلب (وفيه التوكن) فلا نعرضها.
      return const ApiResult.err(ApiError(ErrorKind.network, 'تعذّر الاتصال بـ Telegram'));
    }
  }

  ApiResult<Map<String, dynamic>> parseResponse(int code, String body, String token) {
    Map<String, dynamic> json;
    try {
      json = jsonDecode(body) as Map<String, dynamic>;
    } catch (_) {
      return ApiResult.err(code >= 200 && code < 300
          ? const ApiError(ErrorKind.unknown, 'رد غير مفهوم من Telegram')
          : mapError(code, '', null));
    }
    if (json['ok'] == true) return ApiResult.ok(json);
    final detail = redact((json['description'] ?? '') as String, token);
    final retry = (json['parameters'] as Map<String, dynamic>?)?['retry_after'] as int?;
    return ApiResult.err(mapError((json['error_code'] as int?) ?? code, detail, retry));
  }

  static ApiError mapError(int code, String detail, int? retryAfter) {
    final lower = detail.toLowerCase();
    if (code == 401 || code == 404) {
      return ApiError(ErrorKind.unauthorized, 'رمز البوت غير صحيح أو تم إلغاؤه', detail: detail);
    }
    if (code == 403) {
      return ApiError(ErrorKind.forbidden,
          'البوت لا يملك صلاحية الإرسال إلى هذه المحادثة (ابدأ محادثة معه بإرسال /start أو أضِفه كمشرف)',
          detail: detail);
    }
    if (code == 429) {
      return ApiError(ErrorKind.rateLimit,
          'تجاوزت حد الإرسال في Telegram${retryAfter != null ? '، الانتظار $retryAfter ثانية' : ''}',
          retryAfter: retryAfter, detail: detail);
    }
    if (code == 409) {
      return ApiError(ErrorKind.badRequest, 'تعارض: للبوت webhook مفعّل، لا يمكن قراءة التحديثات', detail: detail);
    }
    if (code == 413) {
      return ApiError(ErrorKind.badRequest, 'الملف كبير جدًا بالنسبة لـ Telegram', detail: detail);
    }
    if (code == 400) {
      final msg = lower.contains('chat not found')
          ? 'لم يُعثر على المحادثة، تأكد من Chat ID'
          : lower.contains('dimension')
              ? 'أبعاد الصورة غير مدعومة كصورة'
              : (lower.contains('too big') || lower.contains('too large'))
                  ? 'الملف كبير جدًا بالنسبة لـ Telegram'
                  : 'طلب مرفوض من Telegram';
      return ApiError(ErrorKind.badRequest, msg, detail: detail);
    }
    if (code >= 500) return ApiError(ErrorKind.server, 'خطأ مؤقت في خوادم Telegram', detail: detail);
    return ApiError(ErrorKind.unknown, 'خطأ غير متوقع (رمز $code)', detail: detail);
  }
}
