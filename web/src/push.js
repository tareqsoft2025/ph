// الإشعارات الفورية (Firebase) داخل تطبيق الأندرويد — تصل حتى لو كان التطبيق مغلقاً
import { registerPlugin } from '@capacitor/core';
import { api, isNative } from './api.js';

const FirebaseCheck = registerPlugin('FirebaseCheck');
let currentToken = null;
let active = false;

/** هل الإشعارات الفورية مفعّلة على هذا الجهاز (لتجنب تكرار الإشعار المحلي) */
export const pushActive = () => active;

async function firebaseAvailable() {
  try { return (await FirebaseCheck.isAvailable()).available; } catch { return false; }
}

/**
 * يسجّل الجهاز لاستقبال الإشعارات الفورية
 * @returns {Promise<{state: 'unsupported'|'not-configured'|'server-disabled'|'denied'|'active', detail?: string}>}
 */
export async function setupPush(navigate) {
  if (!isNative) return { state: 'unsupported' };
  if (!(await firebaseAvailable())) return { state: 'not-configured' };
  const status = await api('/push/status').catch(() => ({ enabled: false }));
  if (!status.enabled) return { state: 'server-disabled' };

  const { PushNotifications } = await import('@capacitor/push-notifications');
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return { state: 'denied' };

  await PushNotifications.createChannel({ id: 'orders', name: 'الطلبات', description: 'طلبات جديدة وطلبات جاهزة', importance: 5, sound: 'default', vibration: true, visibility: 1 }).catch(() => {});
  await PushNotifications.createChannel({ id: 'general', name: 'عام', description: 'الإجازات والمخزون والتنبيهات', importance: 4, vibration: true }).catch(() => {});
  await PushNotifications.removeAllListeners();

  const registered = new Promise((resolve) => {
    PushNotifications.addListener('registration', async ({ value }) => {
      currentToken = value;
      await api('/push/register', { method: 'POST', body: { token: value, platform: 'android' } }).catch(() => {});
      active = true;
      resolve({ state: 'active' });
    });
    PushNotifications.addListener('registrationError', (e) => resolve({ state: 'denied', detail: e?.error }));
  });
  // الضغط على الإشعار يفتح الصفحة المرتبطة
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const link = notification?.data?.link;
    if (link && navigate) navigate(link);
  });
  await PushNotifications.register();
  return Promise.race([registered, new Promise((r) => setTimeout(() => r({ state: 'denied', detail: 'timeout' }), 15000))]);
}

/** عند تسجيل الخروج: إيقاف الإشعارات لهذا المستخدم على الجهاز */
export async function teardownPush() {
  if (!currentToken) return;
  await api('/push/unregister', { method: 'POST', body: { token: currentToken } }).catch(() => {});
  currentToken = null;
  active = false;
}
