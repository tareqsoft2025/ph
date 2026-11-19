import { db } from './driver.js';

export { db };

/** ترقية قواعد البيانات القديمة (إضافة الأعمدة الجديدة) */
function migrate() {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!cols('orders').includes('code')) db.exec('ALTER TABLE orders ADD COLUMN code TEXT');
  if (!cols('order_items').includes('sent_by')) db.exec('ALTER TABLE order_items ADD COLUMN sent_by INTEGER');
  if (!cols('dining_tables').includes('qr_token')) db.exec('ALTER TABLE dining_tables ADD COLUMN qr_token TEXT');
  if (!cols('dining_tables').includes('qr_opened_by')) { db.exec('ALTER TABLE dining_tables ADD COLUMN qr_opened_by INTEGER'); db.exec('ALTER TABLE dining_tables ADD COLUMN qr_opened_at TEXT'); }
  if (!cols('dining_tables').includes('qr_request_at')) db.exec('ALTER TABLE dining_tables ADD COLUMN qr_request_at TEXT');
  if (!cols('dining_tables').includes('qr_open_until')) db.exec('ALTER TABLE dining_tables ADD COLUMN qr_open_until TEXT');
  if (!cols('orders').includes('pending_confirm')) db.exec('ALTER TABLE orders ADD COLUMN pending_confirm INTEGER NOT NULL DEFAULT 0');
  if (!cols('orders').includes('device_id')) db.exec('ALTER TABLE orders ADD COLUMN device_id TEXT');
  if (!cols('orders').includes('bill_method')) { db.exec('ALTER TABLE orders ADD COLUMN bill_method TEXT'); db.exec('ALTER TABLE orders ADD COLUMN bill_name TEXT'); db.exec('ALTER TABLE orders ADD COLUMN bill_phone TEXT'); }
  if (!cols('customers').includes('pay_method')) { db.exec('ALTER TABLE customers ADD COLUMN pay_method TEXT'); db.exec('ALTER TABLE customers ADD COLUMN pay_phone TEXT'); db.exec('ALTER TABLE customers ADD COLUMN pay_name TEXT'); }
  if (!cols('orders').includes('event_id')) { db.exec('ALTER TABLE orders ADD COLUMN event_id INTEGER'); db.exec('ALTER TABLE orders ADD COLUMN place TEXT'); }
  if (!cols('events').includes('welcome_message')) { db.exec('ALTER TABLE events ADD COLUMN welcome_message TEXT'); db.exec('ALTER TABLE events ADD COLUMN support_phone TEXT'); db.exec('ALTER TABLE events ADD COLUMN support_chat INTEGER NOT NULL DEFAULT 1'); }
  if (!cols('events').includes('cat_times')) db.exec('ALTER TABLE events ADD COLUMN cat_times TEXT');
  if (!cols('orders').includes('source')) db.exec("ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'staff'");
  if (!cols('orders').includes('track_token')) db.exec('ALTER TABLE orders ADD COLUMN track_token TEXT');
  if (!cols('orders').includes('bill_requested_at')) db.exec('ALTER TABLE orders ADD COLUMN bill_requested_at TEXT');
  db.exec(`UPDATE orders SET code = 'ORD-' || substr(replace(date(created_at), '-', ''), 3) || '-' || printf('%04d', number) WHERE code IS NULL`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_code ON orders(code)');

  // دور "موظف" الجديد: إعادة بناء جدول المستخدمين في القواعد القديمة (قيد CHECK لا يُعدّل في SQLite)
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (!usersSql.includes("'staff'")) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','waiter','kitchen','staff')),
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')))`);
      db.exec('INSERT INTO users_new(id, name, username, password_hash, role, active, created_at) SELECT id, name, username, password_hash, role, active, created_at FROM users');
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  // إعدادات الحضور لكل موظف
  const ecols = cols('employees');
  const addE = (c, def) => { if (!ecols.includes(c)) db.exec(`ALTER TABLE employees ADD COLUMN ${c} ${def}`); };
  addE('grace_minutes', 'INTEGER');                       // null = الإعداد العام
  addE('location_mode', "TEXT NOT NULL DEFAULT 'geo'");   // geo = من المواقع المحددة فقط، anywhere = أي مكان
  addE('location_ids', 'TEXT');                           // JSON؛ null = كل المواقع
  addE('device_binding', 'INTEGER NOT NULL DEFAULT 1');   // ربط الحضور بجهاز واحد
  addE('bound_device', 'TEXT');
  addE('bound_device_at', 'TEXT');
  addE('early_checkin_minutes', 'INTEGER NOT NULL DEFAULT 60');

  // بيانات التحقق لكل سجل حضور
  const acols = cols('attendance');
  const addA = (c, def) => { if (!acols.includes(c)) db.exec(`ALTER TABLE attendance ADD COLUMN ${c} ${def}`); };
  for (const c of ['in_lat', 'in_lng', 'in_accuracy', 'in_distance', 'out_lat', 'out_lng', 'out_accuracy', 'out_distance']) addA(c, 'REAL');
  addA('in_location_id', 'INTEGER');
  addA('out_location_id', 'INTEGER');
  addA('early_leave_minutes', 'INTEGER NOT NULL DEFAULT 0');
  addA('overtime_minutes', 'INTEGER NOT NULL DEFAULT 0');
  addA('device_id', 'TEXT');
  addA('platform', 'TEXT');
  addA('flags', 'TEXT');
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
  online_ordering: '1',          // السماح للزبائن بالطلب من رمز QR الطاولة (يمكن إيقافه في أي وقت)
  qr_require_open: '1',          // لا يُقبل طلب QR إلا بعد أن يفتح النادل الطاولة
  qr_confirm_mode: 'smart',      // تأكيد النادل قبل المطبخ: always / smart (حسب المبلغ وأول طلب للجوال) / never
  qr_allow_bill: '1',            // السماح للزبون بطلب الحساب من هاتفه واختيار طريقة الدفع
  customer_forget_hours: '8',    // مدة احتفاظ جهاز الزبون بآخر طلبه ومحادثته قبل اعتبار الزيارة جديدة (بالساعات)
  qr_confirm_over: '100',        // المبلغ الذي يحتاج ما فوقه تأكيداً (في الوضع smart)
  late_grace_minutes: '10',      // سماحية التأخير بالدقائق
  late_deduction: '1',           // خصم التأخير من الراتب (1/0)
  doc_alert_days: '30',          // التنبيه قبل انتهاء المستندات بأيام
  att_require_location: '1',     // التحقق من الموقع عند وجود مواقع محددة
  att_max_accuracy: '100',       // أقصى خطأ مقبول في دقة الموقع (متر)
  att_allow_web: '1',            // السماح بالتسجيل من المتصفح (الأندرويد أدق وأصعب في التلاعب)
  att_block_mock: '1',           // رفض المواقع الوهمية والمحاكيات والأجهزة المكسورة الحماية
  att_required_before_work: globalThis.process?.env?.ATT_REQUIRED_DEFAULT ?? '1', // تسجيل الحضور إلزامي قبل استخدام النظام
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

/** رمز عشوائي غير قابل للتخمين (96 بت) */
export function randomToken(bytes = 12) {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** يعطي كل طاولة رمز QR خاصاً بها إن لم يكن لها */
export function ensureTableTokens() {
  for (const t of all('SELECT id FROM dining_tables WHERE qr_token IS NULL OR qr_token = \'\'')) {
    run('UPDATE dining_tables SET qr_token = ? WHERE id = ?', randomToken(), t.id);
  }
}
