import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

class AppSettings {
  const AppSettings({
    this.botToken = '',
    this.chatId = '',
    this.botUsername = '',
    this.verified = false,
    this.sendAsDocument = false,
    this.autoEnabled = false,
    this.autoWifiOnly = true,
    this.autoIntervalMin = 60,
    this.autoAlbumId,
    this.autoAlbumName,
    this.autoAsDocument = false,
    this.autoBaselineSec = 0,
    this.lastAutoRunMillis = 0,
    this.lastAutoSummary = '',
  });

  final String botToken, chatId, botUsername;
  final bool verified, sendAsDocument, autoEnabled, autoWifiOnly, autoAsDocument;
  final int autoIntervalMin;
  final String? autoAlbumId, autoAlbumName;

  /// الصور الأحدث من هذا الوقت (ثوانٍ) فقط تُرسل تلقائيًا.
  final int autoBaselineSec;
  final int lastAutoRunMillis;
  final String lastAutoSummary;

  bool get configured => botToken.isNotEmpty && chatId.isNotEmpty;

  AppSettings copyWith({
    String? botToken,
    String? chatId,
    String? botUsername,
    bool? verified,
    bool? sendAsDocument,
    bool? autoEnabled,
    bool? autoWifiOnly,
    int? autoIntervalMin,
    Object? autoAlbumId = _keep,
    Object? autoAlbumName = _keep,
    bool? autoAsDocument,
    int? autoBaselineSec,
    int? lastAutoRunMillis,
    String? lastAutoSummary,
  }) =>
      AppSettings(
        botToken: botToken ?? this.botToken,
        chatId: chatId ?? this.chatId,
        botUsername: botUsername ?? this.botUsername,
        verified: verified ?? this.verified,
        sendAsDocument: sendAsDocument ?? this.sendAsDocument,
        autoEnabled: autoEnabled ?? this.autoEnabled,
        autoWifiOnly: autoWifiOnly ?? this.autoWifiOnly,
        autoIntervalMin: autoIntervalMin ?? this.autoIntervalMin,
        autoAlbumId: identical(autoAlbumId, _keep) ? this.autoAlbumId : autoAlbumId as String?,
        autoAlbumName: identical(autoAlbumName, _keep) ? this.autoAlbumName : autoAlbumName as String?,
        autoAsDocument: autoAsDocument ?? this.autoAsDocument,
        autoBaselineSec: autoBaselineSec ?? this.autoBaselineSec,
        lastAutoRunMillis: lastAutoRunMillis ?? this.lastAutoRunMillis,
        lastAutoSummary: lastAutoSummary ?? this.lastAutoSummary,
      );
}

const Object _keep = Object();

/// التوكن وChat ID في التخزين المشفّر (Android Keystore)، وباقي الإعدادات في SharedPreferences.
class SettingsStore extends ChangeNotifier {
  SettingsStore._();
  static final SettingsStore instance = SettingsStore._();

  static const _secure = FlutterSecureStorage(aOptions: AndroidOptions(encryptedSharedPreferences: true));

  AppSettings value = const AppSettings();

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload(); // مهم داخل عملية الخلفية
    String token = '', chat = '';
    try {
      token = await _secure.read(key: 'token') ?? '';
      chat = await _secure.read(key: 'chat') ?? '';
    } catch (_) {
      await _secure.deleteAll(); // مخزن مفاتيح تالف: نبدأ من جديد
    }
    value = AppSettings(
      botToken: token,
      chatId: chat,
      botUsername: prefs.getString('botUser') ?? '',
      verified: prefs.getBool('verified') ?? false,
      sendAsDocument: prefs.getBool('sendDoc') ?? false,
      autoEnabled: prefs.getBool('autoOn') ?? false,
      autoWifiOnly: prefs.getBool('autoWifi') ?? true,
      autoIntervalMin: prefs.getInt('autoInterval') ?? 60,
      autoAlbumId: prefs.getString('autoAlbumId'),
      autoAlbumName: prefs.getString('autoAlbumName'),
      autoAsDocument: prefs.getBool('autoDoc') ?? false,
      autoBaselineSec: prefs.getInt('baseline') ?? 0,
      lastAutoRunMillis: prefs.getInt('lastRun') ?? 0,
      lastAutoSummary: prefs.getString('lastSummary') ?? '',
    );
    notifyListeners();
  }

  Future<void> update(AppSettings Function(AppSettings) change) async {
    final next = change(value);
    final prefs = await SharedPreferences.getInstance();
    if (next.botToken.isEmpty) {
      await _secure.delete(key: 'token');
    } else {
      await _secure.write(key: 'token', value: next.botToken);
    }
    if (next.chatId.isEmpty) {
      await _secure.delete(key: 'chat');
    } else {
      await _secure.write(key: 'chat', value: next.chatId);
    }
    Future<void> setStr(String k, String? v) async => v == null ? prefs.remove(k) : prefs.setString(k, v);
    await setStr('botUser', next.botUsername);
    await prefs.setBool('verified', next.verified);
    await prefs.setBool('sendDoc', next.sendAsDocument);
    await prefs.setBool('autoOn', next.autoEnabled);
    await prefs.setBool('autoWifi', next.autoWifiOnly);
    await prefs.setInt('autoInterval', next.autoIntervalMin);
    await setStr('autoAlbumId', next.autoAlbumId);
    await setStr('autoAlbumName', next.autoAlbumName);
    await prefs.setBool('autoDoc', next.autoAsDocument);
    await prefs.setInt('baseline', next.autoBaselineSec);
    await prefs.setInt('lastRun', next.lastAutoRunMillis);
    await setStr('lastSummary', next.lastAutoSummary);
    value = next;
    notifyListeners();
  }
}

