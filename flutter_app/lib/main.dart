import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'core/auto_send.dart';
import 'core/storage.dart';
import 'screens/automation_screen.dart';
import 'screens/gallery_screen.dart';
import 'screens/home_screen.dart';
import 'screens/log_screen.dart';
import 'screens/settings_screen.dart';
import 'widgets.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SettingsStore.instance.load();
  await AutoSend.init();
  await initNotifications(onResponse: (NotificationResponse r) {
    if (r.actionId == stopActionId) AutoSend.disable();
  });
  runApp(const PhotoSyncApp());
}

class PhotoSyncApp extends StatelessWidget {
  const PhotoSyncApp({super.key});

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF00796B);
    return MaterialApp(
      title: 'PhotoSync Telegram',
      debugShowCheckedModeBanner: false,
      // الواجهة عربية بالكامل (RTL)
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: seed), useMaterial3: true),
      darkTheme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark), useMaterial3: true),
      home: const Shell(),
    );
  }
}

class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _index = 0;

  void go(int i) => setState(() => _index = i);

  @override
  Widget build(BuildContext context) {
    return Stack(children: [
      Scaffold(
        body: SafeArea(
          child: IndexedStack(index: _index, children: [
            HomeScreen(onGo: go),
            const GalleryScreen(),
            const LogScreen(),
            const AutomationScreen(),
            const SettingsScreen(),
          ]),
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: go,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'الرئيسية'),
            NavigationDestination(icon: Icon(Icons.photo_library_outlined), selectedIcon: Icon(Icons.photo_library), label: 'المعرض'),
            NavigationDestination(icon: Icon(Icons.history), label: 'السجل'),
            NavigationDestination(icon: Icon(Icons.sync), label: 'الأتمتة'),
            NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'الإعدادات'),
          ],
        ),
      ),
      const Positioned.fill(child: SendProgressOverlay()),
    ]);
  }
}
