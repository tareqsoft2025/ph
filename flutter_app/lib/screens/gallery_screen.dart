import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:photo_manager_image_provider/photo_manager_image_provider.dart';

import '../core/services.dart';
import '../core/storage.dart';
import '../core/uploader.dart';
import '../widgets.dart';
import 'telegram_screen.dart';

/// عنصر في الشبكة: صورة من المعرض أو ملف من منتقي الصور.
class _Item {
  _Item.asset(AssetEntity a)
      : key = 'a:${a.id}',
        asset = a,
        file = null,
        date = a.createDateTime;
  _Item.picked(XFile f, int len)
      : key = 'p:${f.name}:$len',
        asset = null,
        file = f,
        date = DateTime.now();

  final String key;
  final AssetEntity? asset;
  final XFile? file;
  final DateTime date;
}

class GalleryScreen extends StatefulWidget {
  const GalleryScreen({super.key});

  @override
  State<GalleryScreen> createState() => _GalleryScreenState();
}

class _GalleryScreenState extends State<GalleryScreen> {
  static const _pageSize = 120;
  final _scroll = ScrollController();
  bool _hasAccess = false, _loading = true, _hasMore = true;
  List<AssetPathEntity> _albums = [];
  AssetPathEntity? _album;
  final List<_Item> _assets = [];
  final List<_Item> _picked = [];
  final Map<String, _Item> _selected = {};
  Set<String> _sent = {};
  int _page = 0;

