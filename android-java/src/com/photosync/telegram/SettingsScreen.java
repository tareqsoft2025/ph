package com.photosync.telegram;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;

final class SettingsScreen extends Screen {
    private ScrollView root;
    private LinearLayout box;

    SettingsScreen(MainActivity a) { super(a); }

    @Override View view() {
        if (root == null) { box = UI.col(a); root = UI.scroll(a, box); }
        return root;
    }

    @Override void onShow() { render(); }

    private void confirm(String title, String text, String action, final Runnable run) {
        new AlertDialog.Builder(a).setTitle(title).setMessage(text)
                .setPositiveButton(action, new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface d, int w) { run.run(); render(); }
                })
                .setNegativeButton("إلغاء", null).show();
    }

    private void render() {
        final Store s = Store.get(a);
        box.removeAllViews();
        box.addView(UI.title(a, "الإعدادات والخصوصية"));

        LinearLayout send = UI.add(box, UI.card(a), 14);
        send.addView(UI.heading(a, "الإرسال"));
        UI.add(send, UI.switchRow(a, "إرسال كملف أصلي افتراضيًا", s.sendAsDoc(), new CompoundButton.OnCheckedChangeListener() {
            public void onCheckedChanged(CompoundButton b, boolean v) { s.setSendAsDoc(v); }
        }), 8);
        UI.add(send, UI.small(a, "الصور الأكبر من 10MB تُرسل تلقائيًا كملف، والحد الأقصى 50MB (قيود Telegram)."), 6);
        UI.add(send, UI.button(a, "بيانات Telegram", false, new View.OnClickListener() {
            public void onClick(View v) { a.openDetail(new TelegramScreen(a)); }
        }), 10);

        LinearLayout priv = UI.add(box, UI.card(a), 12);
        priv.addView(UI.heading(a, "الخصوصية"));
        UI.add(priv, UI.small(a, "• لا يُرفع أي شيء قبل أن تختاره وتؤكد الإرسال، أو تفعّل الإرسال التلقائي صراحةً.\n"
                + "• الصور تُرسل إلى محادثة Telegram التي حددتها فقط، ولا يوجد أي خادم آخر أو تحليلات.\n"
                + "• الصور المرسلة تصبح متاحة لمن لديهم صلاحية الاطلاع على تلك المحادثة، وتبقى على خوادم Telegram وفق سياستها.\n"
                + "• يُحفظ Bot Token مشفّرًا (Android Keystore) ولا يُسجَّل في أي سجل.\n"
                + "• يطلب التطبيق إذن الصور فقط، ويمكنك استخدام منتقي الصور بدون إذن.\n"
                + "• لا تضمّن توكنًا خاصًا بك في تطبيق توزعه على آخرين؛ يُدخل كل مستخدم بوته أو يُستخدم خادم وسيط آمن."), 6);

        LinearLayout ctl = UI.add(box, UI.card(a), 12);
        ctl.addView(UI.heading(a, "التحكم"));
        UI.add(ctl, UI.button(a, "إيقاف الأتمتة فورًا", true, new View.OnClickListener() {
            public void onClick(View v) { Auto.disable(a); render(); UI.toast(a, "أُوقف الإرسال التلقائي"); }
        }), 10);
        UI.add(ctl, UI.button(a, "مسح سجل الإرسال", false, new View.OnClickListener() {
            public void onClick(View v) {
                confirm("مسح السجل؟", "سيُحذف سجل العمليات بالكامل.", "مسح", new Runnable() { public void run() { LogDb.get(a).clear(a); } });
            }
        }), 8);
        UI.add(ctl, UI.button(a, "حذف بيانات الاعتماد من الجهاز", false, new View.OnClickListener() {
            public void onClick(View v) {
                confirm("حذف بيانات الاعتماد؟", "سيُحذف Bot Token وChat ID وتُوقف الأتمتة.", "حذف", new Runnable() {
                    public void run() { Auto.disable(a); s.clearCredentials(); }
                });
            }
        }), 8);
        UI.add(ctl, UI.button(a, "صلاحيات التطبيق في النظام", false, new View.OnClickListener() {
            public void onClick(View v) {
                a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", a.getPackageName(), null)));
            }
        }), 8);

        LinearLayout upd = UI.add(box, UI.card(a), 12);
        upd.addView(UI.heading(a, "التحديثات"));
        UI.add(upd, UI.small(a, "لا يوجد متجر لهذا التطبيق؛ التحقق هنا يفتح فقط رابط تنزيل الإصدار الجديد، ولا يثبّت شيئًا تلقائيًا."), 6);
        UI.add(upd, UI.button(a, "تحقق من وجود تحديث", false, new View.OnClickListener() {
            public void onClick(View v) {
                UI.toast(a, "جارٍ التحقق…");
                UpdateChecker.check(a, new UpdateChecker.Callback() {
                    public void onResult(boolean hasUpdate, String versionName, String notes, String error) {
                        if (error != null) { UI.toast(a, error); return; }
                        if (!hasUpdate) { UI.toast(a, "لديك أحدث إصدار (" + UpdateChecker.installedVersionName(a) + ")"); return; }
                        UI.toast(a, "إصدار " + versionName + " متوفر — افتح الإشعار لتنزيله");
                    }
                });
            }
        }), 8);
        UI.add(box, UI.small(a, "الإصدار " + UpdateChecker.installedVersionName(a)), 12);
    }
}
