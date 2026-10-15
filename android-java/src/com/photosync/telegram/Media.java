package com.photosync.telegram;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Size;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** قراءة الصور عبر MediaStore ضمن ما سمح به المستخدم، ووصف ملفات منتقي الصور. */
final class Media {
    private Media() {}

    static String[] permissions() {
        if (Build.VERSION.SDK_INT >= 34) {
            return new String[]{Manifest.permission.READ_MEDIA_IMAGES, "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"};
        }
        if (Build.VERSION.SDK_INT >= 33) return new String[]{Manifest.permission.READ_MEDIA_IMAGES};
        return new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
    }

    private static boolean granted(Context c, String p) {
        return c.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    /** على Android 14+ يكفي وصول جزئي (صور مختارة). */
    static boolean hasAccess(Context c) {
        if (Build.VERSION.SDK_INT >= 34) {
            return granted(c, Manifest.permission.READ_MEDIA_IMAGES) || granted(c, "android.permission.READ_MEDIA_VISUAL_USER_SELECTED");
        }
        if (Build.VERSION.SDK_INT >= 33) return granted(c, Manifest.permission.READ_MEDIA_IMAGES);
        return granted(c, Manifest.permission.READ_EXTERNAL_STORAGE);
    }

    static List<Item> query(Context c, String bucketId, long sinceSec, int limit) {
        List<Item> out = new ArrayList<>();
        if (!hasAccess(c)) return out;
        String[] proj = {
                MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.BUCKET_ID, MediaStore.Images.Media.BUCKET_DISPLAY_NAME};
        List<String> clauses = new ArrayList<>();
        List<String> args = new ArrayList<>();
        if (bucketId != null) { clauses.add(MediaStore.Images.Media.BUCKET_ID + "=?"); args.add(bucketId); }
        if (sinceSec > 0) { clauses.add(MediaStore.Images.Media.DATE_ADDED + ">?"); args.add(String.valueOf(sinceSec)); }
        String sel = clauses.isEmpty() ? null : android.text.TextUtils.join(" AND ", clauses);
        try (Cursor cur = c.getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, proj, sel,
                args.isEmpty() ? null : args.toArray(new String[0]), MediaStore.Images.Media.DATE_ADDED + " DESC")) {
            if (cur == null) return out;
            while (cur.moveToNext() && out.size() < limit) {
                Item it = new Item();
                long id = cur.getLong(0);
                it.key = "ms:" + id;
                it.uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
                it.name = cur.getString(1) != null ? cur.getString(1) : "image_" + id + ".jpg";
                it.size = cur.getLong(2);
                long taken = cur.getLong(3);
                it.dateMs = taken > 0 ? taken : cur.getLong(4) * 1000;
                it.mime = cur.getString(5) != null ? cur.getString(5) : "image/jpeg";
                it.bucketId = cur.getString(6);
                it.bucketName = cur.getString(7);
                out.add(it);
            }
        } catch (SecurityException e) {
            return new ArrayList<>();
        }
        return out;
    }

    static List<Item.Bucket> buckets(Context c) {
        List<Item.Bucket> out = new ArrayList<>();
        if (!hasAccess(c)) return out;
        Map<String, Object[]> m = new LinkedHashMap<>();
        try (Cursor cur = c.getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.Images.Media.BUCKET_ID, MediaStore.Images.Media.BUCKET_DISPLAY_NAME}, null, null, null)) {
            if (cur == null) return out;
            while (cur.moveToNext()) {
                String id = cur.getString(0);
                if (id == null) continue;
                Object[] v = m.get(id);
                if (v == null) m.put(id, new Object[]{cur.getString(1) != null ? cur.getString(1) : "—", 1});
                else v[1] = (Integer) v[1] + 1;
            }
        } catch (SecurityException e) {
            return out;
        }
        for (Map.Entry<String, Object[]> e : m.entrySet()) {
            out.add(new Item.Bucket(e.getKey(), (String) e.getValue()[0], (Integer) e.getValue()[1]));
        }
        java.util.Collections.sort(out, new java.util.Comparator<Item.Bucket>() {
            public int compare(Item.Bucket a, Item.Bucket b) { return b.count - a.count; }
        });
        return out;
    }

    /** وصف صورة اختارها المستخدم من منتقي الصور الرسمي. */
    static Item describe(Context c, Uri uri) {
        Item it = new Item();
        it.uri = uri;
        it.name = uri.getLastPathSegment() != null ? uri.getLastPathSegment() : "image";
        try (Cursor cur = c.getContentResolver().query(uri, null, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                int n = cur.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int s = cur.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0 && cur.getString(n) != null) it.name = cur.getString(n);
                if (s >= 0) it.size = cur.getLong(s);
            }
        } catch (Exception ignored) { }
        String type = c.getContentResolver().getType(uri);
        it.mime = type != null ? type : "image/jpeg";
        it.key = "pk:" + it.name + ":" + it.size;
        it.dateMs = System.currentTimeMillis();
        return it;
    }

    static Bitmap thumb(Context c, Uri uri, int px) {
        try {
            return c.getContentResolver().loadThumbnail(uri, new Size(px, px), null);
        } catch (Exception e) {
            return null;
        }
    }
}