  List<_Item> get _visible => [..._picked, ..._assets];

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 600) _loadMore();
    });
    LogDb.instance.changes.addListener(_refreshSent);
    _init();
  }

  @override
  void dispose() {
    LogDb.instance.changes.removeListener(_refreshSent);
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _refreshSent() async {
    final k = await LogDb.instance.successKeys();
    if (mounted) setState(() => _sent = k);
  }

  Future<void> _init() async {
    await _refreshSent();
    final perm = await PhotoManager.requestPermissionExtend();
    if (!perm.hasAccess) {
      setState(() {
        _hasAccess = false;
        _loading = false;
      });
      return;
    }
    final albums = await PhotoManager.getAssetPathList(type: RequestType.image, onlyAll: false);
    setState(() {
      _hasAccess = true;
      _albums = albums;
      _album = albums.isEmpty ? null : albums.firstWhere((a) => a.isAll, orElse: () => albums.first);
    });
    await _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _assets.clear();
      _page = 0;
      _hasMore = true;
    });
    await _loadMore();
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _loadMore() async {
    final album = _album;
    if (album == null || !_hasMore) return;
    final page = _page++;
    final list = await album.getAssetListPaged(page: page, size: _pageSize);
    if (!mounted) return;
    setState(() {
      _assets.addAll(list.map(_Item.asset));
      if (list.length < _pageSize) _hasMore = false;
      _loading = false;
    });
  }

  Future<void> _pick() async {
    final files = await ImagePicker().pickMultiImage();
    if (files.isEmpty) return;
    final items = <_Item>[];
    for (final f in files) {
      items.add(_Item.picked(f, await f.length()));
    }
    setState(() {
      for (final i in items) {
        if (_picked.every((p) => p.key != i.key)) _picked.add(i);
        _selected[i.key] = i;
      }
    });
  }

  Future<void> _send() async {
    final settings = SettingsStore.instance.value;
    if (!settings.configured) {
      toast(context, 'أعدّ اتصال Telegram أولًا');
      Navigator.push(context, MaterialPageRoute(builder: (_) => const TelegramScreen()));
      return;
    }
    final dup = _selected.keys.where(_sent.contains).length;
    var asDoc = settings.sendAsDocument;
    var skip = true;
    final go = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text('إرسال ${_selected.length} صورة؟'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('ستُرسل الصور المحددة فقط إلى محادثة Telegram المضبوطة، وستصبح متاحة لكل من يطّلع على تلك المحادثة.'),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('إرسال كملف أصلي (بدون ضغط)'),
              value: asDoc,
              onChanged: (v) => set(() => asDoc = v),
            ),
            if (dup > 0)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('تخطّي $dup صورة أُرسلت سابقًا'),
                value: skip,
                onChanged: (v) => set(() => skip = v),
              ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('إلغاء')),
            TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('إرسال')),
          ],
        ),
      ),
    );
    if (go != true) return;
    final refs = <PhotoRef>[];
    for (final i in _selected.values.where((i) => !skip || !_sent.contains(i.key))) {
      refs.add(i.asset != null ? await PhotoRef.fromAsset(i.asset!) : await PhotoRef.fromPicked(i.file!));
    }
    if (SendController.instance.start(refs, asDoc)) {
      setState(_selected.clear);
    } else if (mounted) {
      toast(context, 'لا توجد صور للإرسال أو هناك عملية إرسال جارية');
    }
  }

  void _preview() {
    final items = _selected.values.toList();
    showDialog<void>(
      context: context,
      builder: (c) => Dialog.fullscreen(
        backgroundColor: Colors.black,
        child: Stack(children: [
          PageView.builder(
            itemCount: items.length,
            itemBuilder: (c, i) => Column(children: [
              Expanded(child: _full(items[i])),
              FutureBuilder<int>(
                future: _size(items[i]),
                builder: (c, s) => Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text('${i + 1} / ${items.length}  •  ${formatSize(s.data ?? 0)}',
                      style: const TextStyle(color: Colors.white)),
                ),
              ),
            ]),
          ),
          Positioned(top: 8, right: 8, child: IconButton(color: Colors.white, icon: const Icon(Icons.close), onPressed: () => Navigator.pop(c))),
        ]),
      ),
    );
  }

  Widget _full(_Item i) => i.asset != null
      ? AssetEntityImage(i.asset!, isOriginal: false, thumbnailSize: const ThumbnailSize.square(1200), fit: BoxFit.contain)
      : Image.file(File(i.file!.path), fit: BoxFit.contain);

  Future<int> _size(_Item i) async {
    final f = i.asset != null ? await i.asset!.originFile : File(i.file!.path);
    return f == null ? 0 : await f.length();
  }

  @override
  Widget build(BuildContext context) {
    final items = _visible;
    return Column(children: [
      AppBar(title: const Text('المعرض'), actions: [
        IconButton(tooltip: 'منتقي الصور الرسمي', icon: const Icon(Icons.folder_open), onPressed: _pick),
        if (_hasAccess)
          PopupMenuButton<AssetPathEntity>(
            tooltip: 'الألبوم',
            icon: const Icon(Icons.photo_album_outlined),
            onSelected: (a) {
              _album = a;
              _selected.clear();
              _reload();
            },
            itemBuilder: (_) => [for (final a in _albums) PopupMenuItem(value: a, child: Text(a.name))],
          ),
        IconButton(tooltip: 'تحديد الكل', icon: const Icon(Icons.select_all), onPressed: () => setState(() {
          for (final i in items) {
            _selected[i.key] = i;
          }
        })),
        IconButton(tooltip: 'إلغاء التحديد', icon: const Icon(Icons.clear_all), onPressed: () => setState(_selected.clear)),
      ]),
      Expanded(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : items.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        Text(_hasAccess
                            ? 'لا توجد صور لعرضها'
                            : 'للاطلاع على الصور داخل التطبيق امنح إذن الصور (يمكن منح وصول جزئي)، أو استخدم منتقي الصور الرسمي بدون أي إذن.'),
                        const SizedBox(height: 12),
                        if (!_hasAccess) FilledButton(onPressed: _init, child: const Text('منح إذن الصور')),
                        OutlinedButton(onPressed: _pick, child: const Text('اختيار عبر منتقي الصور')),
                      ]),
                    ),
                  )
                : GridView.builder(
                    controller: _scroll,
                    padding: const EdgeInsets.all(8),
                    gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 120, mainAxisSpacing: 6, crossAxisSpacing: 6, childAspectRatio: 0.78),
                    itemCount: items.length,
                    itemBuilder: (c, idx) => _cell(items[idx]),
                  ),
      ),
      if (_selected.isNotEmpty)
        Material(
          elevation: 3,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(children: [
              Expanded(child: Text('${_selected.length} محددة')),
              OutlinedButton(onPressed: _preview, child: const Text('معاينة')),
              const SizedBox(width: 8),
              FilledButton(onPressed: _send, child: const Text('إرسال')),
            ]),
          ),
        ),
    ]);
  }

  Widget _cell(_Item i) {
    final sel = _selected.containsKey(i.key);
    final small = Theme.of(context).textTheme.labelSmall;
    return GestureDetector(
      onTap: () => setState(() => sel ? _selected.remove(i.key) : _selected[i.key] = i),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Stack(fit: StackFit.expand, children: [
              i.asset != null
                  ? AssetEntityImage(i.asset!, isOriginal: false, thumbnailSize: const ThumbnailSize.square(250), fit: BoxFit.cover)
                  : Image.file(File(i.file!.path), fit: BoxFit.cover, cacheWidth: 300),
              if (sel) Container(color: Theme.of(context).colorScheme.primary.withOpacity(0.35)),
              if (sel) const Positioned(top: 6, left: 6, child: Icon(Icons.check_circle, color: Colors.white)),
              if (_sent.contains(i.key))
                Positioned(
                  bottom: 4,
                  right: 4,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: const Color(0xCC2E7D32), borderRadius: BorderRadius.circular(6)),
                    child: const Text('أُرسلت', style: TextStyle(color: Colors.white, fontSize: 10)),
                  ),
                ),
            ]),
          ),
        ),
        Text(formatDate(i.date), style: small, maxLines: 1, overflow: TextOverflow.ellipsis),
        Text(i.asset != null ? '${i.asset!.width}×${i.asset!.height}' : 'من المنتقي', style: small),
      ]),
    );
  }
}
