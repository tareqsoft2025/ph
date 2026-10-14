import 'package:flutter/material.dart';
import 'package:photo_manager/photo_manager.dart';

import '../core/auto_send.dart';
import '../core/storage.dart';
import '../widgets.dart';

class AutomationScreen extends StatefulWidget {
  const AutomationScreen({super.key});

  @override
  State<AutomationScreen> createState() => _AutomationScreenState();
}

class _AutomationScreenState extends State<AutomationScreen> {
  List<AssetPathEntity> _albums = [];

  @override
  void initState() {
    super.initState();
    _loadAlbums();
  }

  Future<void> _loadAlbums() async {
    final perm = await PhotoManager.getPermissionState(requestOption: const PermissionRequestOption());
    if (!perm.hasAccess) return;
    final a = await PhotoManager.getAssetPathList(type: RequestType.image, onlyAll: false);
    if (mounted) setState(() => _albums = a);
  }

  Future<void> _toggle(bool on) async {
    if (!on) return AutoSend.disable();
    if (!SettingsStore.instance.value.configured) return toast(context, 'أعدّ اتصال Telegram أولًا');
    final perm = await PhotoManager.requestPermissionExtend();
    if (!perm.hasAccess) return toast(context, 'لا يمكن تفعيل الإرسال التلقائي بدون إذن الصور');
    await requestNotificationPermission();
    await AutoSend.enable();
    _loadAlbums();
  }

  @override
  Widget build(BuildContext context) {
    final store = SettingsStore.instance;
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final s = store.value;
        return ListView(padding: const EdgeInsets.all(16), children: [
          Text('الإرسال التلقائي', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          InfoCard(color: Theme.of(context).colorScheme.primaryContainer, children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('تفعيل الإرسال التلقائي'),
              value: s.autoEnabled,
              onChanged: _toggle,
            ),
            const Text('عند التفعيل تُرسل الصور الجديدة فقط (المضافة بعد التفعيل). الصور الموجودة حاليًا لا تُرفع.'),
            if (s.autoEnabled) ...[
              Text('آخر فحص: ${s.lastAutoRunMillis > 0 ? '${formatMillis(s.lastAutoRunMillis)} — ${s.lastAutoSummary}' : 'لم يحدث بعد'}'),
              Wrap(spacing: 8, children: [
                OutlinedButton(
                  onPressed: () {
                    AutoSend.runNow();
                    toast(context, 'طُلب فحص الآن، سينفَّذ عند توفر الشروط');
                  },
                  child: const Text('فحص الآن'),
                ),
                const FilledButton(onPressed: AutoSend.disable, child: Text('إيقاف فورًا')),
              ]),
            ],
          ]),
          const SizedBox(height: 12),
          InfoCard(children: [
            Text('النطاق', style: Theme.of(context).textTheme.titleMedium),
            DropdownButton<String?>(
              isExpanded: true,
              value: _albums.any((a) => a.id == s.autoAlbumId) ? s.autoAlbumId : null,
              items: [
                const DropdownMenuItem(value: null, child: Text('كل الألبومات')),
                for (final a in _albums) DropdownMenuItem(value: a.id, child: Text(a.name)),
              ],
              onChanged: (id) {
                final name = _albums.where((a) => a.id == id).firstOrNull?.name;
                // تغيير النطاق يبدأ من الآن حتى لا تُرفع صور قديمة من ألبوم جديد
                store.update((x) => x.copyWith(
                      autoAlbumId: id,
                      autoAlbumName: name,
                      autoBaselineSec: x.autoEnabled ? DateTime.now().millisecondsSinceEpoch ~/ 1000 : x.autoBaselineSec,
                    ));
              },
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('إرسال كملف أصلي (بدون ضغط)'),
              value: s.autoAsDocument,
              onChanged: (v) => store.update((x) => x.copyWith(autoAsDocument: v)),
            ),
          ]),
          const SizedBox(height: 12),
          InfoCard(children: [
            Text('الشروط والتوقيت', style: Theme.of(context).textTheme.titleMedium),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('عبر Wi-Fi فقط'),
              value: s.autoWifiOnly,
              onChanged: (v) async {
                await store.update((x) => x.copyWith(autoWifiOnly: v));
                await AutoSend.schedule();
              },
            ),
            const Text('فترة الفحص'),
            Wrap(spacing: 8, children: [
              for (final (min, label) in [(15, '15 د'), (30, '30 د'), (60, 'ساعة'), (180, '3 ساعات'), (360, '6 ساعات')])
                ChoiceChip(
                  label: Text(label),
                  selected: s.autoIntervalMin == min,
                  onSelected: (_) async {
                    await store.update((x) => x.copyWith(autoIntervalMin: min));
                    await AutoSend.schedule();
                  },
                ),
            ]),
          ]),
          const SizedBox(height: 12),
          InfoCard(color: Theme.of(context).colorScheme.secondaryContainer, children: const [
            Text('تنبيه مهم', style: TextStyle(fontWeight: FontWeight.bold)),
            Text('الإرسال التلقائي يعتمد على WorkManager: الحد الأدنى للفترة 15 دقيقة، والتوقيت تقريبي وليس فوريًا ولا مضمونًا. '
                'قد يؤخره أو يمنعه توفير الطاقة (Doze) أو توفير البطارية أو «تقييد الخلفية» أو الإيقاف القسري للتطبيق. '
                'استثنِ التطبيق من تحسين البطارية للحصول على أفضل نتيجة. الصور الفاشلة تُعاد محاولتها حتى 5 مرات.'),
          ]),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () async {
              if (await confirm(context, 'مسح السجل؟',
                  'سيُمسح سجل الإرسال بالكامل. لن تُرسل الصور القديمة تلقائيًا مجددًا (تبدأ المتابعة من الآن).', 'مسح')) {
                await LogDb.instance.clear();
              }
            },
            child: const Text('مسح سجل الصور المعالجة'),
          ),
        ]);
      },
    );
  }
}
