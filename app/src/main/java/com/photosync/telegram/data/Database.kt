package com.photosync.telegram.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "send_log", indices = [Index(value = ["photoKey"], unique = true)])
data class SendLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val photoKey: String,
    val uri: String,
    val name: String,
    val mime: String,
    val sizeBytes: Long,
    val status: SendStatus,
    val error: String? = null,
    val attempts: Int = 0,
    val asDocument: Boolean = false,
    val auto: Boolean = false,
    val updatedAt: Long,
)

class Converters {
    @TypeConverter fun toStatus(v: String): SendStatus = SendStatus.valueOf(v)
    @TypeConverter fun fromStatus(v: SendStatus): String = v.name
}

@Dao
interface SendLogDao {
    @Query("SELECT * FROM send_log ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<SendLogEntity>>

    @Query("SELECT COUNT(*) FROM send_log WHERE status = 'SUCCESS'")
    fun observeSuccessCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM send_log WHERE status = 'FAILED'")
    fun observeFailedCount(): Flow<Int>

    @Query("SELECT photoKey FROM send_log WHERE status = 'SUCCESS'")
    fun observeSuccessKeys(): Flow<List<String>>

    @Query("SELECT * FROM send_log WHERE photoKey = :key LIMIT 1")
    suspend fun find(key: String): SendLogEntity?

    /** مفاتيح لا يجب على الإرسال التلقائي إعادة إرسالها الآن. */
    @Query(
        "SELECT photoKey FROM send_log WHERE photoKey IN (:keys) AND (" +
            "status = 'SUCCESS' OR " +
            "(status = 'PENDING' AND updatedAt > :pendingCutoff) OR " +
            "(status = 'FAILED' AND attempts >= :maxAttempts))"
    )
    suspend fun blockedKeys(keys: List<String>, pendingCutoff: Long, maxAttempts: Int): List<String>

    @Upsert
    suspend fun upsert(entity: SendLogEntity): Long

    @Query("DELETE FROM send_log WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("DELETE FROM send_log")
    suspend fun clear()
}

@Database(entities = [SendLogEntity::class], version = 1, exportSchema = false)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun sendLogDao(): SendLogDao
}
