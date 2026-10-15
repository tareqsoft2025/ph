import 'package:flutter/foundation.dart';

import 'storage.dart';
import 'telegram_api.dart';
import 'uploader.dart';

/// كائنات مشتركة (تُنشأ مرة لكل isolate).
final TelegramApi api = TelegramApi();
final Uploader uploader = Uploader(api, SettingsStore.instance, LogDb.instance);

/// ينفّذ الإرسال اليدوي بالتتابع، مع تقدّم وإمكانية الإيقاف.
class SendController extends ChangeNotifier {
  SendController._();
  static final SendController instance = SendController._();

  bool active = false, finished = false, cancelled = false;
  int total = 0, succeeded = 0, failed = 0;
  String? current;
  CancelFlag? _flag;

  double get fraction => total == 0 ? 0 : (succeeded + failed) / total;

  /// false إن كانت هناك عملية جارية أو لا توجد عناصر.
  bool start(List<PhotoRef> items, bool asDoc) {
    if (active || items.isEmpty) return false;
    active = true;
    finished = false;
    cancelled = false;
    total = items.length;
    succeeded = failed = 0;
    current = null;
    _flag = CancelFlag();
    notifyListeners();
    _run(items, asDoc, _flag!);
    return true;
  }

  Future<void> _run(List<PhotoRef> items, bool asDoc, CancelFlag flag) async {
    var processed = 0;
    try {
      for (final p in items) {
        await uploader.markPending(p, asDoc: asDoc, auto: false);
      }
      for (final p in items) {
        if (flag.cancelled) break;
        current = p.name;
        notifyListeners();
        final out = await uploader.upload(p, asDoc: asDoc, auto: false, cancel: flag);
        processed++;
        out.ok ? succeeded++ : failed++;
        notifyListeners();
        if (processed < items.length && !flag.cancelled) {
          await Future<void>.delayed(const Duration(milliseconds: 1100)); // حد Telegram ~1 رسالة/ثانية
        }
      }
    } finally {
      if (flag.cancelled) {
        for (final p in items.skip(processed)) {
          await uploader.failIfPending(p, 'أُلغي الإرسال');
        }
      }
      cancelled = flag.cancelled;
      active = false;
      finished = true;
      current = null;
      notifyListeners();
    }
  }

  void cancel() {
    _flag?.cancelled = true;
    api.cancelInFlight();
  }

  void dismiss() {
    if (active) return;
    finished = false;
    notifyListeners();
  }
}
