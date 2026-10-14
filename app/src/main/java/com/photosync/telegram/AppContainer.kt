package com.photosync.telegram

import android.app.Application
import android.content.Context
import androidx.room.Room
import com.photosync.telegram.data.AppDatabase
import com.photosync.telegram.data.MediaRepository
import com.photosync.telegram.data.SendLogRepository
import com.photosync.telegram.data.SettingsRepository
import com.photosync.telegram.telegram.PhotoUploader
import com.photosync.telegram.telegram.SendCoordinator
import com.photosync.telegram.telegram.TelegramApi
import com.photosync.telegram.work.AutoSendManager
import com.photosync.telegram.work.NotificationHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** حاوية تبعيات بسيطة (بدون مكتبة DI). لا يوجد أي تسجيل لشبكة OkHttp كي لا يظهر التوكن في السجلات. */
class AppContainer(context: Context) {
    private val app = context.applicationContext
    val settings = SettingsRepository(app)
    val db: AppDatabase = Room.databaseBuilder(app, AppDatabase::class.java, "photosync.db").build()
    val dao = db.sendLogDao()
    val logRepo = SendLogRepository(dao, settings)
    val media = MediaRepository(app)
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()
    val api = TelegramApi(http)
    val uploader = PhotoUploader(app, api, settings, dao)
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val coordinator = SendCoordinator(uploader, appScope)
    val autoSend = AutoSendManager(app, settings)
}

class PhotoSyncApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        NotificationHelper.createChannels(this)
    }
}
