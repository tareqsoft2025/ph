import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'core/services.dart';

const successColor = Color(0xFF2E7D32);
const warningColor = Color(0xFFEF6C00);

String formatSize(int bytes) {
  if (bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

String formatDate(DateTime d) => DateFormat('yyyy/MM/dd HH:mm').format(d);
String formatMillis(int ms) => formatDate(DateTime.fromMillisecondsSinceEpoch(ms));

class InfoCard extends StatelessWidget {
  const InfoCard({super.key, required this.children, this.color});
  final List<Widget> children;
  final Color? color;

  @override
  Widget build(BuildContext context) => Card(
        color: color ?? Theme.of(context).colorScheme.surfaceContainerHighest.withOpacity(0.5),
        elevation: 0,
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            for (final c in children) Padding(padding: const EdgeInsets.only(bottom: 8), child: c),
          ]),
        ),
      );
}

Future<bool> confirm(BuildContext context, String title, String text, String action) async =>
    await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: Text(text),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: Text(action)),
        ],
      ),
    ) ??
    false;

void toast(BuildContext context, String msg) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

/// نافذة تقدم الإرسال مع زر إيقاف ثم ملخص النتيجة.
class SendProgressOverlay extends StatelessWidget {
  const SendProgressOverlay({super.key});

  @override
  Widget build(BuildContext context) {
    final c = SendController.instance;
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        if (!c.active && !c.finished) return const SizedBox.shrink();
        return Material(
          color: Colors.black54,
          child: Center(
            child: Card(
              margin: const EdgeInsets.all(24),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(c.active ? 'جارٍ الإرسال…' : (c.cancelled ? 'تم إيقاف الإرسال' : 'اكتمل الإرسال'),
                      style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 12),
                  LinearProgressIndicator(value: c.fraction),
                  const SizedBox(height: 8),
                  Text('${c.succeeded + c.failed} من ${c.total}  •  ناجح ${c.succeeded}  •  فاشل ${c.failed}'),
                  if (c.current != null) Text(c.current!, maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (!c.active && c.failed > 0) const Text('راجع «السجل» لمعرفة الأخطاء وإعادة المحاولة.'),
                  const SizedBox(height: 8),
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: c.active
                        ? TextButton(onPressed: c.cancel, child: const Text('إيقاف'))
                        : TextButton(onPressed: c.dismiss, child: const Text('تم')),
                  ),
                ]),
              ),
            ),
          ),
        );
      },
    );
  }
}
