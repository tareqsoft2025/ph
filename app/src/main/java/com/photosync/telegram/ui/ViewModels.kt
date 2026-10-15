package com.photosync.telegram.ui

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.photosync.telegram.AppContainer
import com.photosync.telegram.data.Bucket
import com.photosync.telegram.data.PhotoItem
import com.photosync.telegram.data.SendLogEntity
import com.photosync.telegram.data.Settings
import com.photosync.telegram.telegram.ApiResult
import com.photosync.telegram.telegram.ChatInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

inline fun <T : ViewModel> vmFactory(crossinline build: () -> T): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <V : ViewModel> create(modelClass: Class<V>): V = build() as V
}

data class UiMessage(val text: String, val ok: Boolean)

private val TOKEN_REGEX = Regex("""^\d{5,}:[A-Za-z0-9_-]{20,}$""")

// ───────────────────────────── الرئيسية ─────────────────────────────
class HomeViewModel(private val c: AppContainer) : ViewModel() {
    val settings: StateFlow<Settings> = c.settings.state
    val successCount = c.logRepo.observeSuccessCount().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)
    val failedCount = c.logRepo.observeFailedCount().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), 0)
    val progress = c.coordinator.progress
    fun cancelSend() = c.coordinator.cancel()
    fun dismissResult() = c.coordinator.dismissResult()
}

// ───────────────────────────── Telegram ─────────────────────────────
data class TelegramUi(
    val token: String = "",
    val chatId: String = "",
    val showToken: Boolean = false,
    val busy: Boolean = false,
    val message: UiMessage? = null,
    val chats: List<ChatInfo> = emptyList(),
)

class TelegramViewModel(private val c: AppContainer) : ViewModel() {
    private val _ui = MutableStateFlow(
        TelegramUi(token = c.settings.current.botToken, chatId = c.settings.current.chatId)
    )
    val ui: StateFlow<TelegramUi> = _ui.asStateFlow()
    val settings = c.settings.state

    fun onToken(v: String) = _ui.update { it.copy(token = v.trim(), message = null) }
    fun onChatId(v: String) = _ui.update { it.copy(chatId = v.trim(), message = null) }
    fun toggleShow() = _ui.update { it.copy(showToken = !it.showToken) }
    fun pickChat(chat: ChatInfo) = _ui.update { it.copy(chatId = chat.id.toString(), message = null) }

    private fun validate(needChat: Boolean = true): String? {
        val s = _ui.value
        return when {
            s.token.isBlank() -> "أدخل رمز البوت (Bot Token)"
            !TOKEN_REGEX.matches(s.token) -> "صيغة الرمز غير صحيحة، يجب أن تشبه 123456789:ABC..."
            needChat && s.chatId.isBlank() -> "أدخل Chat ID"
            else -> null
        }
    }

    fun save() {
        validate()?.let { err -> _ui.update { it.copy(message = UiMessage(err, false)) }; return }
        val s = _ui.value
        c.settings.update {
            val changed = it.botToken != s.token || it.chatId != s.chatId
            it.copy(botToken = s.token, chatId = s.chatId, verified = it.verified && !changed)
        }
        _ui.update { it.copy(message = UiMessage("تم حفظ البيانات مشفّرة على الجهاز. اضغط «اختبار الاتصال» للتأكد.", true)) }
    }

