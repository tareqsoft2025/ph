package com.photosync.telegram.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.photosync.telegram.ui.TelegramViewModel
import com.photosync.telegram.ui.components.InfoCard
import com.photosync.telegram.ui.components.ScreenTitle
import com.photosync.telegram.ui.theme.SuccessColor

@Composable
fun TelegramScreen(vm: TelegramViewModel, onBack: () -> Unit) {
    val ui by vm.ui.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxSize()) {
        ScreenTitle("إعداد Telegram", onBack = onBack)
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            InfoCard {
                Text("طريقة الحصول على البيانات", style = MaterialTheme.typography.titleMedium)
                Text(
                    "١. افتح Telegram وابحث عن @BotFather ثم أرسل /newbot واتبع الخطوات للحصول على Bot Token.\n" +
                        "٢. محادثة خاصة: افتح بوتك وأرسل له /start.\n" +
                        "   مجموعة: أضف البوت للمجموعة وأرسل رسالة فيها.\n" +
                        "   قناة: أضف البوت كمشرف بصلاحية النشر، وأدخل @اسم_القناة أو رقمها.\n" +
                        "٣. اضغط «اكتشاف Chat ID» وسيعرض التطبيق المحادثات التي راسلت البوت مؤخرًا.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            OutlinedTextField(
                value = ui.token, onValueChange = vm::onToken,
                label = { Text("Bot Token") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                visualTransformation = if (ui.showToken) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                trailingIcon = {
                    IconButton(onClick = vm::toggleShow) {
                        Icon(if (ui.showToken) Icons.Default.VisibilityOff else Icons.Default.Visibility, "إظهار/إخفاء")
                    }
                },
            )
            OutlinedTextField(
                value = ui.chatId, onValueChange = vm::onChatId,
                label = { Text("Chat ID  (مثال: 123456789 أو -100123… أو @channel)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = vm::detectChats, enabled = !ui.busy) { Text("اكتشاف Chat ID") }
                OutlinedButton(onClick = vm::save, enabled = !ui.busy) { Text("حفظ") }
            }
            ui.chats.forEach { chat ->
                AssistChip(
                    onClick = { vm.pickChat(chat) },
                    label = { Text("${chat.title.ifBlank { "بدون اسم" }} (${chat.type}) ${chat.id}") },
                )
            }

            Button(onClick = vm::test, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) {
                if (ui.busy) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
                Text("اختبار الاتصال")
            }
            OutlinedButton(onClick = vm::sendTestMessage, enabled = !ui.busy, modifier = Modifier.fillMaxWidth()) {
                Text("إرسال رسالة اختبار")
            }

            ui.message?.let {
                Text(
                    it.text,
                    color = if (it.ok) SuccessColor else MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            InfoCard {
                Text("الخصوصية", style = MaterialTheme.typography.titleSmall)
                Text(
                    "يُحفظ الرمز مشفّرًا على جهازك فقط (Android Keystore) ولا يُكتب في أي سجل. " +
                        "الصور المرسلة تصبح متاحة لجميع من لديهم حق الاطلاع على تلك المحادثة وفق إعداداتها.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
