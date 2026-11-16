import { db } from './driver.js';

export { db };

/** ترقية قواعد البيانات القديمة (إضافة الأعمدة الجديدة) */
function migrate() {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols('orders').includes('code')) db.exec('ALTER TABLE orders ADD COLUMN code TEXT');
  if (!cols('order_items').includes('sent_by')) db.exec('ALTER TABLE order_items ADD COLUMN sent_by INTEGER');
  db.exec(`UPDATE orders SET code = 'ORD-' || substr(replace(date(created_at), '-', ''), 3) || '-' || printf('%04d', number) WHERE code IS NULL`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_code ON orders(code)');
}
migrate();

/** صف واحد */
export const get = (sql, ...params) => db.prepare(sql).get(...params);
/** كل الصفوف */
export const all = (sql, ...params) => db.prepare(sql).all(...params);
/** تنفيذ أمر */
export const run = (sql, ...params) => db.prepare(sql).run(...params);

/** تنفيذ دالة داخل معاملة (transaction) */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** إعدادات المطعم مع القيم الافتراضية */
const DEFAULT_SETTINGS = {
  restaurant_name: 'مطعمي',
  address: '',
  phone: '',
  tax_number: '',
  currency: 'ر.س',
  tax_rate: '15',          // %
  tax_inclusive: '0',      // 1 = الأسعار شاملة الضريبة
  service_rate: '0',       // % رسوم خدمة الصالة
  delivery_fee: '10',
  receipt_footer: 'شكراً لزيارتكم',
  loyalty_points_per_unit: '1', // نقطة لكل وحدة عملة
  late_grace_minutes: '10',      // سماحية التأخير بالدقائق
  late_deduction: '1',           // خصم التأخير من الراتب (1/0)
  doc_alert_days: '30',          // التنبيه قبل انتهاء المستندات بأيام
};

export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export function setSettings(obj) {
  const stmt = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  tx(() => {
    for (const [k, v] of Object.entries(obj)) {
      if (k in DEFAULT_SETTINGS) stmt.run(k, String(v ?? ''));
    }
  });
  return getSettings();
}

export function audit(userId, action, entity, entityId, details) {
  run('INSERT INTO audit_log(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)',
    userId ?? null, action, entity ?? null, entityId ?? null, details ? JSON.stringify(details) : null);
}
