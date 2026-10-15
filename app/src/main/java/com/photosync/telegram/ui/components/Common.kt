package com.photosync.telegram.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.photosync.telegram.telegram.SendProgress
import java.text.DateFormat
import java.util.Date
import java.util.Locale

fun formatSize(bytes: Long): String = when {
    bytes <= 0 -> "—"
    bytes < 1024 * 1024 -> String.format(Locale.getDefault(), "%.0f KB", bytes / 1024.0)
    else -> String.format(Locale.getDefault(), "%.1f MB", bytes / (1024.0 * 1024.0))
}

fun formatDate(millis: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(millis))

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenTitle(
    title: String,
    onBack: (() -> Unit)? = null,
    actions: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = { Text(title) },
        navigationIcon = {
            if (onBack != null) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع") }
            }
        },
        actions = actions,
        colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
    )
}

@Composable
fun InfoCard(
    modifier: Modifier = Modifier,
    container: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = container),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

@Composable
fun LabeledRow(label: String, modifier: Modifier = Modifier, trailing: @Composable () -> Unit) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.width(12.dp))
        trailing()
    }
}

@Composable
fun ConfirmDialog(
    title: String, text: String, confirmLabel: String,
    onConfirm: () -> Unit, onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = { onConfirm(); onDismiss() }) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

/** نافذة تقدم الإرسال مع زر إيقاف، ثم ملخص النتيجة. */
@Composable
fun SendProgressDialog(p: SendProgress, onCancel: () -> Unit, onDismiss: () -> Unit) {
    if (!p.active && !p.finished) return
    AlertDialog(
        onDismissRequest = { if (!p.active) onDismiss() },
        title = { Text(if (p.active) "جارٍ الإرسال…" else if (p.cancelled) "تم إيقاف الإرسال" else "اكتمل الإرسال") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                LinearProgressIndicator(progress = { p.fraction }, modifier = Modifier.fillMaxWidth())
                Text("${p.processed} من ${p.total}  •  ناجح ${p.succeeded}  •  فاشل ${p.failed}")
                p.current?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 1) }
                if (!p.active && p.failed > 0) Text("راجع «السجل» لمعرفة الأخطاء وإعادة المحاولة.")
            }
        },
        confirmButton = {
            if (p.active) TextButton(onClick = onCancel) { Text("إيقاف") }
            else TextButton(onClick = onDismiss) { Text("تم") }
        },
    )
}
