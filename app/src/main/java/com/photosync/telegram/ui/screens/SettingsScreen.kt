package com.photosync.telegram.ui.screens

import android.content.Intent
import android.net.Uri
import android.provider.Settings as AndroidSettings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.photosync.telegram.ui.SettingsViewModel
import com.photosync.telegram.ui.components.ConfirmDialog
import com.photosync.telegram.ui.components.InfoCard
import com.photosync.telegram.ui.components.LabeledRow
import com.photosync.telegram.ui.components.ScreenTitle

@Composable
fun SettingsScreen(vm: SettingsViewModel, onTelegram: () -> Unit) {
    val s by vm.settings.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    var dialog by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize()) {
        ScreenTitle("الإعدادات والخصوصية")
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            InfoCard {
                Text("الإرسال", style = MaterialTheme.typography.titleMedium)
                LabeledRow("إرسال كملف أصلي افتراضيًا") {
                    Switch(checked = s.sendAsDocument, onCheckedChange = vm::setSendAsDocument)
                }
                Text(
                    "الصور الأكبر من 10MB تُرسل تلقائيًا كملف، والحد الأقصى 50MB (قيود Telegram).",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedButton(onClick = onTelegram) { Text("بيانات Telegram") }
            }

            InfoCard {
                Text("الخصوصية", style = MaterialTheme.typography.titleMedium)
                Text(
                    "• لا يُرفع أي شيء قبل أن تختاره وتؤكد الإرسال، أو تفعّل الإرسال التلقائي صراحةً.\n" +
                        "• الصور تُرسل إلى محادثة Telegram التي حددتها فقط، ولا يوجد أي خادم آخر أو تحليلات.\n" +
                        "• الصور المرسلة تصبح متاحة لمن لديهم صلاحية الاطلاع على تلك المحادثة، وتبقى على خوادم Telegram وفق سياستها.\n" +
                        "• يُحفظ Bot Token مشفّرًا (Android Keystore) ولا يُسجَّل في أي سجل.\n" +
                        "• يطلب التطبيق إذن الصور فقط، ويمكنك استخدام منتقي الصور بدون إذن.\n" +
                        "• إن وزّعت التطبيق على آخرين فلا تضمّن توكنًا خاصًا بك فيه؛ استخدم خادمًا وسيطًا آمنًا أو يُدخل كل مستخدم بوته الخاص.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            InfoCard {
                Text("التحكم", style = MaterialTheme.typography.titleMedium)
                Button(onClick = vm::stopAutomation, enabled = s.autoEnabled) { Text("إيقاف الأتمتة فورًا") }
                OutlinedButton(onClick = { dialog = "log" }) { Text("مسح سجل الإرسال") }
                OutlinedButton(onClick = { dialog = "cred" }) { Text("حذف بيانات الاعتماد من الجهاز") }
                OutlinedButton(onClick = {
                    ctx.startActivity(
                        Intent(AndroidSettings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }) { Text("صلاحيات التطبيق في النظام") }
            }
            Text("الإصدار 1.0.0", style = MaterialTheme.typography.labelSmall)
        }
    }

    when (dialog) {
        "log" -> ConfirmDialog("مسح السجل؟", "سيُحذف سجل العمليات بالكامل.", "مسح", vm::clearLog) { dialog = null }
        "cred" -> ConfirmDialog(
            "حذف بيانات الاعتماد؟", "سيُحذف Bot Token وChat ID وتُوقف الأتمتة.", "حذف", vm::deleteCredentials,
        ) { dialog = null }
    }
}
