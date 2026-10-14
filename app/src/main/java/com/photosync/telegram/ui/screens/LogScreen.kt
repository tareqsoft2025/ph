package com.photosync.telegram.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.photosync.telegram.data.SendLogEntity
import com.photosync.telegram.data.SendStatus
import com.photosync.telegram.ui.LogViewModel
import com.photosync.telegram.ui.components.ConfirmDialog
import com.photosync.telegram.ui.components.InfoCard
import com.photosync.telegram.ui.components.ScreenTitle
import com.photosync.telegram.ui.components.SendProgressDialog
import com.photosync.telegram.ui.components.formatDate
import com.photosync.telegram.ui.components.formatSize
import com.photosync.telegram.ui.theme.SuccessColor
import com.photosync.telegram.ui.theme.WarningColor
import kotlinx.coroutines.launch

@Composable
fun LogScreen(vm: LogViewModel, snackbar: SnackbarHostState) {
    val entries by vm.entries.collectAsStateWithLifecycle()
    val progress by vm.progress.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var filter by remember { mutableStateOf<SendStatus?>(null) }
    var confirmClear by remember { mutableStateOf(false) }

    SendProgressDialog(progress, onCancel = vm::cancelSend, onDismiss = vm::dismissResult)

    Column(Modifier.fillMaxSize()) {
        ScreenTitle("سجل الإرسال") {
            IconButton(onClick = { confirmClear = true }, enabled = entries.isNotEmpty()) {
                Icon(Icons.Default.DeleteSweep, "مسح السجل")
            }
        }
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(filter == null, { filter = null }, { Text("الكل") })
            FilterChip(filter == SendStatus.SUCCESS, { filter = SendStatus.SUCCESS }, { Text("ناجح") })
            FilterChip(filter == SendStatus.FAILED, { filter = SendStatus.FAILED }, { Text("فاشل") })
            FilterChip(filter == SendStatus.PENDING, { filter = SendStatus.PENDING }, { Text("قيد الانتظار") })
        }
        val shown = entries.filter { filter == null || it.status == filter }
        if (shown.isEmpty()) {
            Text("لا توجد عمليات", Modifier.padding(24.dp))
        } else {
            LazyColumn(
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(shown, key = { it.id }) { e ->
                    LogRow(e, onRetry = {
                        if (!vm.retry(e)) scope.launch { snackbar.showSnackbar("هناك عملية إرسال جارية، انتظر انتهاءها") }
                    }, onDelete = { vm.delete(e) })
                }
            }
        }
    }

    if (confirmClear) {
        ConfirmDialog(
            "مسح السجل؟", "سيُحذف سجل العمليات فقط، ولا تتأثر الصور على هاتفك ولا الرسائل في Telegram.",
            "مسح", onConfirm = vm::clear, onDismiss = { confirmClear = false },
        )
    }
}

@Composable
private fun LogRow(e: SendLogEntity, onRetry: () -> Unit, onDelete: () -> Unit) {
    InfoCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(e.name, Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, maxLines = 1)
            val (label, color) = when (e.status) {
                SendStatus.SUCCESS -> "ناجح" to SuccessColor
                SendStatus.FAILED -> "فاشل" to MaterialTheme.colorScheme.error
                SendStatus.PENDING -> "قيد الانتظار" to WarningColor
            }
            Text(label, color = color, style = MaterialTheme.typography.labelLarge)
        }
        Text(
            formatDate(e.updatedAt) + " • " + formatSize(e.sizeBytes) +
                (if (e.asDocument) " • ملف" else "") + (if (e.auto) " • تلقائي" else ""),
            style = MaterialTheme.typography.bodySmall,
        )
        if (e.status == SendStatus.FAILED && !e.error.isNullOrBlank()) {
            Text(e.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        Row {
            if (e.status != SendStatus.SUCCESS) TextButton(onClick = onRetry) { Text("إعادة المحاولة") }
            TextButton(onClick = onDelete) { Text("حذف من السجل") }
        }
    }
}
