package com.photosync.telegram.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ClearAll
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.SelectAll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.photosync.telegram.data.PhotoItem
import com.photosync.telegram.ui.GalleryViewModel
import com.photosync.telegram.ui.components.ScreenTitle
import com.photosync.telegram.ui.components.SendProgressDialog
import com.photosync.telegram.ui.components.formatDate
import com.photosync.telegram.ui.components.formatSize
import kotlinx.coroutines.launch

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun GalleryScreen(vm: GalleryViewModel, snackbar: SnackbarHostState, onOpenTelegram: () -> Unit) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    val sent by vm.sentKeys.collectAsStateWithLifecycle()
    val progress by vm.progress.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    var showSendDialog by rememberSaveable { mutableStateOf(false) }
    var showPreview by rememberSaveable { mutableStateOf(false) }
    var albumMenu by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        vm.refresh()
    }
    val pickerLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris ->
        if (uris.isNotEmpty()) vm.addPicked(uris)
    }
    val pickImages = { pickerLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }

    SendProgressDialog(progress, onCancel = vm::cancelSend, onDismiss = vm::dismissResult)

    Column(Modifier.fillMaxSize()) {
        ScreenTitle("المعرض") {
            IconButton(onClick = pickImages) { Icon(Icons.Default.FolderOpen, "منتقي الصور الرسمي") }
            if (ui.hasAccess) {
                IconButton(onClick = { albumMenu = true }) { Text("ألبوم") }
                DropdownMenu(expanded = albumMenu, onDismissRequest = { albumMenu = false }) {
                    DropdownMenuItem(text = { Text("كل الصور") }, onClick = { vm.selectBucket(null); albumMenu = false })
                    ui.buckets.forEach { b ->
                        DropdownMenuItem(
                            text = { Text("${b.name} (${b.count})") },
                            onClick = { vm.selectBucket(b.id); albumMenu = false },
                        )
                    }
                }
            }
            IconButton(onClick = vm::selectAll) { Icon(Icons.Default.SelectAll, "تحديد الكل") }
            IconButton(onClick = vm::clearSelection) { Icon(Icons.Default.ClearAll, "إلغاء التحديد") }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            val visible = ui.visible
            when {
                ui.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                visible.isEmpty() -> Column(
                    Modifier.align(Alignment.Center).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (!ui.hasAccess) {
                        Text(
                            "للاطلاع على الصور داخل التطبيق امنح إذن الصور (يمكنك منح وصول جزئي لصور محددة)، " +
                                "أو استخدم منتقي الصور الرسمي بدون أي إذن.",
                        )
                        Button(onClick = { permissionLauncher.launch(vm.permissions) }) { Text("منح إذن الصور") }
                    } else {
                        Text("لا توجد صور لعرضها")
                    }
                    OutlinedButton(onClick = pickImages) { Text("اختيار عبر منتقي الصور") }
                }
                else -> LazyVerticalGrid(
                    columns = GridCells.Adaptive(110.dp),
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(visible, key = { it.key }) { item ->
                        PhotoCell(item, item.key in ui.selected, item.key in sent) { vm.toggle(item.key) }
                    }
                }
            }
        }

        if (ui.selected.isNotEmpty()) {
            Surface(tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth()) {
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text("${ui.selected.size} محددة", Modifier.weight(1f))
                    OutlinedButton(onClick = { showPreview = true }) { Text("معاينة") }
                    Button(onClick = {
                        if (!settings.isConfigured) {
                            scope.launch { snackbar.showSnackbar("أعدّ اتصال Telegram أولًا") }
                            onOpenTelegram()
                        } else showSendDialog = true
                    }) { Text("إرسال") }
                }
            }
        }
    }

    if (showPreview && ui.selectedItems.isNotEmpty()) PreviewDialog(ui.selectedItems) { showPreview = false }

    if (showSendDialog) {
        val dup = vm.duplicateCount()
        var asDoc by remember { mutableStateOf(settings.sendAsDocument) }
        var skipSent by remember { mutableStateOf(true) }
        AlertDialog(
            onDismissRequest = { showSendDialog = false },
            title = { Text("إرسال ${ui.selected.size} صورة؟") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "ستُرسل الصور المحددة فقط إلى محادثة Telegram المضبوطة، وستصبح متاحة لكل من " +
                            "يطّلع على تلك المحادثة.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("إرسال كملف أصلي (بدون ضغط)", Modifier.weight(1f))
                        Switch(checked = asDoc, onCheckedChange = { asDoc = it })
                    }
                    if (dup > 0) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("تخطّي $dup صورة أُرسلت سابقًا", Modifier.weight(1f))
                            Switch(checked = skipSent, onCheckedChange = { skipSent = it })
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showSendDialog = false
                    if (!vm.send(asDoc, resendSent = !skipSent)) {
                        scope.launch { snackbar.showSnackbar("لا توجد صور للإرسال أو هناك عملية إرسال جارية") }
                    }
                }) { Text("إرسال") }
            },
            dismissButton = { TextButton(onClick = { showSendDialog = false }) { Text("إلغاء") } },
        )
    }
}

@Composable
private fun PhotoCell(item: PhotoItem, selected: Boolean, sent: Boolean, onClick: () -> Unit) {
    Column(Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f)) {
            AsyncImage(
                model = item.uri,
                contentDescription = item.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (selected) {
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.primary.copy(alpha = 0.35f)))
                Icon(
                    Icons.Default.CheckCircle, null, tint = Color.White,
                    modifier = Modifier.align(Alignment.TopStart).padding(6.dp),
                )
            }
            if (sent) {
                Text(
                    "أُرسلت",
                    color = Color.White,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(4.dp)
                        .background(Color(0xCC2E7D32), RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
        Text(
            formatDate(item.dateMillis), style = MaterialTheme.typography.labelSmall,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp),
        )
        Text(formatSize(item.sizeBytes), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PreviewDialog(items: List<PhotoItem>, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            val pager = rememberPagerState { items.size }
            Box(Modifier.fillMaxSize()) {
                HorizontalPager(pager, Modifier.fillMaxSize()) { page ->
                    AsyncImage(
                        model = items[page].uri, contentDescription = items[page].name,
                        contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize(),
                    )
                }
                Column(Modifier.align(Alignment.TopCenter).fillMaxWidth().background(Color(0x99000000)).padding(12.dp)) {
                    val cur = items[pager.currentPage]
                    Text("${pager.currentPage + 1} / ${items.size}", color = Color.White)
                    Text("${cur.name} • ${formatSize(cur.sizeBytes)}", color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp)) {
                    Text("إغلاق", color = Color.White)
                }
            }
        }
    }
}
