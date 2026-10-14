import 'dart:io';

import 'package:image_picker/image_picker.dart';
import 'package:photo_manager/photo_manager.dart';

import 'storage.dart';
import 'telegram_api.dart';

/// مرجع لصورة قابلة للإرسال: من المعرض ([asset]) أو من منتقي الصور ([path]).
class PhotoRef {
  PhotoRef({required this.key, required this.name, this.asset, this.path});

  final String key, name;
  final AssetEntity? asset;
  final String? path;

  Future<File?> file() async {
    if (asset != null) return asset!.originFile;
    return path == null ? null : File(path!);
  }

  static Future<PhotoRef> fromAsset(AssetEntity a) async =>
      PhotoRef(key: 'a:${a.id}', name: (await a.titleAsync).isEmpty ? '${a.id}.jpg' : await a.titleAsync, asset: a);

  static Future<PhotoRef> fromPicked(XFile f) async {
    final len = await f.length();
    return PhotoRef(key: 'p:${f.name}:$len', name: f.name, path: f.path);
  }

  /// يعيد بناء المرجع من مفتاح السجل (لإعادة المحاولة).
  static Future<PhotoRef?> fromLog(LogEntry e) async {
    if (e.key.startsWith('a:')) {
      final a = await AssetEntity.fromId(e.key.substring(2));
      return a == null ? null : PhotoRef(key: e.key, name: e.name, asset: a);
    }
    return null; // ملفات المنتقي مؤقتة؛ يجب اختيارها من جديد
  }
}

class CancelFlag {
  bool cancelled = false;
}

class UploadOutcome {
  const UploadOutcome(this.ok, {this.kind, this.message});
  final bool ok;
  final ErrorKind? kind;
  final String? message;
}

/// يرسل صورة واحدة مع إعادة المحاولة وتحديث السجل.
class Uploader {
  Uploader(this.api, this.settings, this.db);
  final TelegramApi api;
  final SettingsStore settings;
  final LogDb db;

  Future<void> markPending(PhotoRef p, {required bool asDoc, required bool auto}) async {
    final ex = await db.find(p.key);
    await db.upsert(LogEntry(
      key: p.key, name: p.name, size: ex?.size ?? 0, status: SendStatus.pending,
      attempts: ex?.attempts ?? 0, asDoc: asDoc, auto: auto, updatedAt: _now(),
    ));
  }

  Future<void> failIfPending(PhotoRef p, String message) async {
    final ex = await db.find(p.key);
    if (ex != null && ex.status == SendStatus.pending) {
      await db.upsert(LogEntry(
        key: ex.key, name: ex.name, size: ex.size, status: SendStatus.failed, error: message,
        attempts: ex.attempts, asDoc: ex.asDoc, auto: ex.auto, updatedAt: _now(),
      ));
    }
  }

  Future<UploadOutcome> upload(PhotoRef p, {required bool asDoc, required bool auto, CancelFlag? cancel}) async {
    final ex = await db.find(p.key);
    final attempts = (ex?.attempts ?? 0) + 1;
    var size = 0;

    Future<UploadOutcome> finish(SendStatus s, {ErrorKind? kind, String? error}) async {
      await db.upsert(LogEntry(
        key: p.key, name: p.name, size: size, status: s, error: error,
        attempts: attempts, asDoc: asDoc, auto: auto, updatedAt: _now(),
      ));
      return UploadOutcome(s == SendStatus.success, kind: kind, message: error);
    }

    final s = settings.value;
    if (!s.configured) return finish(SendStatus.failed, kind: ErrorKind.unauthorized, error: 'إعدادات Telegram غير مكتملة');

    File? file;
    try {
      file = await p.file();
      if (file == null || !await file.exists()) throw const FileSystemException();
      size = await file.length();
    } catch (_) {
      return finish(SendStatus.failed, kind: ErrorKind.file, error: 'تعذّر قراءة الملف (حُذف أو لم تعد الصلاحية متاحة)');
    }

    final mode = SendPolicy.decide(size, asDoc);
    if (mode == 'tooLarge') {
      return finish(SendStatus.failed, kind: ErrorKind.file, error: 'حجم الملف يتجاوز 50MB (حد Telegram)');
    }
    var useDoc = mode == 'document';

    var attempt = 0;
    while (true) {
      if (cancel?.cancelled ?? false) return finish(SendStatus.failed, kind: ErrorKind.cancelled, error: 'أُلغي الإرسال');
      attempt++;
      final r = await api.sendFile(s.botToken, s.chatId, asDocument: useDoc, path: file.path, fileName: p.name);
      if (cancel?.cancelled ?? false) return finish(SendStatus.failed, kind: ErrorKind.cancelled, error: 'أُلغي الإرسال');
      if (r.ok) return finish(SendStatus.success);
      final err = r.error!;
      if (!useDoc && err.kind == ErrorKind.badRequest && err.detail.toLowerCase().contains('dimension')) {
        useDoc = true; // أبعاد غير مناسبة كصورة: نرسلها كملف أصلي
        continue;
      }
      final wait = SendPolicy.backoff(err, attempt);
      if (wait == null) return finish(SendStatus.failed, kind: err.kind, error: err.message);
      await Future<void>.delayed(wait);
    }
  }

  int _now() => DateTime.now().millisecondsSinceEpoch;
}
