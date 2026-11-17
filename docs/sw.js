// Service Worker: يعرض إشعارات تحديثات طلب الزبون (Web Push) حتى لو أُغلقت الصفحة
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'تحديث على طلبك', body: event.data ? event.data.text() : '' }; }
  const ready = d.kind === 'ready';
  event.waitUntil(self.registration.showNotification(d.title || 'تحديث على طلبك', {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-96.png',
    tag: d.tag || 'order',          // تحديث الإشعار نفسه بدل تكديس إشعارات
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    vibrate: ready ? [250, 120, 250, 120, 400] : [150, 80, 150],
    requireInteraction: ready,       // «جاهز» يبقى حتى يضغط عليه
    timestamp: Date.now(),
    data: { url: d.url || null },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if (url && 'navigate' in c) { try { await c.navigate(url); } catch { /* */ } } return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url || './');
  })());
});
