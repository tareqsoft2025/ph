import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:workmanager/workmanager.dart';

import 'services.dart';
import 'storage.dart';
import 'telegram_api.dart';
import 'uploader.dart';

const _periodicName = 'auto_send_periodic';
const _taskName = 'auto_send';
const _ongoingId = 1001;
const _resultId = 1002;
const stopActionId = 'stop_auto';

final FlutterLocalNotificationsPlugin _notifications = FlutterLocalNotificationsPlugin();

Future<void> initNotifications({void Function(NotificationResponse)? onResponse}) async {
  await _notifications.initialize(
    const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')),
    onDidReceiveNotificationResponse: onResponse,
  );
}

Future<void> requestNotificationPermission() async {
  await _notifications
      .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      ?.requestNotificationsPermission();
}

Future<void> _showOngoing() async {
  await _notifications.show(
    _ongoingId,
    'الإرسال التلقائي مفعّل',
    'تُفحص الصور الجديدة دوريًا وتُرسل إلى Telegram (ليس فوريًا)',
    const NotificationDetails(
      android: AndroidNotificationDetails(
        'auto_status', 'حالة الإرسال التلقائي',
        importance: Importance.low, priority: Priority.low,
        ongoing: true, autoCancel: false, onlyAlertOnce: true,
        actions: [AndroidNotificationAction(stopActionId, 'إيقاف', showsUserInterface: true)],
      ),
    ),
  );
}

Future<void> _notifyResult(String text) async {
  await _notifications.show(
    _resultId,
    'PhotoSync Telegram',
    text,
    const NotificationDetails(
      android: AndroidNotificationDetails('auto_result', 'نتائج الإرسال التلقائي',
          importance: Importance.defaultImportance),
    ),
  );
}

/// نقطة التحكم الوحيدة في الإرسال التلقائي.
class AutoSend {
  static Constraints _constraints(bool wifiOnly) =>
      Constraints(networkType: wifiOnly ? NetworkType.unmetered : NetworkType.connected);

  static Future<void> init() async {
    await Workmanager().initialize(callbackDispatcher, isInDebugMode: false);
  }

  /// الصور المضافة قبل لحظة التفعيل لا تُرسل أبدًا.
  static Future<void> enable() async {
    final store = SettingsStore.instance;
    await store.update((s) => s.copyWith(
          autoEnabled: true,
          autoBaselineSec: s.autoEnabled ? s.autoBaselineSec : DateTime.now().millisecondsSinceEpoch ~/ 1000,
        ));
    await schedule();
    await _showOngoing();
  }

  static Future<void> disable() async {
    await SettingsStore.instance.update((s) => s.copyWith(autoEnabled: false));
    await Workmanager().cancelByUniqueName(_periodicName);
    await _notifications.cancel(_ongoingId);
  }

  static Future<void> schedule() async {
    final s = SettingsStore.instance.value;
    if (!s.autoEnabled) return;
    await Workmanager().registerPeriodicTask(
      _periodicName,
      _taskName,
      frequency: Duration(minutes: s.autoIntervalMin),
      existingWorkPolicy: ExistingWorkPolicy.update,
      constraints: _constraints(s.autoWifiOnly),
    );
  }

  static Future<void> runNow() async {
    final s = SettingsStore.instance.value;
    if (!s.autoEnabled) return;
    await Workmanager().registerOneOffTask(
      'auto_send_once_${DateTime.now().millisecondsSinceEpoch}',
      _taskName,
      constraints: _constraints(s.autoWifiOnly),
    );
  }
}

@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, input) async {
    WidgetsFlutterBinding.ensureInitialized();
    try {
      return await runAutoSendOnce();
    } catch (_) {
      return false; // WorkManager سيعيد المحاولة لاحقًا
    }
  });
}

/// يفحص الصور الجديدة ويرسلها. يُرجع false فقط لطلب إعادة المحاولة (مشكلة شبكة).
Future<bool> runAutoSendOnce() async {
  final store = SettingsStore.instance;
  await store.load();
  final s = store.value;
  if (!s.autoEnabled) return true;
  await initNotifications();
  await _showOngoing();

  Future<void> summary(String t) =>
      store.update((v) => v.copyWith(lastAutoRunMillis: DateTime.now().millisecondsSinceEpoch, lastAutoSummary: t));

  if (!s.configured) {
    await summary('إعدادات Telegram غير مكتملة');
    return true;
  }
  final perm = await PhotoManager.getPermissionState(requestOption: const PermissionRequestOption());
  if (!perm.hasAccess) {
    await summary('صلاحية الصور غير ممنوحة');
    await _notifyResult('الإرسال التلقائي متوقف: صلاحية الصور غير ممنوحة');
    return true;
  }

  final since = DateTime.fromMillisecondsSinceEpoch(s.autoBaselineSec * 1000);
  final filter = FilterOptionGroup(
    createTimeCond: DateTimeCond(min: since, max: DateTime.now().add(const Duration(days: 1))),
    orders: [const OrderOption(type: OrderOptionType.createDate, asc: false)],
  );
  final paths = await PhotoManager.getAssetPathList(type: RequestType.image, onlyAll: s.autoAlbumId == null, filterOption: filter);
  final path = s.autoAlbumId == null
      ? (paths.isEmpty ? null : paths.first)
      : paths.where((p) => p.id == s.autoAlbumId).firstOrNull;
  final assets = path == null ? <AssetEntity>[] : await path.getAssetListRange(start: 0, end: 200);
  final fresh = assets.where((a) => a.createDateTime.isAfter(since)).toList();

  final blocked = await LogDb.instance.blockedKeys(fresh.map((a) => 'a:${a.id}'));
  final todo = fresh.where((a) => !blocked.contains('a:${a.id}')).toList().reversed.toList(); // الأقدم أولًا
  if (todo.isEmpty) {
    await summary('لا توجد صور جديدة');
    return true;
  }

  var ok = 0, failed = 0, retry = false;
  for (var i = 0; i < todo.length; i++) {
    final ref = await PhotoRef.fromAsset(todo[i]);
    await uploader.markPending(ref, asDoc: s.autoAsDocument, auto: true);
    final out = await uploader.upload(ref, asDoc: s.autoAsDocument, auto: true);
    out.ok ? ok++ : failed++;
    if (out.kind == ErrorKind.network || out.kind == ErrorKind.rateLimit) {
      retry = true;
      break;
    }
    if (i < todo.length - 1) await Future<void>.delayed(const Duration(milliseconds: 1100));
  }
  final text = 'أُرسلت $ok صورة${failed > 0 ? '، وفشلت $failed' : ''}';
  await summary(text);
  await _notifyResult(text);
  return !retry;
}