    fun test() {
        validate()?.let { err -> _ui.update { it.copy(message = UiMessage(err, false)) }; return }
        val s = _ui.value
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, message = null) }
            val msg = when (val bot = c.api.getMe(s.token)) {
                is ApiResult.Err -> UiMessage(bot.message, false)
                is ApiResult.Ok -> when (val chat = c.api.getChat(s.token, s.chatId)) {
                    is ApiResult.Err -> UiMessage(chat.message, false)
                    is ApiResult.Ok -> {
                        c.settings.update {
                            it.copy(botToken = s.token, chatId = s.chatId, botUsername = bot.value.username, verified = true)
                        }
                        UiMessage("تم الاتصال بالبوت @${bot.value.username} والمحادثة «${chat.value.title}» بنجاح", true)
                    }
                }
            }
            _ui.update { it.copy(busy = false, message = msg) }
        }
    }

    /** يرسل رسالة نصية قصيرة للتحقق من أن البوت يستطيع النشر فعليًا (مهم للقنوات). */
    fun sendTestMessage() {
        validate()?.let { err -> _ui.update { it.copy(message = UiMessage(err, false)) }; return }
        val s = _ui.value
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, message = null) }
            val msg = when (val r = c.api.sendMessage(s.token, s.chatId, "✅ تم ربط PhotoSync Telegram بنجاح")) {
                is ApiResult.Ok -> UiMessage("أُرسلت رسالة الاختبار، تحقق من المحادثة", true)
                is ApiResult.Err -> UiMessage(r.message, false)
            }
            _ui.update { it.copy(busy = false, message = msg) }
        }
    }

    /** يقرأ آخر المحادثات التي راسلت البوت ليساعدك على معرفة Chat ID. */
    fun detectChats() {
        validate(needChat = false)?.let { err -> _ui.update { it.copy(message = UiMessage(err, false)) }; return }
        val s = _ui.value
        viewModelScope.launch {
            _ui.update { it.copy(busy = true, message = null) }
            val next = when (val r = c.api.getRecentChats(s.token)) {
                is ApiResult.Err -> s.copy(busy = false, message = UiMessage(r.message, false))
                is ApiResult.Ok -> _ui.value.copy(
                    busy = false,
                    chats = r.value,
                    message = if (r.value.isEmpty())
                        UiMessage("لا توجد رسائل بعد. أرسل أي رسالة للبوت (أو انشر في المجموعة/القناة) ثم أعد المحاولة.", false)
                    else UiMessage("اختر المحادثة المطلوبة من القائمة", true),
                )
            }
            _ui.update { next.copy(token = it.token, chatId = it.chatId, showToken = it.showToken) }
        }
    }
}

// ───────────────────────────── المعرض ─────────────────────────────
data class GalleryUi(
    val hasAccess: Boolean = false,
    val loading: Boolean = false,
    val items: List<PhotoItem> = emptyList(),
    val picked: List<PhotoItem> = emptyList(),
    val buckets: List<Bucket> = emptyList(),
    val bucketId: String? = null,
    val selected: Set<String> = emptySet(),
) {
    val visible: List<PhotoItem> get() = (picked + items).distinctBy { it.key }
    val selectedItems: List<PhotoItem> get() = visible.filter { it.key in selected }
}

class GalleryViewModel(private val c: AppContainer) : ViewModel() {
    private val _ui = MutableStateFlow(GalleryUi(hasAccess = c.media.hasAccess()))
    val ui: StateFlow<GalleryUi> = _ui.asStateFlow()
    val sentKeys: StateFlow<Set<String>> = c.logRepo.observeSuccessKeys().map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptySet())
    val progress = c.coordinator.progress
    val settings = c.settings.state
    val permissions: Array<String> get() = c.media.requiredPermissions()

    init { refresh() }

    fun refresh() {
        val access = c.media.hasAccess()
        _ui.update { it.copy(hasAccess = access, loading = access) }
        if (!access) return
        viewModelScope.launch {
            val bucketId = _ui.value.bucketId
            val (items, buckets) = withContext(Dispatchers.IO) { c.media.queryImages(bucketId) to c.media.queryBuckets() }
            _ui.update { it.copy(loading = false, items = items, buckets = buckets) }
        }
    }

    fun selectBucket(id: String?) {
        _ui.update { it.copy(bucketId = id, selected = emptySet()) }
        refresh()
    }

    fun toggle(key: String) = _ui.update {
        it.copy(selected = if (key in it.selected) it.selected - key else it.selected + key)
    }

    fun selectAll() = _ui.update { it.copy(selected = it.visible.map { p -> p.key }.toSet()) }
    fun clearSelection() = _ui.update { it.copy(selected = emptySet()) }

    fun addPicked(uris: List<Uri>) {
        viewModelScope.launch {
            val items = withContext(Dispatchers.IO) { uris.map { c.media.describePicked(it) } }
            _ui.update { it.copy(picked = (it.picked + items).distinctBy { p -> p.key }, selected = it.selected + items.map { p -> p.key }) }
        }
    }

    fun duplicateCount(): Int = _ui.value.selectedItems.count { it.key in sentKeys.value }

    /** @param resendSent false = تخطّي الصور المرسلة سابقًا (الافتراضي الآمن). */
    fun send(asDocument: Boolean, resendSent: Boolean): Boolean {
        val items = _ui.value.selectedItems.filter { resendSent || it.key !in sentKeys.value }
        val started = c.coordinator.start(items, asDocument)
        if (started) clearSelection()
        return started
    }

    fun cancelSend() = c.coordinator.cancel()
    fun dismissResult() = c.coordinator.dismissResult()
}

