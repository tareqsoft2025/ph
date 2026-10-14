package com.photosync.telegram.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class Settings(
    val botToken: String = "",
    val chatId: String = "",
    val botUsername: String = "",
    val verified: Boolean = false,
    val sendAsDocument: Boolean = false,
    val autoEnabled: Boolean = false,
    val autoWifiOnly: Boolean = true,
    val autoIntervalMin: Int = 60,
    val autoBucketId: String? = null,
    val autoBucketName: String? = null,
    val autoAsDocument: Boolean = false,
    /** الصور الأحدث من هذا الوقت (ثوانٍ) فقط تُرسل تلقائيًا؛ الصور القديمة لا تُرفع أبدًا. */
    val autoBaselineSec: Long = 0,
    val lastAutoRunMillis: Long = 0,
    val lastAutoSummary: String = "",
) {
    val isConfigured: Boolean get() = botToken.isNotBlank() && chatId.isNotBlank()
}

/**
 * يحفظ الإعدادات في EncryptedSharedPreferences (مفتاح AES داخل Android Keystore)
 * فلا يُحفظ Bot Token كنص صريح على القرص.
 */
class SettingsRepository(context: Context) {
    private val prefs: SharedPreferences = createPrefs(context.applicationContext)
    private val _state = MutableStateFlow(load())
    val state: StateFlow<Settings> = _state.asStateFlow()
    val current: Settings get() = _state.value

    @Synchronized
    fun update(transform: (Settings) -> Settings) {
        val next = transform(load())
        prefs.edit()
            .putString("token", next.botToken)
            .putString("chat", next.chatId)
            .putString("botUser", next.botUsername)
            .putBoolean("verified", next.verified)
            .putBoolean("sendDoc", next.sendAsDocument)
            .putBoolean("autoOn", next.autoEnabled)
            .putBoolean("autoWifi", next.autoWifiOnly)
            .putInt("autoInterval", next.autoIntervalMin)
            .putString("autoBucketId", next.autoBucketId)
            .putString("autoBucketName", next.autoBucketName)
            .putBoolean("autoDoc", next.autoAsDocument)
            .putLong("baseline", next.autoBaselineSec)
            .putLong("lastRun", next.lastAutoRunMillis)
            .putString("lastSummary", next.lastAutoSummary)
            .apply()
        _state.value = next
    }

    fun clearCredentials() = update { it.copy(botToken = "", chatId = "", botUsername = "", verified = false) }

    private fun load() = Settings(
        botToken = prefs.getString("token", "") ?: "",
        chatId = prefs.getString("chat", "") ?: "",
        botUsername = prefs.getString("botUser", "") ?: "",
        verified = prefs.getBoolean("verified", false),
        sendAsDocument = prefs.getBoolean("sendDoc", false),
        autoEnabled = prefs.getBoolean("autoOn", false),
        autoWifiOnly = prefs.getBoolean("autoWifi", true),
        autoIntervalMin = prefs.getInt("autoInterval", 60),
        autoBucketId = prefs.getString("autoBucketId", null),
        autoBucketName = prefs.getString("autoBucketName", null),
        autoAsDocument = prefs.getBoolean("autoDoc", false),
        autoBaselineSec = prefs.getLong("baseline", 0),
        lastAutoRunMillis = prefs.getLong("lastRun", 0),
        lastAutoSummary = prefs.getString("lastSummary", "") ?: "",
    )

    private companion object {
        const val FILE = "photosync_secure_prefs"

        fun createPrefs(context: Context): SharedPreferences {
            fun open(): SharedPreferences {
                val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
                return EncryptedSharedPreferences.create(
                    context, FILE, key,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            }
            return try {
                open()
            } catch (e: Exception) {
                // تلف مخزن المفاتيح (مثلاً بعد استعادة جهاز): نبدأ من جديد بدل الانهيار.
                context.deleteSharedPreferences(FILE)
                open()
            }
        }
    }
}
