// إشعارات Web Push للزبون: تصله تحديثات طلبه حتى لو أغلق الصفحة
import { api } from './api.js';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** هل الخادم يدعم الإشعارات؟ يرجع مفتاح VAPID العام أو null */
export async function pushKey() {
  try { const r = await api('/public/push/key'); return r.enabled ? r.key : null; } catch { return null; }
}

/** يطلب الإذن ويسجّل اشتراك الزبون لطلبه: ترجع 'granted' أو 'denied' أو 'default' أو 'error' */
export async function enableOrderPush(code, token) {
  const key = await pushKey();
  if (!key) return 'unavailable';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  const reg = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api(`/public/orders/${code}/push?t=${token}`, { method: 'POST', body: { subscription: sub.toJSON(), url: window.location.href } });
  return 'granted';
}

/** يسجّل اشتراك الزبون لإشعارات ردود المحادثة (برمز جهازه): ترجع 'granted' أو 'denied' أو 'default' أو 'unavailable' */
export async function enableChatPush(token, device) {
  const key = await pushKey();
  if (!key) return 'unavailable';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  const reg = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api(`/public/event/${token}/chat/push`, { method: 'POST', body: { device_id: device, subscription: sub.toJSON(), url: window.location.href } });
  return 'granted';
}
