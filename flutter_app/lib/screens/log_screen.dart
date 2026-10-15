import 'package:flutter/material.dart';

import '../core/services.dart';
import '../core/storage.dart';
import '../core/uploader.dart';
import '../widgets.dart';

class LogScreen extends StatefulWidget {
  const LogScreen({super.key});

  @override
  State<LogScreen> createState() => _LogScreenState();
}

class _LogScreenState extends State<LogScreen> {
  SendStatus? _filter;

  Future<void> _retry(LogEntry e) async {
    final ref = await PhotoRef.fromLog(e);
    if (ref == null) return toast(context, 'تعذّر العثور على الصورة، اخترها من المعرض من جديد');
    if (!SendController.instance.start([ref], e.asDoc)) toast(context, 'هناك عملية إرسال جارية، انتظر انتهاءها');
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return ValueListenableBuilder<int>(
      valueListenable: LogDb.instance.changes,
      builder: (context, _, __) => FutureBuilder<List<LogEntry>>(
        future: LogDb.instance.all(),
        builder: (context, snap) {
          final all = snap.data ?? [];
          final shown = all.where((e) => _filter == null || e.status == _filter).toList();
          return Column(children: [
            AppBar(title: const Text('سجل الإرسال'), actions: [
              IconButton(
                tooltip: 'مسح السجل',
                icon: const Icon(Icons.delete_sweep),
                onPressed: all.isEmpty
                    ? null
                    : () async {
                        if (await confirm(context, 'مسح السجل؟',
                            'سيُحذف سجل العمليات فقط، ولا تتأثر الصور على هاتفك ولا الرسائل في Telegram.', 'مسح')) {
                          await LogDb.instance.clear();
                        }
                      },
              ),
            ]),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Wrap(spacing: 8, children: [
                ChoiceChip(label: const Text('الكل'), selected: _filter == null, onSelected: (_) => setState(() => _filter = null)),
                ChoiceChip(label: const Text('ناجح'), selected: _filter == SendStatus.success, onSelected: (_) => setState(() => _filter = SendStatus.success)),
                ChoiceChip(label: const Text('فاشل'), selected: _filter == SendStatus.failed, onSelected: (_) => setState(() => _filter = SendStatus.failed)),
                ChoiceChip(label: const Text('قيد الانتظار'), selected: _filter == SendStatus.pending, onSelected: (_) => setState(() => _filter = SendStatus.pending)),
              ]),
            ),
            Expanded(
              child: shown.isEmpty
                  ? const Center(child: Text('لا توجد عمليات'))
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: shown.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, i) {
                        final e = shown[i];
                        final (label, color) = switch (e.status) {
                          SendStatus.success => ('ناجح', successColor),
                          SendStatus.failed => ('فاشل', cs.error),
                          SendStatus.pending => ('قيد الانتظار', warningColor),
                        };
                        return InfoCard(children: [
                          Row(children: [
                            Expanded(child: Text(e.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.titleSmall)),
                            Text(label, style: TextStyle(color: color, fontWeight: FontWeight.bold)),
                          ]),
                          Text('${formatMillis(e.updatedAt)} • ${formatSize(e.size)}${e.asDoc ? ' • ملف' : ''}${e.auto ? ' • تلقائي' : ''}',
                              style: Theme.of(context).textTheme.bodySmall),
                          if (e.status == SendStatus.failed && (e.error ?? '').isNotEmpty)
                            Text(e.error!, style: TextStyle(color: cs.error)),
                          Row(children: [
                            if (e.status != SendStatus.success)
                              TextButton(onPressed: () => _retry(e), child: const Text('إعادة المحاولة')),
                            TextButton(onPressed: () => LogDb.instance.delete(e.id!), child: const Text('حذف من السجل')),
                          ]),
                        ]);
                      },
                    ),
            ),
          ]);
        },
      ),
    );
  }
}