// ───────────────────────────── الأتمتة ─────────────────────────────
class AutomationViewModel(private val c: AppContainer) : ViewModel() {
    val settings = c.settings.state
    private val _buckets = MutableStateFlow<List<Bucket>>(emptyList())
    val buckets = _buckets.asStateFlow()
    val permissions: Array<String> get() = c.media.requiredPermissions()
    val hasAccess get() = c.media.hasAccess()

    fun loadBuckets() {
        viewModelScope.launch { _buckets.value = withContext(Dispatchers.IO) { c.media.queryBuckets() } }
    }

    fun enable() = c.autoSend.enable()
    fun disable() = c.autoSend.disable()
    fun runNow() = c.autoSend.runNow()

    fun setBucket(b: Bucket?) {
        c.settings.update {
            it.copy(
                autoBucketId = b?.id, autoBucketName = b?.name,
                // تغيير النطاق يبدأ من الآن حتى لا تُرفع صور قديمة من ألبوم جديد
                autoBaselineSec = if (it.autoEnabled) System.currentTimeMillis() / 1000 else it.autoBaselineSec,
            )
        }
    }

    fun setWifiOnly(v: Boolean) { c.settings.update { it.copy(autoWifiOnly = v) }; c.autoSend.schedule() }
    fun setInterval(min: Int) { c.settings.update { it.copy(autoIntervalMin = min) }; c.autoSend.schedule() }
    fun setAsDocument(v: Boolean) = c.settings.update { it.copy(autoAsDocument = v) }

    fun clearProcessed() { viewModelScope.launch { c.logRepo.clear() } }
}

// ───────────────────────────── السجل ─────────────────────────────
class LogViewModel(private val c: AppContainer) : ViewModel() {
    val entries: StateFlow<List<SendLogEntity>> = c.logRepo.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val progress = c.coordinator.progress

    /** @return false إن كانت هناك عملية إرسال جارية. */
    fun retry(e: SendLogEntity): Boolean {
        val item = PhotoItem(e.photoKey, Uri.parse(e.uri), e.name, e.sizeBytes, e.updatedAt, e.mime)
        return c.coordinator.start(listOf(item), e.asDocument)
    }

    fun cancelSend() = c.coordinator.cancel()
    fun dismissResult() = c.coordinator.dismissResult()
    fun delete(e: SendLogEntity) { viewModelScope.launch { c.logRepo.delete(e.id) } }
    fun clear() { viewModelScope.launch { c.logRepo.clear() } }
}

// ───────────────────────────── الإعدادات ─────────────────────────────
class SettingsViewModel(private val c: AppContainer) : ViewModel() {
    val settings = c.settings.state
    fun setSendAsDocument(v: Boolean) = c.settings.update { it.copy(sendAsDocument = v) }
    fun stopAutomation() = c.autoSend.disable()
    fun deleteCredentials() { c.autoSend.disable(); c.settings.clearCredentials() }
    fun clearLog() { viewModelScope.launch { c.logRepo.clear() } }
}
