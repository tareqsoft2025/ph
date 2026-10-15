package com.photosync.telegram;

import android.net.Uri;

/** صورة قابلة للإرسال. [key] ثابت لمنع التكرار. */
final class Item {
    String key, name, mime, bucketId, bucketName;
    Uri uri;
    long size, dateMs;

    static final class Bucket {
        final String id, name;
        final int count;
        Bucket(String id, String name, int count) { this.id = id; this.name = name; this.count = count; }
    }
}
