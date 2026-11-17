// "الخادم" التجريبي: نفس منطق backend/src يعمل داخل المتصفح
import { buildRouter } from '../../../backend/src/routes.js';
import { ensureSeed } from '../../../backend/src/seed.js';
import { dispatch } from './express.js';
import { bus, ALL_EVENTS } from './bus.js';
import { saveIfDirty, reloadFromStorage, STORAGE_KEY, db } from './driver.js';

ensureSeed();
// في النسخة التجريبية يبدأ شرط الحضور الإلزامي معطّلاً (يُفعَّل من الإعدادات)
db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES('att_required_before_work', '0')").run();
saveIfDirty();
const router = buildRouter((event, payload) => bus.emit(event, payload));

// تبويب آخر (مثلاً شاشة المطبخ) غيّر البيانات: أعد التحميل وحدّث كل الشاشات
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY || !e.newValue) return;
  reloadFromStorage();
  ALL_EVENTS.forEach((ev) => bus.emit(ev));
});

export async function handle(method, url, body, token) {
  const result = await dispatch(router, {
    method,
    url,
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  saveIfDirty();
  return result;
}

export { bus };
export { resetDemo } from './driver.js';
