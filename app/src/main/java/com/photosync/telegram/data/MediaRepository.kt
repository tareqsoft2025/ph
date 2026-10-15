package com.photosync.telegram.data

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.provider.OpenableColumns
import androidx.core.content.ContextCompat

/** قراءة الصور عبر MediaStore (ضمن ما سمح به المستخدم) ووصف ملفات منتقي الصور. */
class MediaRepository(private val context: Context) {

    fun requiredPermissions(): Array<String> = when {
        Build.VERSION.SDK_INT >= 34 -> arrayOf(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
        )
        Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES)
        else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

    /** على Android 14+ قد يمنح المستخدم وصولًا جزئيًا فقط (صور مختارة)، وهذا يكفي للقراءة. */
    fun hasAccess(): Boolean {
        fun granted(p: String) =
            ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
        return when {
            Build.VERSION.SDK_INT >= 34 ->
                granted(Manifest.permission.READ_MEDIA_IMAGES) ||
                    granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            Build.VERSION.SDK_INT >= 33 -> granted(Manifest.permission.READ_MEDIA_IMAGES)
            else -> granted(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    fun queryImages(bucketId: String? = null, sinceSec: Long? = null, limit: Int = 3000): List<PhotoItem> {
        if (!hasAccess()) return emptyList()
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.MIME_TYPE,
            MediaStore.Images.Media.BUCKET_ID,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
        )
        val clauses = mutableListOf<String>()
        val args = mutableListOf<String>()
        if (bucketId != null) {
            clauses += "${MediaStore.Images.Media.BUCKET_ID} = ?"; args += bucketId
        }
        if (sinceSec != null) {
            clauses += "${MediaStore.Images.Media.DATE_ADDED} > ?"; args += sinceSec.toString()
        }
        val result = ArrayList<PhotoItem>()
        try {
            context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                clauses.takeIf { it.isNotEmpty() }?.joinToString(" AND "),
                args.takeIf { it.isNotEmpty() }?.toTypedArray(),
                "${MediaStore.Images.Media.DATE_ADDED} DESC",
            )?.use { c ->
                val iId = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val iName = c.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val iSize = c.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
                val iTaken = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
                val iAdded = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
                val iMime = c.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE)
                val iBucket = c.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_ID)
                val iBucketName = c.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
                while (c.moveToNext() && result.size < limit) {
                    val id = c.getLong(iId)
                    val taken = c.getLong(iTaken)
                    result += PhotoItem(
                        key = "ms:$id",
                        uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id),
                        name = c.getString(iName) ?: "image_$id.jpg",
                        sizeBytes = c.getLong(iSize),
                        dateMillis = if (taken > 0) taken else c.getLong(iAdded) * 1000,
                        mime = c.getString(iMime) ?: "image/jpeg",
                        bucketId = c.getString(iBucket),
                        bucketName = c.getString(iBucketName),
                    )
                }
            }
        } catch (e: SecurityException) {
            return emptyList()
        }
        return result
    }

    fun queryBuckets(): List<Bucket> {
        if (!hasAccess()) return emptyList()
        val counts = LinkedHashMap<String, Pair<String, Int>>()
        try {
            context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                arrayOf(MediaStore.Images.Media.BUCKET_ID, MediaStore.Images.Media.BUCKET_DISPLAY_NAME),
                null, null, null,
            )?.use { c ->
                val iId = c.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_ID)
                val iName = c.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)
                while (c.moveToNext()) {
                    val id = c.getString(iId) ?: continue
                    val prev = counts[id]
                    counts[id] = (prev?.first ?: (c.getString(iName) ?: "—")) to ((prev?.second ?: 0) + 1)
                }
            }
        } catch (e: SecurityException) {
            return emptyList()
        }
        return counts.map { (id, v) -> Bucket(id, v.first, v.second) }.sortedByDescending { it.count }
    }

    /** وصف صورة اختارها المستخدم من منتقي الصور الرسمي. */
    fun describePicked(uri: Uri): PhotoItem {
        var name = uri.lastPathSegment ?: "image"
        var size = 0L
        context.contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) ?: name }
                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { size = c.getLong(it) }
            }
        }
        return PhotoItem(
            key = "pk:$name:$size",
            uri = uri,
            name = name,
            sizeBytes = size,
            dateMillis = System.currentTimeMillis(),
            mime = context.contentResolver.getType(uri) ?: "image/jpeg",
        )
    }
}
