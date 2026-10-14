package com.photosync.telegram.data

import kotlinx.coroutines.flow.Flow

class SendLogRepository(private val dao: SendLogDao, private val settings: SettingsRepository) {
    fun observeAll(): Flow<List<SendLogEntity>> = dao.observeAll()
    fun observeSuccessCount(): Flow<Int> = dao.observeSuccessCount()
    fun observeFailedCount(): Flow<Int> = dao.observeFailedCount()
    fun observeSuccessKeys(): Flow<List<String>> = dao.observeSuccessKeys()

    suspend fun delete(id: Long) = dao.delete(id)

    /**
     * يمسح السجل. إن كان الإرسال التلقائي مفعّلًا نُعيد ضبط نقطة البداية إلى الآن
     * حتى لا تُرسل الصور القديمة مجددًا بعد مسح معرّفاتها.
     */
    suspend fun clear() {
        dao.clear()
        if (settings.current.autoEnabled) {
            settings.update { it.copy(autoBaselineSec = System.currentTimeMillis() / 1000) }
        }
    }
}
