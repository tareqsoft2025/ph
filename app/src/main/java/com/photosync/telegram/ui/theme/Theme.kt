package com.photosync.telegram.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Light = lightColorScheme(
    primary = Color(0xFF00796B),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFB2DFDB),
    onPrimaryContainer = Color(0xFF00201C),
    secondary = Color(0xFF4A6360),
    secondaryContainer = Color(0xFFCCE8E3),
    background = Color(0xFFF6FAF9),
    surface = Color(0xFFF6FAF9),
    surfaceVariant = Color(0xFFDAE5E2),
    error = Color(0xFFBA1A1A),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF4DB6AC),
    onPrimary = Color(0xFF00201C),
    primaryContainer = Color(0xFF00504A),
    onPrimaryContainer = Color(0xFFB2DFDB),
    secondary = Color(0xFFB0CCC7),
    secondaryContainer = Color(0xFF334B47),
    background = Color(0xFF101413),
    surface = Color(0xFF101413),
    surfaceVariant = Color(0xFF3F4947),
)

val SuccessColor = Color(0xFF2E7D32)
val WarningColor = Color(0xFFEF6C00)

@Composable
fun PhotoSyncTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
