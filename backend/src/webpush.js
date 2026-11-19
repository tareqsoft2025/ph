// إشعارات Web Push للزبون (VAPID): تصله تحديثات طلبه حتى لو أغلق الصفحة
import webpush from 'web-push';
import { get, all, run } from './db.js';

/** مفاتيح VAPID: تُولَّد مرة واحدة وتُحفظ في قاعدة البيانات */
export function ensureVapid(gen = () => webpush.generateVAPIDKeys()) {
  const pub = get("SELECT value FROM server_keys WHERE name = 'vapid_public'")?.value;
  const priv = get("SELECT value FROM server_keys WHERE name = 'vapid_private'")?.value;
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  const k = gen();
  run("INSERT OR REPLACE INTO server_keys(name, value) VALUES('vapid_public', ?)", k.publicKey);
  run("INSERT OR REPLACE INTO server_keys(name, value) VALUES('vapid_private', ?)", k.privateKey);
  return k;
}

const FINAL = new Set(['paid', 'rejected', 'cancelled']);

/**
 * @param {{ send?: Function, subject?: string, log?: Console }} opts
 * send(subscription, payloadString, options) يُحقن للاختبار
 */
export function createWebPush({ send = (sub, body, o) => webpush.sendNotification(sub, body, o), subject = process.env.VAPID_SUBJECT || 'mailto:admin@restaurant.local', log = console, keys = ensureVapid() } = {}) {
  const opts = { vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 3600, urgency: 'high' };
  async function sendToOrder(orderId, payload) {
    const subs = all('SELECT * FROM web_push_subs WHERE order_id = ?', orderId);
    for (const s of subs) {
      const body = JSON.stringify({ ...payload, url: s.url || null });
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, opts);
      } catch (e) {
        // الاشتراك لم يعد صالحاً (ألغاه الزبون أو انتهى)
        if (e?.statusCode === 404 || e?.statusCode === 410) run('DELETE FROM web_push_subs WHERE id = ?', s.id);
        else log.error?.(`webpush ${e?.statusCode || ''}: ${e?.message || e}`);
      }
    }
    // بعد الإشعار الأخير للطلب لا حاجة للاشتراكات
    if (FINAL.has(payload.kind)) run('DELETE FROM web_push_subs WHERE order_id = ?', orderId);
  }
  /** إشعار رد المحادثة لجهاز الزبون: يرجع عدد الإشعارات التي أُرسلت */
  async function sendToChat(eventId, device, payload) {
    const subs = all('SELECT * FROM chat_push_subs WHERE event_id = ? AND device_id = ?', eventId, device);
    let n = 0;
    for (const s of subs) {
      try {
        await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...payload, url: s.url || null }), opts);
        n++;
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) run('DELETE FROM chat_push_subs WHERE id = ?', s.id);
        else log.error?.(`webpush ${e?.statusCode || ''}: ${e?.message || e}`);
      }
    }
    return n;
  }
  return { publicKey: keys.publicKey, sendToOrder, sendToChat };
}
