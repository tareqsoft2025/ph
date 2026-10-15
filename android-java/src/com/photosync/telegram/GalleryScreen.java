package com.photosync.telegram;

import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ClipData;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.LruCache;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class GalleryScreen extends Screen {
    private LinearLayout root;
    private FrameLayout body;
    private GridView grid;
    private TextView emptyMsg;
    private Button grant;
    private LinearLayout bottom;
    private TextView selCount;

    private List<Item> items = new ArrayList<>();
    private final List<Item> picked = new ArrayList<>();
    private final Map<String, Item> selected = new LinkedHashMap<>();
    private Set<String> sent = new java.util.HashSet<>();
    private String bucketId, bucketName = "كل الصور";
    private boolean loading;

    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final LruCache<String, Bitmap> cache = new LruCache<String, Bitmap>((int) (Runtime.getRuntime().maxMemory() / 8)) {
        @Override protected int sizeOf(String k, Bitmap b) { return b.getByteCount(); }
    };
    private BaseAdapter adapter;
    private final Runnable sentRefresh = new Runnable() { public void run() { loadSent(); } };

    GalleryScreen(MainActivity a) { super(a); }

    private List<Item> vis = new ArrayList<>();

    private List<Item> visible() { return vis; }

    private List<Item> buildVisible() {
        List<Item> all = new ArrayList<>(picked);
        for (Item it : items) {
            boolean dup = false;
            for (Item p : picked) if (p.key.equals(it.key)) { dup = true; break; }
            if (!dup) all.add(it);
        }
        return all;
    }

    @Override View view() {
        if (root != null) return root;
        root = UI.col(a);
        int p = UI.dp(a, 12);
        LinearLayout head = UI.row(a);
        head.setPadding(p, p, p, 0);
        head.addView(UI.title(a, "المعرض"));
        root.addView(head);

        LinearLayout bar = UI.row(a);
        bar.setPadding(p, UI.dp(a, 8), p, UI.dp(a, 8));
        addBarButton(bar, "منتقي الصور", new View.OnClickListener() { public void onClick(View v) { pick(); } });
        addBarButton(bar, "الألبوم", new View.OnClickListener() { public void onClick(View v) { pickAlbum(); } });
        addBarButton(bar, "تحديد الكل", new View.OnClickListener() {
            public void onClick(View v) { for (Item it : visible()) selected.put(it.key, it); update(); }
        });
        addBarButton(bar, "إلغاء", new View.OnClickListener() { public void onClick(View v) { selected.clear(); update(); } });
        root.addView(bar);

        body = new FrameLayout(a);
        grid = new GridView(a);
        grid.setNumColumns(3);
        grid.setHorizontalSpacing(UI.dp(a, 6));
        grid.setVerticalSpacing(UI.dp(a, 6));
        grid.setPadding(p, 0, p, p);
        grid.setClipToPadding(false);
        adapter = new BaseAdapter() {
            public int getCount() { return visible().size(); }
            public Object getItem(int i) { return visible().get(i); }
            public long getItemId(int i) { return i; }
            public View getView(int i, View cv, ViewGroup parent) { return cell(visible().get(i), cv); }
        };
        grid.setAdapter(adapter);
        body.addView(grid, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout empty = UI.col(a);
        empty.setGravity(Gravity.CENTER);
        empty.setPadding(UI.dp(a, 24), 0, UI.dp(a, 24), 0);
        emptyMsg = UI.body(a, "");
        emptyMsg.setGravity(Gravity.CENTER);
        empty.addView(emptyMsg);
        grant = UI.add(empty, UI.button(a, "منح إذن الصور", true, new View.OnClickListener() {
            public void onClick(View v) { a.request(Media.permissions(), MainActivity.REQ_MEDIA); }
        }), 12);
        empty.setTag("empty");
        body.addView(empty, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(body, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        bottom = UI.row(a);
        bottom.setBackgroundColor(UI.CARD);
        bottom.setPadding(p, p, p, p);
        selCount = UI.body(a, "");
        bottom.addView(selCount, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        bottom.addView(UI.button(a, "معاينة", false, new View.OnClickListener() { public void onClick(View v) { preview(); } }));
        View gap = new View(a);
        bottom.addView(gap, new LinearLayout.LayoutParams(UI.dp(a, 8), 1));
        bottom.addView(UI.button(a, "إرسال", true, new View.OnClickListener() { public void onClick(View v) { send(); } }));
        root.addView(bottom);
        update();
        return root;
    }

    private void addBarButton(LinearLayout bar, String label, View.OnClickListener l) {
        Button b = UI.button(a, label, false, l);
        b.setPadding(UI.dp(a, 4), 0, UI.dp(a, 4), 0);
        b.setTextSize(12);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        lp.setMarginEnd(UI.dp(a, 4));
        bar.addView(b, lp);
    }

    @Override void onShow() {
        LogDb.addListener(sentRefresh);
        loadSent();
        reload();
    }

    @Override void onHide() { LogDb.removeListener(sentRefresh); }

    @Override void onPermissions(int req) { if (req == MainActivity.REQ_MEDIA) reload(); }

    private void loadSent() {
        pool.execute(new Runnable() {
            public void run() {
                final Set<String> k = LogDb.get(a).successKeys();
                a.runOnUiThread(new Runnable() { public void run() { sent = k; if (adapter != null) adapter.notifyDataSetChanged(); } });
            }
        });
    }

    private void reload() {
        if (loading) return;
        if (!Media.hasAccess(a)) { items = new ArrayList<>(); update(); return; }
        loading = true;
        final String bid = bucketId;
        new Thread(new Runnable() {
            public void run() {
                final List<Item> list = Media.query(a, bid, 0, 3000);
                a.runOnUiThread(new Runnable() {
                    public void run() { items = list; loading = false; update(); }
                });
            }
        }).start();
    }

    private void update() {
        if (root == null) return;
        vis = buildVisible();
        List<Item> all = vis;
        adapter.notifyDataSetChanged();
        View empty = body.findViewWithTag("empty");
        boolean noAccess = !Media.hasAccess(a);
        empty.setVisibility(all.isEmpty() ? View.VISIBLE : View.GONE);
        grid.setVisibility(all.isEmpty() ? View.GONE : View.VISIBLE);
        grant.setVisibility(noAccess ? View.VISIBLE : View.GONE);
        emptyMsg.setText(noAccess
                ? "للاطلاع على الصور داخل التطبيق امنح إذن الصور (يمكن منح وصول جزئي)، أو استخدم «منتقي الصور» الرسمي بدون أي إذن."
                : (loading ? "جارٍ التحميل…" : "لا توجد صور لعرضها"));
        bottom.setVisibility(selected.isEmpty() ? View.GONE : View.VISIBLE);
        selCount.setText(selected.size() + " محددة");
    }

    private View cell(final Item it, View cv) {
        LinearLayout c;
        SquareFrame frame;
        ImageView img;
        TextView check, badge, date, size;
        if (cv == null) {
            c = UI.col(a);
            frame = new SquareFrame(a);
            img = new ImageView(a);
            img.setScaleType(ImageView.ScaleType.CENTER_CROP);
            img.setBackgroundColor(UI.STROKE);
            frame.addView(img, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            check = UI.text(a, "✔", 18, Color.WHITE, true);
            check.setBackgroundColor(0x6600796B);
            check.setGravity(Gravity.TOP | Gravity.START);
            check.setPadding(UI.dp(a, 6), UI.dp(a, 4), 0, 0);
            frame.addView(check, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            badge = UI.text(a, "أُرسلت", 10, Color.WHITE, false);
            badge.setBackground(UI.box(a, 0xCC2E7D32, 6, 0));
            badge.setPadding(UI.dp(a, 6), UI.dp(a, 2), UI.dp(a, 6), UI.dp(a, 2));
            FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.END);
            bp.setMargins(UI.dp(a, 4), UI.dp(a, 4), UI.dp(a, 4), UI.dp(a, 4));
            frame.addView(badge, bp);
            c.addView(frame, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            date = UI.small(a, "");
            date.setSingleLine(true);
            size = UI.small(a, "");
            c.addView(date);
            c.addView(size);
            c.setTag(new View[]{img, check, badge, date, size});
        } else {
            c = (LinearLayout) cv;
        }
        View[] v = (View[]) c.getTag();
        img = (ImageView) v[0];
        check = (TextView) v[1];
        badge = (TextView) v[2];
        date = (TextView) v[3];
        size = (TextView) v[4];
        check.setVisibility(selected.containsKey(it.key) ? View.VISIBLE : View.GONE);
        badge.setVisibility(sent.contains(it.key) ? View.VISIBLE : View.GONE);
        date.setText(UI.date(it.dateMs));
        size.setText(UI.size(it.size));
        c.setOnClickListener(new View.OnClickListener() {
            public void onClick(View x) {
                if (selected.containsKey(it.key)) selected.remove(it.key); else selected.put(it.key, it);
                update();
            }
        });
        bindThumb(img, it);
        return c;
    }

    private void bindThumb(final ImageView img, final Item it) {
        img.setTag(it.key);
        Bitmap cached = cache.get(it.key);
        if (cached != null) { img.setImageBitmap(cached); return; }
        img.setImageDrawable(null);
        pool.execute(new Runnable() {
            public void run() {
                final Bitmap b = Media.thumb(a, it.uri, 300);
                if (b == null) return;
                cache.put(it.key, b);
                a.runOnUiThread(new Runnable() {
                    public void run() { if (it.key.equals(img.getTag())) img.setImageBitmap(b); }
                });
            }
        });
    }

    // ── منتقي الصور الرسمي (بدون أي إذن) ───────────────────────────────────
    private void pick() {
        Intent i;
        if (Build.VERSION.SDK_INT >= 33) {
            i = new Intent(MediaStore.ACTION_PICK_IMAGES);
            i.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit());
        } else {
            i = new Intent(Intent.ACTION_GET_CONTENT);
            i.setType("image/*");
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try {
            a.startActivityForResult(i, MainActivity.REQ_PICK);
        } catch (Exception e) {
            UI.toast(a, "لا يوجد تطبيق لاختيار الصور");
        }
    }

    @Override void onResult(int req, int res, Intent data) {
        if (req != MainActivity.REQ_PICK || res != android.app.Activity.RESULT_OK || data == null) return;
        final List<Uri> uris = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        new Thread(new Runnable() {
            public void run() {
                final List<Item> described = new ArrayList<>();
                for (Uri u : uris) described.add(Media.describe(a, u));
                a.runOnUiThread(new Runnable() {
                    public void run() {
                        for (Item it : described) {
                            boolean have = false;
                            for (Item p : picked) if (p.key.equals(it.key)) have = true;
                            if (!have) picked.add(it);
                            selected.put(it.key, it);
                        }
                        update();
                    }
                });
            }
        }).start();
    }

    private void pickAlbum() {
        if (!Media.hasAccess(a)) { UI.toast(a, "امنح إذن الصور أولًا"); return; }
        final List<Item.Bucket> buckets = Media.buckets(a);
        String[] names = new String[buckets.size() + 1];
        names[0] = "كل الصور";
        for (int i = 0; i < buckets.size(); i++) names[i + 1] = buckets.get(i).name + " (" + buckets.get(i).count + ")";
        new AlertDialog.Builder(a).setTitle("اختر الألبوم").setItems(names, new DialogInterface.OnClickListener() {
            public void onClick(DialogInterface d, int which) {
                bucketId = which == 0 ? null : buckets.get(which - 1).id;
                bucketName = which == 0 ? "كل الصور" : buckets.get(which - 1).name;
                selected.clear();
                reload();
            }
        }).show();
    }

    // ── المعاينة ────────────────────────────────────────────────────────────
    private void preview() {
        final List<Item> sel = new ArrayList<>(selected.values());
        if (sel.isEmpty()) return;
        final Dialog d = new Dialog(a, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        FrameLayout f = new FrameLayout(a);
        f.setBackgroundColor(Color.BLACK);
        final ImageView img = new ImageView(a);
        img.setScaleType(ImageView.ScaleType.FIT_CENTER);
        f.addView(img, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        final TextView info = UI.text(a, "", 14, Color.WHITE, false);
        info.setBackgroundColor(0x99000000);
        info.setPadding(UI.dp(a, 12), UI.dp(a, 12), UI.dp(a, 12), UI.dp(a, 12));
        f.addView(info, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        final int[] idx = {0};
        final Runnable show = new Runnable() {
            public void run() {
                final Item it = sel.get(idx[0]);
                info.setText((idx[0] + 1) + " / " + sel.size() + "  •  " + it.name + "  •  " + UI.size(it.size));
                img.setImageDrawable(null);
                pool.execute(new Runnable() {
                    public void run() {
                        final Bitmap b = Media.thumb(a, it.uri, 1600);
                        a.runOnUiThread(new Runnable() { public void run() { if (sel.get(idx[0]) == it) img.setImageBitmap(b); } });
                    }
                });
            }
        };
        LinearLayout nav = UI.row(a);
        nav.setBackgroundColor(0x99000000);
        nav.setGravity(Gravity.CENTER);
        nav.addView(UI.button(a, "السابق", false, new View.OnClickListener() {
            public void onClick(View v) { idx[0] = (idx[0] - 1 + sel.size()) % sel.size(); show.run(); }
        }));
        View g1 = new View(a);
        nav.addView(g1, new LinearLayout.LayoutParams(UI.dp(a, 8), 1));
        nav.addView(UI.button(a, "إغلاق", true, new View.OnClickListener() { public void onClick(View v) { d.dismiss(); } }));
        View g2 = new View(a);
        nav.addView(g2, new LinearLayout.LayoutParams(UI.dp(a, 8), 1));
        nav.addView(UI.button(a, "التالي", false, new View.OnClickListener() {
            public void onClick(View v) { idx[0] = (idx[0] + 1) % sel.size(); show.run(); }
        }));
        nav.setPadding(0, UI.dp(a, 10), 0, UI.dp(a, 10));
        f.addView(nav, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
        d.setContentView(f);
        d.show();
        show.run();
    }

    // ── الإرسال ─────────────────────────────────────────────────────────────
    private void send() {
        final Store s = Store.get(a);
        if (!s.configured()) {
            UI.toast(a, "أعدّ اتصال Telegram أولًا");
            a.openDetail(new TelegramScreen(a));
            return;
        }
        int dup = 0;
        for (String k : selected.keySet()) if (sent.contains(k)) dup++;
        LinearLayout box = UI.col(a);
        int p = UI.dp(a, 20);
        box.setPadding(p, p, p, 0);
        box.addView(UI.body(a, "ستُرسل الصور المحددة فقط إلى محادثة Telegram المضبوطة، وستصبح متاحة لكل من يطّلع على تلك المحادثة."));
        final CheckBox asDoc = new CheckBox(a);
        asDoc.setText("إرسال كملف أصلي (بدون ضغط)");
        asDoc.setChecked(s.sendAsDoc());
        UI.add(box, asDoc, 10);
        final CheckBox skip = new CheckBox(a);
        skip.setText("تخطّي " + dup + " صورة أُرسلت سابقًا");
        skip.setChecked(true);
        if (dup > 0) UI.add(box, skip, 4);
        new AlertDialog.Builder(a).setTitle("إرسال " + selected.size() + " صورة؟").setView(box)
                .setPositiveButton("إرسال", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface dlg, int w) {
                        List<Item> list = new ArrayList<>();
                        for (Item it : selected.values()) if (!skip.isChecked() || !sent.contains(it.key)) list.add(it);
                        if (SendQueue.start(a, list, asDoc.isChecked())) { selected.clear(); update(); }
                        else UI.toast(a, "لا توجد صور للإرسال أو هناك عملية إرسال جارية");
                    }
                }).setNegativeButton("إلغاء", null).show();
    }
}
