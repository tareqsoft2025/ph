package com.photosync.telegram;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** أدوات بناء الواجهة برمجيًا (بدون XML ولا مكتبات خارجية). */
final class UI {
    static final int PRIMARY = 0xFF00796B, BG = 0xFFF6FAF9, CARD = 0xFFFFFFFF, TEXT = 0xFF1B1F1E, MUTED = 0xFF5F6B68,
            OK = 0xFF2E7D32, WARN = 0xFFEF6C00, ERR = 0xFFBA1A1A, TINT = 0xFFCCE8E3, STROKE = 0xFFDAE5E2;

    private UI() {}

    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    static GradientDrawable box(Context c, int color, float radiusDp, int stroke) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(c, radiusDp));
        if (stroke != 0) g.setStroke(dp(c, 1), stroke);
        return g;
    }

    static TextView text(Context c, String s, float sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    static TextView body(Context c, String s) { return text(c, s, 14, TEXT, false); }
    static TextView small(Context c, String s) { return text(c, s, 12, MUTED, false); }
    static TextView title(Context c, String s) { return text(c, s, 22, TEXT, true); }
    static TextView heading(Context c, String s) { return text(c, s, 16, TEXT, true); }

    static Button button(Context c, String label, boolean filled, View.OnClickListener l) {
        Button b = new Button(c);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setTextColor(filled ? Color.WHITE : PRIMARY);
        b.setBackground(box(c, filled ? PRIMARY : CARD, 20, filled ? 0 : PRIMARY));
        b.setMinHeight(dp(c, 40));
        b.setMinimumHeight(dp(c, 40));
        b.setPadding(dp(c, 14), 0, dp(c, 14), 0);
        b.setOnClickListener(l);
        return b;
    }

    static LinearLayout col(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    static LinearLayout card(Context c) {
        LinearLayout l = col(c);
        l.setBackground(box(c, CARD, 14, STROKE));
        int p = dp(c, 16);
        l.setPadding(p, p, p, p);
        return l;
    }

    static LinearLayout.LayoutParams lp(Context c, int w, int h, float weight, int topDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h, weight);
        p.topMargin = dp(c, topDp);
        return p;
    }

    /** يضيف عرضًا بعرض كامل وهامش علوي. */
    static <T extends View> T add(ViewGroup parent, T v, int topDp) {
        parent.addView(v, lp(parent.getContext(), ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, 0, topDp));
        return v;
    }

    static ScrollView scroll(Context c, View content) {
        ScrollView s = new ScrollView(c);
        s.setFillViewport(true);
        int p = dp(c, 16);
        content.setPadding(p, p, p, p);
        s.addView(content, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return s;
    }

    static EditText edit(Context c, String hint) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setSingleLine(true);
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        e.setBackground(box(c, CARD, 10, STROKE));
        int p = dp(c, 12);
        e.setPadding(p, p, p, p);
        return e;
    }

    static LinearLayout switchRow(Context c, String label, boolean checked, CompoundButton.OnCheckedChangeListener l) {
        LinearLayout r = row(c);
        TextView t = body(c, label);
        r.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Switch s = new Switch(c);
        s.setChecked(checked);
        s.setOnCheckedChangeListener(l);
        r.addView(s);
        return r;
    }

    static void toast(Context c, String m) { Toast.makeText(c, m, Toast.LENGTH_LONG).show(); }

    static String date(long ms) { return new SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.US).format(new Date(ms)); }

    static String size(long b) {
        if (b <= 0) return "—";
        if (b < 1024 * 1024) return Math.round(b / 1024.0) + " KB";
        return String.format(Locale.US, "%.1f MB", b / (1024.0 * 1024.0));
    }
}
