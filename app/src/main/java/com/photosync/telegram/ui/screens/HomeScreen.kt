package com.photosync.telegram.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.photosync.telegram.ui.HomeViewModel
import com.photosync.telegram.ui.components.InfoCard
import com.photosync.telegram.ui.components.ScreenTitle
import com.photosync.telegram.ui.components.SendProgressDialog
import com.photosync.telegram.ui.components.formatDate
import com.photosync.telegram.ui.theme.SuccessColor
import com.photosync.telegram.ui.theme.WarningColor

@Composable
fun HomeScreen(vm: HomeViewModel, onTelegram: () -> Unit, onGallery: () -> Unit, onAutomation: () -> Unit) {
    val s by vm.settings.collectAsStateWithLifecycle()
    val ok by vm.successCount.collectAsStateWithLifecycle()
    val failed by vm.failedCount.collectAsStateWithLifecycle()
    val progress by vm.progress.collectAsStateWithLifecycle()

    SendProgressDialog(progress, onCancel = vm::cancelSend, onDismiss = vm::dismissResult)

    Column(Modifier.fillMaxSize()) {
        ScreenTitle("PhotoSync Telegram")
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            InfoCard {
                val connected = s.isConfigured && s.verified
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(
                        if (connected) Icons.Default.CheckCircle else Icons.Default.ErrorOutline,
                        contentDescription = null,
                        tint = if (connected) SuccessColor else WarningColor,
                    )
                    Text("حالة الاتصال", style = MaterialTheme.typography.titleMedium)
                }
                Text(
                    when {
                        !s.isConfigured -> "لم يتم إعداد البوت بعد"
                        !s.verified -> "البيانات محفوظة لكن لم تُختبر بعد"
                        else -> "متصل بالبوت @${s.botUsername}"
                    }
                )
                OutlinedButton(onClick = onTelegram) { Text(if (s.isConfigured) "إدارة الاتصال" else "إعداد Telegram") }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                InfoCard(Modifier.weight(1f)) {
                    Text("$ok", style = MaterialTheme.typography.headlineMedium, color = SuccessColor)
                    Text("صورة مرسلة")
                }
                InfoCard(Modifier.weight(1f)) {
                    Text("$failed", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.error)
                    Text("إرسال فاشل")
                }
            }

            InfoCard {
                Text("الإرسال التلقائي", style = MaterialTheme.typography.titleMedium)
                Text(if (s.autoEnabled) "مفعّل — آخر فحص: " + (if (s.lastAutoRunMillis > 0) formatDate(s.lastAutoRunMillis) else "لم يحدث بعد") else "متوقف")
                OutlinedButton(onClick = onAutomation) { Text("إعدادات الأتمتة") }
            }

            Button(onClick = onGallery, modifier = Modifier.padding(top = 4.dp)) { Text("اختيار صور وإرسالها") }
        }
    }
}
