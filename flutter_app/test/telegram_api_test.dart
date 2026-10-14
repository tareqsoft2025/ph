import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:photosync_telegram/core/telegram_api.dart';

const token = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefgh';

http.Response json(int code, Map<String, dynamic> body) =>
    http.Response(jsonEncode(body), code, headers: {'content-type': 'application/json'});

void main() {
  test('getMe يقرأ اسم البوت ويستدعي المسار الصحيح', () async {
    late Uri seen;
    final api = TelegramApi(client: MockClient((req) async {
      seen = req.url;
      return json(200, {'ok': true, 'result': {'id': 42, 'first_name': 'Photo', 'username': 'photo_bot'}});
    }));
    final r = await api.getMe(token);
    expect(r.ok, isTrue);
    expect(r.value!.username, 'photo_bot');
    expect(seen.path, '/bot$token/getMe');
  });

  test('401 يُترجم إلى unauthorized ولا يسرّب التوكن', () async {
    final api = TelegramApi(client: MockClient((req) async =>
        json(401, {'ok': false, 'error_code': 401, 'description': 'Unauthorized $token'})));
    final e = (await api.getMe(token)).error!;
    expect(e.kind, ErrorKind.unauthorized);
    expect(e.message.contains(token), isFalse);
    expect(e.detail.contains(token), isFalse);
  });

  test('429 يُرجع retry_after', () async {
    final api = TelegramApi(client: MockClient((req) async => json(429, {
          'ok': false, 'error_code': 429, 'description': 'Too Many Requests', 'parameters': {'retry_after': 7}
        })));
    final e = (await api.sendMessage(token, '1', 'x')).error!;
    expect(e.kind, ErrorKind.rateLimit);
    expect(e.retryAfter, 7);
  });

  test('chat not found رسالة عربية', () async {
    final api = TelegramApi(client: MockClient((req) async =>
        json(400, {'ok': false, 'error_code': 400, 'description': 'Bad Request: chat not found'})));
    final e = (await api.getChat(token, '9')).error!;
    expect(e.kind, ErrorKind.badRequest);
    expect(e.message, contains('Chat ID'));
  });

  test('getRecentChats يجمع محادثات مميزة', () async {
    final api = TelegramApi(client: MockClient((req) async => json(200, {
          'ok': true,
          'result': [
            {'update_id': 1, 'message': {'chat': {'id': 10, 'type': 'private', 'first_name': 'Ali'}}},
            {'update_id': 2, 'message': {'chat': {'id': 10, 'type': 'private', 'first_name': 'Ali'}}},
            {'update_id': 3, 'channel_post': {'chat': {'id': -100, 'type': 'channel', 'title': 'News'}}},
          ]
        })));
    final chats = (await api.getRecentChats(token)).value!;
    expect(chats.map((c) => c.id), [10, -100]);
    expect(chats[1].title, 'News');
  });

  test('انقطاع الشبكة = network بدون التوكن', () async {
    final api = TelegramApi(client: MockClient((req) async => throw http.ClientException('failed ${req.url}')));
    final e = (await api.getMe(token)).error!;
    expect(e.kind, ErrorKind.network);
    expect(e.message.contains(token), isFalse);
  });

  test('SendPolicy', () {
    const mb = 1024 * 1024;
    expect(SendPolicy.decide(2 * mb, false), 'photo');
    expect(SendPolicy.decide(2 * mb, true), 'document');
    expect(SendPolicy.decide(12 * mb, false), 'document');
    expect(SendPolicy.decide(51 * mb, true), 'tooLarge');
  });

  test('سياسة إعادة المحاولة', () {
    const net = ApiError(ErrorKind.network, 'x');
    expect(SendPolicy.backoff(net, 1), const Duration(seconds: 2));
    expect(SendPolicy.backoff(net, 3), isNull);
    expect(SendPolicy.backoff(const ApiError(ErrorKind.rateLimit, 'x', retryAfter: 5), 1), const Duration(seconds: 6));
    expect(SendPolicy.backoff(const ApiError(ErrorKind.rateLimit, 'x', retryAfter: 300), 1), isNull);
    expect(SendPolicy.backoff(const ApiError(ErrorKind.unauthorized, 'x'), 1), isNull);
  });

  test('redact', () => expect(redact('url/bot123:abc/x', '123:abc'), 'url/bot***/x'));
}
