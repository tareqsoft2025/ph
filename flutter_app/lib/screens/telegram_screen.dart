import 'package:flutter/material.dart';

import '../core/services.dart';
import '../core/storage.dart';
import '../core/telegram_api.dart';
import '../widgets.dart';

final _tokenRegex = RegExp(r'^\d{5,}:[A-Za-z0-9_-]{20,}$');

class TelegramScreen extends StatefulWidget {
  const TelegramScreen({super.key});

  @override
  State<TelegramScreen> createState() => _TelegramScreenState();
}

class _TelegramScreenState extends State<TelegramScreen> {
  final _store = SettingsStore.instance;
  late final _token = TextEditingController(text: _store.value.botToken);
  late final _chat = TextEditingController(text: _store.value.chatId);
  bool _show = false, _busy = false;
  String? _msg;
  bool _msgOk = false;
  List<ChatInfo> _chats = [];

  void _say(String m, bool ok) => setState(() {
        _msg = m;
        _msgOk = ok;
      });

  String? _validate({bool needChat = true}) {
    final t = _token.text.trim();
    if (t.isEmpty) return 'أدخل رمز البوت (Bot Token)';
    if (!_tokenRegex.hasMatch(t)) return 'صيغة الرمز غير صحيحة، يجب أن تشبه 123456789:ABC...';
    if (needChat && _chat.text.trim().isEmpty) return 'أدخل Chat ID';
    return null;
  }

  Future<void> _save() async {
    final err = _validate();
    if (err != null) return _say(err, false);
    final t = _token.text.trim(), c = _chat.text.trim();
    await _store.update((s) => s.copyWith(
        botToken: t, chatId: c, verified: s.verified && s.botToken == t && s.chatId == c));
    _say('تم حفظ البيانات مشفّرة على الجهاز. اضغط «اختبار الاتصال» للتأكد.', true);
  }

  Future<void> _test() async {
    final err = _validate();
    if (err != null) return _say(err, false);
    final t = _token.text.trim(), c = _chat.text.trim();
    setState(() => _busy = true);
    final bot = await api.getMe(t);
    if (!bot.ok) {
      setState(() => _busy = false);
      return _say(bot.error!.message, false);
    }
    final chat = await api.getChat(t, c);
    setState(() => _busy = false);
    if (!chat.ok) return _say(chat.error!.message, false);
    await _store.update((s) => s.copyWith(botToken: t, chatId: c, botUsername: bot.value!.username, verified: true));
    _say('تم الاتصال بالبوت @${bot.value!.username} والمحادثة «${chat.value!.title}» بنجاح', true);
  }

  Future<void> _sendTest() async {
    final err = _validate();
    if (err != null) return _say(err, false);
    setState(() => _busy = true);
    final r = await api.sendMessage(_token.text.trim(), _chat.text.trim(), '✅ تم ربط PhotoSync Telegram بنجاح');
    setState(() => _busy = false);
    r.ok ? _say('أُرسلت رسالة الاختبار، تحقق من المحادثة', true) : _say(r.error!.message, false);
  }

  Future<void> _detect() async {
    final err = _validate(needChat: false);
    if (err != null) return _say(err, false);
    setState(() => _busy = true);
    final r = await api.getRecentChats(_token.text.trim());
    setState(() => _busy = false);
    if (!r.ok) return _say(r.error!.message, false);
    setState(() => _chats = r.value!);
    r.value!.isEmpty
        ? _say('لا توجد رسائل بعد. أرسل أي رسالة للبوت (أو انشر في المجموعة/القناة) ثم أعد المحاولة.', false)
        : _say('اختر المحادثة المطلوبة من القائمة', true);
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('إعداد Telegram')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const InfoCard(children: [
          Text('طريقة الحصول على البيانات', style: TextStyle(fontWeight: FontWeight.bold)),
          Text('١. افتح Telegram وابحث عن @BotFather ثم أرسل /newbot واتبع الخطوات للحصول على Bot Token.\n'
              '٢. محادثة خاصة: افتح بوتك وأرسل له /start.\n'
              '   مجموعة: أضف البوت وأرسل رسالة فيها.\n'
              '   قناة: أضف البوت كمشرف بصلاحية النشر، وأدخل @اسم_القناة أو رقمها.\n'
              '٣. اضغط «اكتشاف Chat ID» لعرض المحادثات التي راسلت البوت مؤخرًا.'),
        ]),
        const SizedBox(height: 12),
        TextField(
          controller: _token,
          obscureText: !_show,
          autocorrect: false,
          enableSuggestions: false,
          decoration: InputDecoration(
            labelText: 'Bot Token',
            border: const OutlineInputBorder(),
            suffixIcon: IconButton(
                icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show)),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _chat,
          decoration: const InputDecoration(
              labelText: 'Chat ID  (123456789 أو -100123… أو @channel)', border: OutlineInputBorder()),
        ),
        const SizedBox(height: 12),
        Wrap(spacing: 8, children: [
          OutlinedButton(onPressed: _busy ? null : _detect, child: const Text('اكتشاف Chat ID')),
          OutlinedButton(onPressed: _busy ? null : _save, child: const Text('حفظ')),
        ]),
        Wrap(spacing: 8, children: [
          for (final c in _chats)
            ActionChip(
              label: Text('${c.title.isEmpty ? 'بدون اسم' : c.title} (${c.type}) ${c.id}'),
              onPressed: () => setState(() => _chat.text = c.id.toString()),
            ),
        ]),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _test,
          icon: _busy
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.wifi_tethering),
          label: const Text('اختبار الاتصال'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: _busy ? null : _sendTest, child: const Text('إرسال رسالة اختبار')),
        if (_msg != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(_msg!, style: TextStyle(color: _msgOk ? successColor : cs.error)),
          ),
        const SizedBox(height: 16),
        const InfoCard(children: [
          Text('الخصوصية', style: TextStyle(fontWeight: FontWeight.bold)),
          Text('يُحفظ الرمز مشفّرًا على جهازك فقط (Android Keystore) ولا يُكتب في أي سجل. '
              'الصور المرسلة تصبح متاحة لجميع من لديهم حق الاطلاع على تلك المحادثة وفق إعداداتها.'),
        ]),
      ]),
    );
  }
}
