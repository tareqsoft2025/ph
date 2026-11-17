// الإشعارات: تُحفظ لكل مستخدم مستهدف ثم تُبث لحظياً
import { all, run } from './db.js';
import { usersWithPerm } from './perms.js';

let emitter = () => {};
/** يُضبط من الموجّه ليُرسل حدث "notify" لكل الأجهزة */
export function setNotifyEmitter(fn) { emitter = fn; }

// مُرسل الإشعارات الفورية (Firebase) — يضبطه الخادم عند توفر حساب الخدمة
let pushSender = null;
export function setPushSender(fn) { pushSender = fn; }
export const pushEnabled = () => !!pushSender;

// إشعارات Web Push للزبون (طلب QR): يضبطها الخادم عند توفرها (غير متاحة في النسخة التجريبية)
let webPush = null;
export function setWebPush(impl) { webPush = impl; }
export const webPushKey = () => webPush?.publicKey || null;
/** يرسل إشعاراً لزبون الطلب (لا ينتظر ولا يفشل الطلب إن تعذّر) */
export function customerNotify(orderId, payload) {
  if (!webPush) return;
  Promise.resolve().then(() => webPush.sendToOrder(orderId, payload)).catch((e) => console.error('webpush:', e.message));
}

/**
 * @param {{ userIds?: number[], roles?: string[], type: string, title: string, body?: string, link?: string, level?: string, exclude?: number }} n
 */
export function notify({ userIds = [], roles = [], perms = [], type, title, body = null, link = null, level = 'info', exclude = null }) {
  const ids = new Set(userIds.filter(Boolean).map(Number));
  if (roles.length) {
    const rows = all(`SELECT id FROM users WHERE active = 1 AND role IN (${roles.map(() => '?').join(',')})`, ...roles);
    rows.forEach((r) => ids.add(r.id));
  }
  for (const p of perms) usersWithPerm(p).forEach((id) => ids.add(id));
  if (exclude) ids.delete(exclude);
  if (!ids.size) return [];
  for (const id of ids) {
    run('INSERT INTO notifications(user_id, type, title, body, link, level) VALUES(?,?,?,?,?,?)', id, type, title, body, link, level);
  }
  const userIdsArr = [...ids];
  emitter('notify', { user_ids: userIdsArr, type, title, body, link, level });
  if (pushSender) {
    // لا ننتظر الإرسال حتى لا نؤخر الطلب
    Promise.resolve().then(() => pushSender(userIdsArr, { type, title, body, link, level })).catch((e) => console.error('push:', e.message));
  }
  return userIdsArr;
}
