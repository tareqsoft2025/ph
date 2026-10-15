package com.photosync.telegram

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.photosync.telegram.ui.AutomationViewModel
import com.photosync.telegram.ui.GalleryViewModel
import com.photosync.telegram.ui.HomeViewModel
import com.photosync.telegram.ui.LogViewModel
import com.photosync.telegram.ui.SettingsViewModel
import com.photosync.telegram.ui.TelegramViewModel
import com.photosync.telegram.ui.screens.AutomationScreen
import com.photosync.telegram.ui.screens.GalleryScreen
import com.photosync.telegram.ui.screens.HomeScreen
import com.photosync.telegram.ui.screens.LogScreen
import com.photosync.telegram.ui.screens.SettingsScreen
import com.photosync.telegram.ui.screens.TelegramScreen
import com.photosync.telegram.ui.theme.PhotoSyncTheme
import com.photosync.telegram.ui.vmFactory

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("home", "الرئيسية", Icons.Default.Home),
    Tab("gallery", "المعرض", Icons.Default.PhotoLibrary),
    Tab("log", "السجل", Icons.Default.History),
    Tab("auto", "الأتمتة", Icons.Default.Sync),
    Tab("settings", "الإعدادات", Icons.Default.Settings),
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val c = (application as PhotoSyncApp).container
        setContent {
            PhotoSyncTheme {
                // الواجهة عربية بالكامل، نفرض RTL بغض النظر عن لغة النظام.
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    App(c)
                }
            }
        }
    }
}

@Composable
private fun App(c: AppContainer) {
    val nav = rememberNavController()
    val snackbar = remember { SnackbarHostState() }
    val route = nav.currentBackStackEntryAsState().value?.destination?.route

    fun go(r: String) = nav.navigate(r) {
        popUpTo(nav.graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (tabs.any { it.route == route }) {
                NavigationBar {
                    tabs.forEach { t ->
                        NavigationBarItem(
                            selected = route == t.route,
                            onClick = { go(t.route) },
                            icon = { Icon(t.icon, null) },
                            label = { Text(t.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = "home", modifier = Modifier.padding(padding).fillMaxSize()) {
            composable("home") {
                val vm: HomeViewModel = viewModel(factory = vmFactory { HomeViewModel(c) })
                HomeScreen(vm, onTelegram = { nav.navigate("telegram") }, onGallery = { go("gallery") }, onAutomation = { go("auto") })
            }
            composable("gallery") {
                val vm: GalleryViewModel = viewModel(factory = vmFactory { GalleryViewModel(c) })
                GalleryScreen(vm, snackbar, onOpenTelegram = { nav.navigate("telegram") })
            }
            composable("log") {
                val vm: LogViewModel = viewModel(factory = vmFactory { LogViewModel(c) })
                LogScreen(vm, snackbar)
            }
            composable("auto") {
                val vm: AutomationViewModel = viewModel(factory = vmFactory { AutomationViewModel(c) })
                AutomationScreen(vm, snackbar)
            }
            composable("settings") {
                val vm: SettingsViewModel = viewModel(factory = vmFactory { SettingsViewModel(c) })
                SettingsScreen(vm, onTelegram = { nav.navigate("telegram") })
            }
            composable("telegram") {
                val vm: TelegramViewModel = viewModel(factory = vmFactory { TelegramViewModel(c) })
                TelegramScreen(vm, onBack = { nav.popBackStack() })
            }
        }
    }
}
