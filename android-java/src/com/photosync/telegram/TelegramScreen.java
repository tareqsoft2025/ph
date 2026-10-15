package com.photosync.telegram;

import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.List;
import java.util.regex.Pattern;

final class TelegramScreen extends Screen {
    private static final Pattern TOKEN = Pattern.compile("^\\d{5,}:[A-Za-z0-9_-]{20,}$");
    private ScrollView root;
    private EditText token, chat;
    private TextView msg;
    private LinearLayout chats;
    private boolean show, busy;

    TelegramScreen(MainActivity a) { super(a); }

    @Override View view() {
        if (root != null) return root;
        Store s = Store.get(a);
        LinearLayout box = UI.col(a);
        LinearLayout head = UI.row(a);
        head.addView(UI.button(a, "→ رجوع", false, new View.OnClickListener() { public void onClick(View v) { a.closeDetail(); } }));
        TextView t = UI.title(a, "إعداد Telegram");
        t.setPadding(UI.dp(a, 12), 0, 0, 0);
        head.addView(t);
        box.addView(head);

        LinearLayout help = UI.add(box, UI.card(a), 12);
        help.addView(UI.heading(a, "طريقة الحصول على البيانات"));
        UI.add(help, UI.body(a, "١. افتح Telegram وابحث عن @BotFather ثم أرسل /newbot واتبع الخطوات للحصول على Bot Token.\n"
                + "٢. محادثة خاصة: افتح بوتك وأرسل له /start.\n"
                + "   مجموعة: أضف البوت وأرسل رسالة فيها.\n"
                + "   قناة: أضف البوت كمشرف بصلاحية النشر، وأدخل @اسم_القناة أو رقمها.\n"
                + "٣. اضغط «اكتشاف Chat ID» لعرض المحادثات التي راسلت البوت مؤخرًا."), 6);

        token = UI.add(box, UI.edit(a, "Bot Token"), 12);
        token.setText(s.token());
        applyVisibility();
        UI.add(box, UI.button(a, "إظهار / إخفاء الرمز", false, new View.OnClickListener() {
            public void onClick(View v) { show = !show; applyVisibility(); }
        }), 6);
        chat = UI.add(box, UI.edit(a, "Chat ID  (123456789 أو -100123… أو @channel)"), 12);
        chat.setText(s.chat());

        LinearLayout r1 = UI.add(box, UI.row(a), 12);
        r1.addView(UI.button(a, "اكتشاف Chat ID", false, new View.OnClickListener() { public void onClick(View v) { detect(); } }));
        View gap = new View(a);
        r1.addView(gap, new LinearLayout.LayoutParams(UI.dp(a, 8), 1));
        r1.addView(UI.button(a, "حفظ", false, new View.OnClickListener() { public void onClick(View v) { save(); } }));
        chats = UI.add(box, UI.col(a), 6);
        UI.add(box, UI.button(a, "اختبار الاتصال", true, new View.OnClickListener() { public void onClick(View v) { test(); } }), 12);
        UI.add(box, UI.button(a, "إرسال رسالة اختبار", false, new View.OnClickListener() { public void onClick(View v) { sendTest(); } }), 8);
        msg = UI.add(box, UI.body(a, ""), 12);

        LinearLayout priv = UI.add(box, UI.card(a), 16);
        priv.addView(UI.heading(a, "الخصوصية"));
        UI.add(priv, UI.small(a, "يُحفظ الرمز مشفّرًا على جهازك فقط (Android Keystore) ولا يُكتب في أي سجل. "
                + "الصور المرسلة تصبح متاحة لجميع من لديهم حق الاطلاع على تلك المحادثة وفق إعداداتها."), 6);
        root = UI.scroll(a, box);
        return root;
    }

    private void applyVisibility() {
        int pos = token.getSelectionStart();
        token.setInputType(InputType.TYPE_CLASS_TEXT | (show ? InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD : InputType.TYPE_TEXT_VARIATION_PASSWORD));
        token.setSingleLine(true);
        if (pos >= 0) token.setSelection(Math.min(pos, token.length()));
    }

