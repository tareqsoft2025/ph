package com.photosync.telegram;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.os.Build;
import android.view.View;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.Switch;

import java.util.ArrayList;
import java.util.List;

final class AutomationScreen extends Screen {
    private static final int[] MINUTES = {15, 30, 60, 180, 360};
    private static final String[] LABELS = {"كل 15 دقيقة", "كل 30 دقيقة", "كل ساعة", "كل 3 ساعات", "كل 6 ساعات"};
    private ScrollView root;
    private LinearLayout box;
    private boolean updating;

    AutomationScreen(MainActivity a) { super(a); }

    @Override View view() {
        if (root == null) { box = UI.col(a); root = UI.scroll(a, box); }
        return root;
    }

    @Override void onShow() { render(); }

    @Override void onPermissions(int req) {
        if (req == MainActivity.REQ_AUTO) {
            if (Media.hasAccess(a)) { Auto.enable(a); } else { UI.toast(a, "لا يمكن تفعيل الإرسال التلقائي بدون إذن الصور"); }
            render();
        }
    }

    private void requestEnable() {
        Store s = Store.get(a);
        if (!s.configured()) { UI.toast(a, "أعدّ اتصال Telegram أولًا"); render(); return; }
        if (!Media.hasAccess(a) || (Build.VERSION.SDK_INT >= 33
                && a.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED)) {
            List<String> perms = new ArrayList<>();
            for (String p : Media.permissions()) perms.add(p);
            if (Build.VERSION.SDK_INT >= 33) perms.add("android.permission.POST_NOTIFICATIONS");
            a.request(perms.toArray(new String[0]), MainActivity.REQ_AUTO);
            return;
        }
        Auto.enable(a);
        render();
    }

