package com.photosync.telegram;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class LogScreen extends Screen {
    private LinearLayout root;
    private ListView list;
    private TextView empty;
    private Button[] filters;
    private String filter; // null = الكل
    private List<LogDb.Entry> shown = new ArrayList<>();
    private BaseAdapter adapter;
    private final Runnable refresh = new Runnable() { public void run() { load(); } };

    LogScreen(MainActivity a) { super(a); }

    @Override View view() {
        if (root != null) return root;
        root = UI.col(a);
        int p = UI.dp(a, 16);
        LinearLayout head = UI.row(a);
        head.setPadding(p, p, p, 0);
        TextView t = UI.title(a, "سجل الإرسال");
        head.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        head.addView(UI.button(a, "مسح السجل", false, new View.OnClickListener() {
            public void onClick(View v) {
                new AlertDialog.Builder(a).setTitle("مسح السجل؟")
                        .setMessage("سيُحذف سجل العمليات فقط، ولا تتأثر الصور على هاتفك ولا الرسائل في Telegram.")
                        .setPositiveButton("مسح", new DialogInterface.OnClickListener() {
                            public void onClick(DialogInterface d, int w) { LogDb.get(a).clear(a); }
                        }).setNegativeButton("إلغاء", null).show();
            }
        }));
        root.addView(head);

        LinearLayout bar = UI.row(a);
        bar.setPadding(p, UI.dp(a, 8), p, UI.dp(a, 8));
        String[] labels = {"الكل", "ناجح", "فاشل", "قيد الانتظار"};
        final String[] values = {null, LogDb.SUCCESS, LogDb.FAILED, LogDb.PENDING};
        filters = new Button[4];
        for (int i = 0; i < 4; i++) {
            final String v = values[i];
            Button b = UI.button(a, labels[i], false, new View.OnClickListener() {
                public void onClick(View x) { filter = v; load(); }
            });
            b.setPadding(UI.dp(a, 6), 0, UI.dp(a, 6), 0);
            filters[i] = b;
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
            lp.setMarginEnd(UI.dp(a, 4));
            bar.addView(b, lp);
        }
        root.addView(bar);

        empty = UI.body(a, "لا توجد عمليات");
        empty.setPadding(p, p, p, p);
        root.addView(empty);
        list = new ListView(a);
        list.setDividerHeight(0);
        list.setClipToPadding(false);
        list.setPadding(p, 0, p, p);
        adapter = new BaseAdapter() {
            public int getCount() { return shown.size(); }
            public Object getItem(int i) { return shown.get(i); }
            public long getItemId(int i) { return shown.get(i).id; }
            public View getView(int i, View cv, ViewGroup parent) { return row(shown.get(i)); }
        };
        list.setAdapter(adapter);
        root.addView(list, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        return root;
    }

    @Override void onShow() { LogDb.addListener(refresh); load(); }
    @Override void onHide() { LogDb.removeListener(refresh); }

    private void load() {
        final String f = filter;
        new Thread(new Runnable() {
            public void run() {
                final List<LogDb.Entry> all = LogDb.get(a).all();
                final List<LogDb.Entry> out = new ArrayList<>();
                for (LogDb.Entry e : all) if (f == null || f.equals(e.status)) out.add(e);
                a.runOnUiThread(new Runnable() {
                    public void run() {
                        shown = out;
                        adapter.notifyDataSetChanged();
                        empty.setVisibility(out.isEmpty() ? View.VISIBLE : View.GONE);
                        list.setVisibility(out.isEmpty() ? View.GONE : View.VISIBLE);
                        String[] values = {null, LogDb.SUCCESS, LogDb.FAILED, LogDb.PENDING};
                        for (int i = 0; i < 4; i++) {
                            boolean on = (values[i] == null ? filter == null : values[i].equals(filter));
                            filters[i].setBackground(UI.box(a, on ? UI.PRIMARY : UI.CARD, 20, on ? 0 : UI.PRIMARY));
                            filters[i].setTextColor(on ? Color.WHITE : UI.PRIMARY);
                        }
                    }
                });
            }
        }).start();
    }

    private View row(final LogDb.Entry e) {
        LinearLayout c = UI.card(a);
        LinearLayout top = UI.row(c.getContext());
        TextView name = UI.heading(a, e.name);
        name.setSingleLine(true);
        top.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        String label = LogDb.SUCCESS.equals(e.status) ? "ناجح" : LogDb.FAILED.equals(e.status) ? "فاشل" : "قيد الانتظار";
        int color = LogDb.SUCCESS.equals(e.status) ? UI.OK : LogDb.FAILED.equals(e.status) ? UI.ERR : UI.WARN;
        top.addView(UI.text(a, label, 14, color, true));
        c.addView(top);
        UI.add(c, UI.small(a, UI.date(e.updatedAt) + " • " + UI.size(e.size) + (e.asDoc ? " • ملف" : "") + (e.auto ? " • تلقائي" : "")), 4);
        if (LogDb.FAILED.equals(e.status) && e.error != null && !e.error.isEmpty()) {
            UI.add(c, UI.text(a, e.error, 12, UI.ERR, false), 4);
        }
        LinearLayout acts = UI.add(c, UI.row(a), 6);
        if (!LogDb.SUCCESS.equals(e.status)) {
            acts.addView(UI.button(a, "إعادة المحاولة", false, new View.OnClickListener() {
                public void onClick(View v) { retry(e); }
            }));
        }
        View gap = new View(a);
        acts.addView(gap, new LinearLayout.LayoutParams(UI.dp(a, 8), 1));
        acts.addView(UI.button(a, "حذف من السجل", false, new View.OnClickListener() {
            public void onClick(View v) { LogDb.get(a).delete(e.id); }
        }));
        for (int i = 0; i < acts.getChildCount(); i++) acts.getChildAt(i).setFocusable(false);
        LinearLayout wrap = UI.col(a);
        wrap.addView(c);
        wrap.setPadding(0, 0, 0, UI.dp(a, 8));
        return wrap;
    }

    private void retry(LogDb.Entry e) {
        Item it = new Item();
        it.key = e.key;
        it.name = e.name;
        it.mime = e.mime != null ? e.mime : "image/jpeg";
        it.size = e.size;
        it.dateMs = e.updatedAt;
        if (e.key.startsWith("ms:")) {
            it.uri = android.content.ContentUris.withAppendedId(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Long.parseLong(e.key.substring(3)));
        } else {
            UI.toast(a, "ملفات المنتقي مؤقتة؛ اخترها من المعرض من جديد");
            return;
        }
        if (!SendQueue.start(a, Collections.singletonList(it), e.asDoc)) UI.toast(a, "هناك عملية إرسال جارية، انتظر انتهاءها");
    }
}
