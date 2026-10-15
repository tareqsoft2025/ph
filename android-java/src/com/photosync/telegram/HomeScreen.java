package com.photosync.telegram;

import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;

final class HomeScreen extends Screen {
    private ScrollView root;
    private LinearLayout box;
    private final Runnable refresh = new Runnable() { public void run() { render(); } };

    HomeScreen(MainActivity a) { super(a); }

    @Override View view() {
        if (root == null) {
            box = UI.col(a);
            root = UI.scroll(a, box);
        }
        return root;
    }

    @Override void onShow() { LogDb.addListener(refresh); render(); }
    @Override void onHide() { LogDb.removeListener(refresh); }

    private void render() {
        Store s = Store.get(a);
        LogDb db = LogDb.get(a);
        box.removeAllViews();
        box.addView(UI.title(a, "PhotoSync Telegram"));

        LinearLayout conn = UI.add(box, UI.card(a), 14);
        boolean ok = s.configured() && s.verified();
        conn.addView(UI.text(a, (ok ? "✔ " : "⚠ ") + "حالة الاتصال", 16, ok ? UI.OK : UI.WARN, true));
        UI.add(conn, UI.body(a, !s.configured() ? "لم يتم إعداد البوت بعد"
                : !s.verified() ? "البيانات محفوظة لكن لم تُختبر بعد" : "متصل بالبوت @" + s.botUser()), 6);
        UI.add(conn, UI.button(a, s.configured() ? "إدارة الاتصال" : "إعداد Telegram", false, new View.OnClickListener() {
            public void onClick(View v) { a.openDetail(new TelegramScreen(a)); }
        }), 10);

        LinearLayout stats = UI.row(a);
        LinearLayout c1 = UI.card(a), c2 = UI.card(a);
        c1.addView(UI.text(a, String.valueOf(db.count(LogDb.SUCCESS)), 28, UI.OK, true));
        c1.addView(UI.body(a, "صورة مرسلة"));
        c2.addView(UI.text(a, String.valueOf(db.count(LogDb.FAILED)), 28, UI.ERR, true));
        c2.addView(UI.body(a, "إرسال فاشل"));
        LinearLayout.LayoutParams l1 = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        LinearLayout.LayoutParams l2 = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        l2.setMarginStart(UI.dp(a, 12));
        stats.addView(c1, l1);
        stats.addView(c2, l2);
        UI.add(box, stats, 12);

        LinearLayout auto = UI.add(box, UI.card(a), 12);
        auto.addView(UI.heading(a, "الإرسال التلقائي"));
        UI.add(auto, UI.body(a, s.autoOn()
                ? "مفعّل — آخر فحص: " + (s.lastRun() > 0 ? UI.date(s.lastRun()) : "لم يحدث بعد") : "متوقف"), 6);
        UI.add(auto, UI.button(a, "إعدادات الأتمتة", false, new View.OnClickListener() {
            public void onClick(View v) { a.goToTab(3); }
        }), 10);

        UI.add(box, UI.button(a, "اختيار صور وإرسالها", true, new View.OnClickListener() {
            public void onClick(View v) { a.goToTab(1); }
        }), 14);
    }
}