    private void render() {
        final Store s = Store.get(a);
        box.removeAllViews();
        box.addView(UI.title(a, "الإرسال التلقائي"));

        LinearLayout main = UI.add(box, UI.card(a), 14);
        main.setBackground(UI.box(a, UI.TINT, 14, 0));
        Switch sw = new Switch(a);
        LinearLayout swRow = UI.switchRow(a, "تفعيل الإرسال التلقائي", s.autoOn(), new CompoundButton.OnCheckedChangeListener() {
            public void onCheckedChanged(CompoundButton b, boolean on) {
                if (updating) return;
                if (on) requestEnable(); else { Auto.disable(a); render(); }
            }
        });
        main.addView(swRow);
        UI.add(main, UI.small(a, "عند التفعيل تُرسل الصور الجديدة فقط (المضافة بعد التفعيل). الصور الموجودة حاليًا لا تُرفع."), 6);
        if (s.autoOn()) {
            UI.add(main, UI.small(a, "آخر فحص: " + (s.lastRun() > 0 ? UI.date(s.lastRun()) + " — " + s.lastSummary() : "لم يحدث بعد")), 6);
            LinearLayout acts = UI.add(main, UI.row(a), 8);
            acts.addView(UI.button(a, "فحص الآن", false, new View.OnClickListener() {
                public void onClick(View v) { Auto.runNow(a); UI.toast(a, "طُلب فحص الآن، سينفَّذ عند توفر الشروط"); }
            }));
            View gap = new View(a);
            acts.addView(gap, new LinearLayout.LayoutParams(UI.dp(a, 8), 1));
            acts.addView(UI.button(a, "إيقاف فورًا", true, new View.OnClickListener() {
                public void onClick(View v) { Auto.disable(a); render(); }
            }));
        }

        LinearLayout scope = UI.add(box, UI.card(a), 12);
        scope.addView(UI.heading(a, "النطاق"));
        String album = s.autoBucketName() != null ? s.autoBucketName() : "كل الألبومات";
        UI.add(scope, UI.button(a, "الألبوم: " + album, false, new View.OnClickListener() {
            public void onClick(View v) { pickAlbum(); }
        }), 8);
        UI.add(scope, UI.switchRow(a, "إرسال كملف أصلي (بدون ضغط)", s.autoAsDoc(), new CompoundButton.OnCheckedChangeListener() {
            public void onCheckedChanged(CompoundButton b, boolean v) { s.setAutoAsDoc(v); }
        }), 8);

        LinearLayout cond = UI.add(box, UI.card(a), 12);
        cond.addView(UI.heading(a, "الشروط والتوقيت"));
        UI.add(cond, UI.switchRow(a, "عبر Wi-Fi فقط", s.autoWifi(), new CompoundButton.OnCheckedChangeListener() {
            public void onCheckedChanged(CompoundButton b, boolean v) { s.setAutoWifi(v); Auto.schedule(a); }
        }), 8);
        UI.add(cond, UI.body(a, "فترة الفحص"), 8);
        RadioGroup g = new RadioGroup(a);
        for (int i = 0; i < MINUTES.length; i++) {
            RadioButton rb = new RadioButton(a);
            rb.setText(LABELS[i]);
            rb.setId(1000 + i);
            rb.setChecked(s.autoInterval() == MINUTES[i]);
            g.addView(rb);
        }
        g.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
            public void onCheckedChanged(RadioGroup group, int id) {
                s.setAutoInterval(MINUTES[id - 1000]);
                Auto.schedule(a);
            }
        });
        cond.addView(g);

        LinearLayout warn = UI.add(box, UI.card(a), 12);
        warn.setBackground(UI.box(a, 0xFFFFF3E0, 14, 0));
        warn.addView(UI.heading(a, "تنبيه مهم"));
        UI.add(warn, UI.small(a, "الإرسال التلقائي يعتمد على JobScheduler: الحد الأدنى للفترة 15 دقيقة، والتوقيت تقريبي وليس فوريًا ولا مضمونًا. "
                + "قد يؤخره أو يمنعه توفير الطاقة (Doze) أو توفير البطارية أو «تقييد الخلفية» أو الإيقاف القسري للتطبيق. "
                + "استثنِ التطبيق من تحسين البطارية للحصول على أفضل نتيجة. الصور الفاشلة تُعاد محاولتها حتى 5 مرات."), 6);

        UI.add(box, UI.button(a, "مسح سجل الصور المعالجة", false, new View.OnClickListener() {
            public void onClick(View v) {
                new AlertDialog.Builder(a).setTitle("مسح السجل؟")
                        .setMessage("سيُمسح سجل الإرسال بالكامل. لن تُرسل الصور القديمة تلقائيًا مجددًا (تبدأ المتابعة من الآن).")
                        .setPositiveButton("مسح", new DialogInterface.OnClickListener() {
                            public void onClick(DialogInterface d, int w) { LogDb.get(a).clear(a); UI.toast(a, "تم المسح"); }
                        }).setNegativeButton("إلغاء", null).show();
            }
        }), 14);
    }

    private void pickAlbum() {
        if (!Media.hasAccess(a)) { UI.toast(a, "امنح إذن الصور أولًا من المعرض"); return; }
        final List<Item.Bucket> buckets = Media.buckets(a);
        String[] names = new String[buckets.size() + 1];
        names[0] = "كل الألبومات";
        for (int i = 0; i < buckets.size(); i++) names[i + 1] = buckets.get(i).name + " (" + buckets.get(i).count + ")";
        new AlertDialog.Builder(a).setTitle("اختر الألبوم").setItems(names, new DialogInterface.OnClickListener() {
            public void onClick(DialogInterface d, int which) {
                Store s = Store.get(a);
                if (which == 0) s.setAutoBucket(null, null);
                else s.setAutoBucket(buckets.get(which - 1).id, buckets.get(which - 1).name);
                if (s.autoOn()) s.resetBaselineNow(); // نطاق جديد يبدأ من الآن
                render();
            }
        }).show();
    }
}
