// الإشعارات: تُحفظ لكل مستخدم مستهدف ثم تُبث لحظياً
import { all, run } from './db.js';

let emitter = () => {};
/** يُضبط من الموجّه ليُرسل حدث "notify" لكل الأجهزة */
export function setNotifyEmitter(fn) { emitter = fn; }

/**
 * @param {{ userIds?: number[], roles?: string[], type: string, title: string, body?: string, link?: string, level?: string, exclude?: number }} n
 */
export function notify({ userIds = [], roles = [], type, title, body = null, link = null, level = 'info', exclude = null }) {
  const ids = new Set(userIds.filter(Boolean).map(Number));
  if (roles.length) {
    const rows = all(`SELECT id FROM users WHERE active = 1 AND role IN (${roles.map(() => '?').join(',')})`, ...roles);
    rows.forEach((r) => ids.add(r.id));
  }
  if (exclude) ids.delete(exclude);
  if (!ids.size) return [];
  for (const id of ids) {
    run('INSERT INTO notifications(user_id, type, title, body, link, level) VALUES(?,?,?,?,?,?)', id, type, title, body, link, level);
  }
  const userIdsArr = [...ids];
  emitter('notify', { user_ids: userIdsArr, type, title, body, link, level });
  return userIdsArr;
}