    private void say(String m, boolean ok) {
        msg.setText(m);
        msg.setTextColor(ok ? UI.OK : UI.ERR);
    }

    private String validate(boolean needChat) {
        String t = token.getText().toString().trim();
        if (t.isEmpty()) return "أدخل رمز البوت (Bot Token)";
        if (!TOKEN.matcher(t).matches()) return "صيغة الرمز غير صحيحة، يجب أن تشبه 123456789:ABC...";
        if (needChat && chat.getText().toString().trim().isEmpty()) return "أدخل Chat ID";
        return null;
    }

    private void save() {
        String err = validate(true);
        if (err != null) { say(err, false); return; }
        Store s = Store.get(a);
        String t = token.getText().toString().trim(), c = chat.getText().toString().trim();
        boolean changed = !t.equals(s.token()) || !c.equals(s.chat());
        s.setCredentials(t, c);
        if (changed) s.setVerified(false, "");
        say("تم حفظ البيانات مشفّرة على الجهاز. اضغط «اختبار الاتصال» للتأكد.", true);
    }

    /** يشغّل العملية في خيط خلفي ويعيد النتيجة للواجهة. */
    private void async(final Runnable work) {
        if (busy) return;
        busy = true;
        say("جارٍ الاتصال…", true);
        new Thread(new Runnable() {
            public void run() {
                try { work.run(); } finally { busy = false; }
            }
        }).start();
    }

    private void post(final String m, final boolean ok) {
        a.runOnUiThread(new Runnable() { public void run() { say(m, ok); } });
    }

    private void test() {
        String err = validate(true);
        if (err != null) { say(err, false); return; }
        final String t = token.getText().toString().trim(), c = chat.getText().toString().trim();
        async(new Runnable() {
            public void run() {
                Telegram.Result bot = Telegram.getMe(t);
                if (!bot.ok()) { post(bot.err.message, false); return; }
                Telegram.Result ch = Telegram.getChat(t, c);
                if (!ch.ok()) { post(ch.err.message, false); return; }
                JSONObject me = bot.json.optJSONObject("result");
                String user = me == null ? "" : me.optString("username");
                Telegram.Chat info = Telegram.chat(ch.json.optJSONObject("result"));
                Store s = Store.get(a);
                s.setCredentials(t, c);
                s.setVerified(true, user);
                post("تم الاتصال بالبوت @" + user + " والمحادثة «" + info.title + "» بنجاح", true);
            }
        });
    }

    private void sendTest() {
        String err = validate(true);
        if (err != null) { say(err, false); return; }
        final String t = token.getText().toString().trim(), c = chat.getText().toString().trim();
        async(new Runnable() {
            public void run() {
                Telegram.Result r = Telegram.sendMessage(t, c, "✅ تم ربط PhotoSync Telegram بنجاح");
                if (r.ok()) post("أُرسلت رسالة الاختبار، تحقق من المحادثة", true); else post(r.err.message, false);
            }
        });
    }

    private void detect() {
        String err = validate(false);
        if (err != null) { say(err, false); return; }
        final String t = token.getText().toString().trim();
        async(new Runnable() {
            public void run() {
                Telegram.Result r = Telegram.getUpdates(t);
                if (!r.ok()) { post(r.err.message, false); return; }
                try {
                    final List<Telegram.Chat> list = Telegram.parseChats(r.json);
                    a.runOnUiThread(new Runnable() {
                        public void run() {
                            chats.removeAllViews();
                            for (final Telegram.Chat c : list) {
                                String label = (c.title.isEmpty() ? "بدون اسم" : c.title) + " (" + c.type + ") " + c.id;
                                UI.add(chats, UI.button(a, label, false, new View.OnClickListener() {
                                    public void onClick(View v) { chat.setText(String.valueOf(c.id)); }
                                }), 6);
                            }
                            if (list.isEmpty()) say("لا توجد رسائل بعد. أرسل أي رسالة للبوت (أو انشر في المجموعة/القناة) ثم أعد المحاولة.", false);
                            else say("اختر المحادثة المطلوبة من القائمة", true);
                        }
                    });
                } catch (Exception e) {
                    post("رد غير متوقع من Telegram", false);
                }
            }
        });
    }
}
