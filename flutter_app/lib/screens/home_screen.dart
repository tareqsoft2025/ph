import 'package:flutter/material.dart';

import '../core/storage.dart';
import '../widgets.dart';
import 'telegram_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key, required this.onGo});
  final void Function(int) onGo;

  Future<(int, int)> _counts() async =>
      (await LogDb.instance.count(SendStatus.success), await LogDb.instance.count(SendStatus.failed));

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return ListenableBuilder(
      listenable: Listenable.merge([SettingsStore.instance, LogDb.instance.changes]),
      builder: (context, _) {
        final s = SettingsStore.instance.value;
        final connected = s.configured && s.verified;
        return ListView(padding: const EdgeInsets.all(16), children: [
          Text('PhotoSync Telegram', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          InfoCard(children: [
            Row(children: [
              Icon(connected ? Icons.check_circle : Icons.error_outline, color: connected ? successColor : warningColor),
              const SizedBox(width: 8),
              Text('حالة الاتصال', style: Theme.of(context).textTheme.titleMedium),
            ]),
            Text(!s.configured
                ? 'لم يتم إعداد البوت بعد'
                : !s.verified
                    ? 'البيانات محفوظة لكن لم تُختبر بعد'
                    : 'متصل بالبوت @${s.botUsername}'),
            OutlinedButton(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TelegramScreen())),
              child: Text(s.configured ? 'إدارة الاتصال' : 'إعداد Telegram'),
            ),
          ]),
          const SizedBox(height: 12),
          FutureBuilder<(int, int)>(
            future: _counts(),
            builder: (context, snap) {
              final (ok, failed) = snap.data ?? (0, 0);
              return Row(children: [
                Expanded(
                  child: InfoCard(children: [
                    Text('$ok', style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: successColor)),
                    const Text('صورة مرسلة'),
                  ]),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: InfoCard(children: [
                    Text('$failed', style: Theme.of(context).textTheme.headlineMedium?.copyWith(color: cs.error)),
                    const Text('إرسال فاشل'),
                  ]),
                ),
              ]);
            },
          ),
          const SizedBox(height: 12),
          InfoCard(children: [
            Text('الإرسال التلقائي', style: Theme.of(context).textTheme.titleMedium),
            Text(s.autoEnabled
                ? 'مفعّل — آخر فحص: ${s.lastAutoRunMillis > 0 ? formatMillis(s.lastAutoRunMillis) : 'لم يحدث بعد'}'
                : 'متوقف'),
            OutlinedButton(onPressed: () => onGo(3), child: const Text('إعدادات الأتمتة')),
          ]),
          const SizedBox(height: 12),
          FilledButton(onPressed: () => onGo(1), child: const Text('اختيار صور وإرسالها')),
        ]);
      },
    );
  }
}
