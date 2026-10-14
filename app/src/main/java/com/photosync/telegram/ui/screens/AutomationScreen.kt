package com.photosync.telegram.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.photosync.telegram.ui.AutomationViewModel
import com.photosync.telegram.ui.components.ConfirmDialog
import com.photosync.telegram.ui.components.InfoCard
import com.photosync.telegram.ui.components.LabeledRow
import com.photosync.telegram.ui.components.ScreenTitle
import com.photosync.telegram.ui.components.formatDate
import kotlinx.coroutines.launch

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
fun AutomationScreen(vm: AutomationViewModel, snackbar: SnackbarHostState) {
    val s by vm.settings.collectAsStateWithLifecycle()
    val buckets by vm.buckets.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var albumMenu by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.loadBuckets() }

    fun toast(msg: String) = scope.launch { snackbar.showSnackbar(msg) }

    // بعد منح الإذن نُكمل التفعيل إن كان المستخدم قد طلبه.
    val mediaLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (vm.hasAccess) { vm.enable(); vm.loadBuckets() } else toast("لا يمكن تفعيل الإرسال التلقائي بدون إذن الصور")
    }
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    fun requestEnable() {
        when {
            !s.isConfigured -> toast("أعدّ اتصال Telegram أولًا")
            !vm.hasAccess -> mediaLauncher.launch(vm.permissions)
            else -> {
                if (Build.VERSION.SDK_INT >= 33) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                vm.enable()
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenTitle("الإرسال التلقائي")
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            InfoCard(container = MaterialTheme.colorScheme.primaryContainer) {
                LabeledRow("تفعيل الإرسال التلقائي") {
                    Switch(checked = s.autoEnabled, onCheckedChange = { if (it) requestEnable() else vm.disable() })
                }
                Text(
                    "عند التفعيل تُرسل الصور الجديدة فقط (المضافة بعد التفعيل). الصور الموجودة حاليًا لا تُرفع.",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (s.autoEnabled) {
                    Text(
                        "آخر فحص: " + (if (s.lastAutoRunMillis > 0) formatDate(s.lastAutoRunMillis) + " — " + s.lastAutoSummary else "لم يحدث بعد"),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { vm.runNow(); toast("طُلب فحص الآن، سينفَّذ عند توفر الشروط") }) { Text("فحص الآن") }
                        Button(onClick = vm::disable) { Text("إيقاف فورًا") }
                    }
                }
            }

            InfoCard {
                Text("النطاق", style = MaterialTheme.typography.titleMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { vm.loadBuckets(); albumMenu = true }) {
                        Text(s.autoBucketName ?: "كل الألبومات")
                    }
                    DropdownMenu(expanded = albumMenu, onDismissRequest = { albumMenu = false }) {
                        DropdownMenuItem(text = { Text("كل الألبومات") }, onClick = { vm.setBucket(null); albumMenu = false })
                        buckets.forEach { b ->
                            DropdownMenuItem(text = { Text("${b.name} (${b.count})") }, onClick = { vm.setBucket(b); albumMenu = false })
                        }
                    }
                }
                LabeledRow("إرسال كملف أصلي (بدون ضغط)") { Switch(checked = s.autoAsDocument, onCheckedChange = vm::setAsDocument) }
            }

            InfoCard {
                Text("الشروط والتوقيت", style = MaterialTheme.typography.titleMedium)
                LabeledRow("عبر Wi-Fi فقط") { Switch(checked = s.autoWifiOnly, onCheckedChange = vm::setWifiOnly) }
                Text("فترة الفحص")
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(15 to "15 د", 30 to "30 د", 60 to "ساعة", 180 to "3 ساعات", 360 to "6 ساعات").forEach { (min, label) ->
                        FilterChip(selected = s.autoIntervalMin == min, onClick = { vm.setInterval(min) }, label = { Text(label) })
                    }
                }
            }

            InfoCard(container = MaterialTheme.colorScheme.secondaryContainer) {
                Text("تنبيه مهم", style = MaterialTheme.typography.titleSmall)
                Text(
                    "الإرسال التلقائي يعتمد على WorkManager: الحد الأدنى للفترة 15 دقيقة، وتوقيت التنفيذ تقريبي " +
                        "وليس فوريًا ولا مضمونًا. قد يؤخره أو يمنعه توفير الطاقة (Doze) أو وضع توفير البطارية " +
                        "أو «تقييد الخلفية» أو إيقاف التطبيق قسريًا من الإعدادات. للحصول على أفضل نتيجة استثنِ " +
                        "التطبيق من تحسين البطارية. الصور الفاشلة تُعاد محاولتها حتى 5 مرات.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            OutlinedButton(onClick = { confirmClear = true }) { Text("مسح سجل الصور المعالجة") }
        }
    }

    if (confirmClear) {
        ConfirmDialog(
            title = "مسح السجل؟",
            text = "سيُمسح سجل الإرسال بالكامل. لن تُرسل الصور القديمة تلقائيًا مجددًا (تبدأ المتابعة من الآن).",
            confirmLabel = "مسح",
            onConfirm = vm::clearProcessed,
            onDismiss = { confirmClear = false },
        )
    }
}