enum SendStatus { pending, success, failed }

class LogEntry {
  const LogEntry({
    this.id,
    required this.key,
    required this.name,
    required this.size,
    required this.status,
    this.error,
    this.attempts = 0,
    this.asDoc = false,
    this.auto = false,
    required this.updatedAt,
  });

  final int? id;
  final String key, name;
  final int size;
  final SendStatus status;
  final String? error;
  final int attempts;
  final bool asDoc, auto;
  final int updatedAt;

  Map<String, Object?> toMap() => {
        if (id != null) 'id': id,
        'key': key,
        'name': name,
        'size': size,
        'status': status.name,
        'error': error,
        'attempts': attempts,
        'as_doc': asDoc ? 1 : 0,
        'auto': auto ? 1 : 0,
        'updated_at': updatedAt,
      };

  static LogEntry fromMap(Map<String, Object?> m) => LogEntry(
        id: m['id'] as int,
        key: m['key'] as String,
        name: m['name'] as String,
        size: (m['size'] as int?) ?? 0,
        status: SendStatus.values.byName(m['status'] as String),
        error: m['error'] as String?,
        attempts: (m['attempts'] as int?) ?? 0,
        asDoc: m['as_doc'] == 1,
        auto: m['auto'] == 1,
        updatedAt: m['updated_at'] as int,
      );
}

/// سجل الإرسال (SQLite). المفتاح [LogEntry.key] فريد لمنع تكرار الصورة نفسها.
class LogDb {
  LogDb._();
  static final LogDb instance = LogDb._();

  /// يتغير بعد كل كتابة ليحدّث الواجهات.
  final ValueNotifier<int> changes = ValueNotifier(0);
  Database? _db;

  Future<Database> get _database async => _db ??= await openDatabase(
        p.join(await getDatabasesPath(), 'photosync.db'),
        version: 1,
        onCreate: (db, _) => db.execute('''
          CREATE TABLE send_log(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            error TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            as_doc INTEGER NOT NULL DEFAULT 0,
            auto INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
          )'''),
      );

  Future<LogEntry?> find(String key) async {
    final rows = await (await _database).query('send_log', where: 'key = ?', whereArgs: [key], limit: 1);
    return rows.isEmpty ? null : LogEntry.fromMap(rows.first);
  }

  Future<void> upsert(LogEntry e) async {
    final db = await _database;
    final existing = await find(e.key);
    if (existing == null) {
      await db.insert('send_log', e.toMap());
    } else {
      await db.update('send_log', LogEntry(
        id: existing.id, key: e.key, name: e.name, size: e.size, status: e.status, error: e.error,
        attempts: e.attempts, asDoc: e.asDoc, auto: e.auto, updatedAt: e.updatedAt,
      ).toMap(), where: 'id = ?', whereArgs: [existing.id]);
    }
    changes.value++;
  }

  Future<List<LogEntry>> all() async =>
      (await (await _database).query('send_log', orderBy: 'updated_at DESC')).map(LogEntry.fromMap).toList();

  Future<int> count(SendStatus s) async => Sqflite.firstIntValue(
          await (await _database).rawQuery('SELECT COUNT(*) FROM send_log WHERE status = ?', [s.name])) ??
      0;

  Future<Set<String>> successKeys() async =>
      (await (await _database).query('send_log', columns: ['key'], where: "status = 'success'"))
          .map((r) => r['key'] as String)
          .toSet();

  /// مفاتيح يجب ألا يعيد الإرسال التلقائي إرسالها الآن.
  Future<Set<String>> blockedKeys(Iterable<String> keys, {int maxAttempts = 5}) async {
    final cutoff = DateTime.now().millisecondsSinceEpoch - 30 * 60 * 1000;
    final blocked = <String>{};
    final list = keys.toList();
    for (var i = 0; i < list.length; i += 400) {
      final chunk = list.sublist(i, i + 400 > list.length ? list.length : i + 400);
      final marks = List.filled(chunk.length, '?').join(',');
      final rows = await (await _database).rawQuery(
        'SELECT key FROM send_log WHERE key IN ($marks) AND ('
        "status = 'success' OR (status = 'pending' AND updated_at > ?) OR (status = 'failed' AND attempts >= ?))",
        [...chunk, cutoff, maxAttempts],
      );
      blocked.addAll(rows.map((r) => r['key'] as String));
    }
    return blocked;
  }

  Future<void> delete(int id) async {
    await (await _database).delete('send_log', where: 'id = ?', whereArgs: [id]);
    changes.value++;
  }

  /// يمسح السجل. إن كانت الأتمتة مفعّلة نعيد نقطة البداية إلى الآن كي لا تُرسل الصور القديمة مجددًا.
  Future<void> clear() async {
    await (await _database).delete('send_log');
    changes.value++;
    final s = SettingsStore.instance;
    if (s.value.autoEnabled) {
      await s.update((v) => v.copyWith(autoBaselineSec: DateTime.now().millisecondsSinceEpoch ~/ 1000));
    }
  }
}
