package com.photosync.telegram.data

import android.net.Uri

/** صورة قابلة للإرسال. [key] مفتاح ثابت يُستخدم لمنع التكرار. */
data class PhotoItem(
    val key: String,
    val uri: Uri,
    val name: String,
    val sizeBytes: Long,
    val dateMillis: Long,
    val mime: String,
    val bucketId: String? = null,
    val bucketName: String? = null,
)

data class Bucket(val id: String, val name: String, val count: Int)

enum class SendStatus { PENDING, SUCCESS, FAILED }
