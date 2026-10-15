package com.photosync.telegram;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.util.Locale;

public class MainActivity extends Activity {
    static final int REQ_MEDIA = 1, REQ_PICK = 2, REQ_AUTO = 3;

    private FrameLayout content, overlay;
    private Screen[] tabs;
    private TextView[] tabViews;
    private Screen current;
    private Screen detail;
    private Screen detailParent;
    private TextView ovTitle, ovLine, ovCurrent;
    private ProgressBar ovBar;
    private Button ovButton;

    private final Runnable progressUpdate = new Runnable() { public void run() { updateOverlay(); } };

    @Override protected void attachBaseContext(Context base) {
        // الواجهة عربية بالكامل (RTL) بغض النظر عن لغة النظام، بما فيها النوافذ المنبثقة.
        Locale ar = new Locale("ar");
        Locale.setDefault(ar);
        Configuration cfg = new Configuration(base.getResources().getConfiguration());
        cfg.setLocale(ar);
        cfg.setLayoutDirection(ar);
        super.attachBaseContext(base.createConfigurationContext(cfg));
    }

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(UI.BG);
        getWindow().setNavigationBarColor(UI.CARD);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        tabs = new Screen[]{new HomeScreen(this), new GalleryScreen(this), new LogScreen(this), new AutomationScreen(this), new SettingsScreen(this)};
        String[] labels = {"🏠\nالرئيسية", "🖼\nالمعرض", "📋\nالسجل", "🔄\nالأتمتة", "⚙\nالإعدادات"};

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(UI.BG);
        LinearLayout main = UI.col(this);
        content = new FrameLayout(this);
        main.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout bar = UI.row(this);
        bar.setBackgroundColor(UI.CARD);
        tabViews = new TextView[tabs.length];
        for (int i = 0; i < tabs.length; i++) {
            final int idx = i;
            TextView t = UI.text(this, labels[i], 11, UI.MUTED, false);
            t.setGravity(Gravity.CENTER);
            t.setPadding(0, UI.dp(this, 8), 0, UI.dp(this, 8));
            t.setOnClickListener(new View.OnClickListener() { public void onClick(View v) { closeDetail(); showTab(idx); } });
            tabViews[i] = t;
            bar.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        }
        main.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(main, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        buildOverlay(root);
        setContentView(root);
        showTab(0);
    }

    private void buildOverlay(FrameLayout root) {
        overlay = new FrameLayout(this);
        overlay.setBackgroundColor(0x99000000);
        overlay.setClickable(true);
        overlay.setVisibility(View.GONE);
        LinearLayout card = UI.card(this);
        ovTitle = UI.heading(this, "");
        card.addView(ovTitle);
        ovBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        ovBar.setMax(1000);
        UI.add(card, ovBar, 12);
        ovLine = UI.add(card, UI.body(this, ""), 8);
        ovCurrent = UI.add(card, UI.small(this, ""), 4);
        ovButton = UI.add(card, UI.button(this, "إيقاف", true, new View.OnClickListener() {
            public void onClick(View v) {
                if (SendQueue.active) SendQueue.cancel(); else SendQueue.dismiss();
            }
        }), 12);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        lp.setMargins(UI.dp(this, 24), 0, UI.dp(this, 24), 0);
        overlay.addView(card, lp);
        root.addView(overlay, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void updateOverlay() {
        if (!SendQueue.active && !SendQueue.finished) { overlay.setVisibility(View.GONE); return; }
        overlay.setVisibility(View.VISIBLE);
        ovTitle.setText(SendQueue.active ? "جارٍ الإرسال…" : (SendQueue.cancelled ? "تم إيقاف الإرسال" : "اكتمل الإرسال"));
        ovBar.setProgress((int) (SendQueue.fraction() * 1000));
        ovLine.setText((SendQueue.succeeded + SendQueue.failed) + " من " + SendQueue.total + "  •  ناجح " + SendQueue.succeeded + "  •  فاشل " + SendQueue.failed);
        String extra = SendQueue.current != null ? SendQueue.current : "";
        if (!SendQueue.active && SendQueue.failed > 0) extra = "راجع «السجل» لمعرفة الأخطاء وإعادة المحاولة.";
        ovCurrent.setText(extra);
        ovButton.setText(SendQueue.active ? "إيقاف" : "تم");
    }

    @Override protected void onStart() {
        super.onStart();
        SendQueue.addListener(progressUpdate);
        updateOverlay();
        UpdateChecker.check(this, null); // فحص صامت؛ إشعار فقط إن وُجد إصدار أحدث
    }

    @Override protected void onStop() {
        SendQueue.removeListener(progressUpdate);
        super.onStop();
    }

    void showTab(int i) {
        if (current != null) current.onHide();
        current = tabs[i];
        content.removeAllViews();
        content.addView(current.view());
        for (int k = 0; k < tabViews.length; k++) {
            tabViews[k].setTextColor(k == i ? UI.PRIMARY : UI.MUTED);
            tabViews[k].setBackgroundColor(k == i ? UI.TINT : UI.CARD);
        }
        current.onShow();
    }

    void openDetail(Screen s) {
        detailParent = current;
        if (current != null) current.onHide();
        detail = s;
        current = s;
        content.removeAllViews();
        content.addView(s.view());
        s.onShow();
    }

    void closeDetail() {
        if (detail == null) return;
        detail.onHide();
        detail = null;
        Screen back = detailParent;
        detailParent = null;
        current = back;
        content.removeAllViews();
        content.addView(back.view());
        back.onShow();
    }

    @Override public void onBackPressed() {
        if (detail != null) closeDetail(); else super.onBackPressed();
    }

    void goToTab(int i) { closeDetail(); showTab(i); }

    void request(String[] perms, int code) { requestPermissions(perms, code); }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (current != null) current.onPermissions(code);
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (current != null) current.onResult(req, res, data);
    }
}
