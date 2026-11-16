import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'restaurant.db');

if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));

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
