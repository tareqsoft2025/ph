import 'package:flutter/material.dart';
import 'package:photo_manager/photo_manager.dart';

import '../core/auto_send.dart';
import '../core/storage.dart';
import '../widgets.dart';
import 'telegram_screen.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: SettingsStore.instance,
      builder: (context, _) {
        final s = SettingsStore.instance.value;
        return ListView(padding: const EdgeInsets.all(16), children: [
          Text('الإعدادات والخصوصية', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          InfoCard(children: [
            Text('الإرسال', style: Theme.of(context).textTheme.titleMedium),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('إرسال كملف أصلي افتراضيًا'),
              value: s.sendAsDocument,
              onChanged: (v) => SettingsStore.instance.update((x) => x.copyWith(sendAsDocument: v)),
            ),
            const Text('الصور الأكبر من 10MB تُرسل تلقائيًا كملف، والحد الأقصى 50MB (قيود Telegram).'),
            OutlinedButton(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TelegramScreen())),
              child: const Text('بيانات Telegram'),
            ),
          ]),
          const SizedBox(height: 12),
          const InfoCard(children: [
            Text('الخصوصية', style: TextStyle(fontWeight: FontWeight.bold)),
            Text('• لا يُرفع أي شيء قبل أن تختاره وتؤكد الإرسال، أو تفعّل الإرسال التلقائي صراحةً.\n'
                '• الصور تُرسل إلى محادثة Telegram التي حددتها فقط، ولا يوجد أي خادم آخر أو تحليلات.\n'
                '• الصور المرسلة تصبح متاحة لمن لديهم صلاحية الاطلاع على تلك المحادثة، وتبقى على خوادم Telegram وفق سياستها.\n'
                '• يُحفظ Bot Token مشفّرًا (Android Keystore) ولا يُسجَّل في أي سجل.\n'
                '• يطلب التطبيق إذن الصور فقط، ويمكنك استخدام منتقي الصور بدون إذن.\n'
                '• لا تضمّن توكنًا خاصًا بك في تطبيق توزعه على آخرين؛ يُدخل كل مستخدم بوته أو يُستخدم خادم وسيط آمن.'),
          ]),
          const SizedBox(height: 12),
          InfoCard(children: [
            Text('التحكم', style: Theme.of(context).textTheme.titleMedium),
            FilledButton(onPressed: s.autoEnabled ? AutoSend.disable : null, child: const Text('إيقاف الأتمتة فورًا')),
            OutlinedButton(
              onPressed: () async {
                if (await confirm(context, 'مسح السجل؟', 'سيُحذف سجل العمليات بالكامل.', 'مسح')) await LogDb.instance.clear();
              },
              child: const Text('مسح سجل الإرسال'),
            ),
            OutlinedButton(
              onPressed: () async {
                if (await confirm(context, 'حذف بيانات الاعتماد؟', 'سيُحذف Bot Token وChat ID وتُوقف الأتمتة.', 'حذف')) {
                  await AutoSend.disable();
                  await SettingsStore.instance
                      .update((x) => x.copyWith(botToken: '', chatId: '', botUsername: '', verified: false));
                }
              },
              child: const Text('حذف بيانات الاعتماد من الجهاز'),
            ),
            const OutlinedButton(onPressed: PhotoManager.openSetting, child: Text('صلاحيات التطبيق في النظام')),
          ]),
          const SizedBox(height: 8),
          Text('الإصدار 1.0.0', style: Theme.of(context).textTheme.labelSmall),
        ]);
      },
    );
  }
}
