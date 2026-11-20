-- مخطط قاعدة بيانات نظام إدارة المطعم
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','waiter','kitchen','staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,
  icon   TEXT,
  sort   INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name        TEXT NOT NULL,
  description TEXT,
  details     TEXT,                              -- تفصيل الوجبة (نص أطول يراه الزبون)
  components  TEXT,                              -- JSON: مكونات الوجبة المعروضة للزبون
  price       REAL NOT NULL DEFAULT 0,
  image       TEXT,
  station     TEXT NOT NULL DEFAULT 'kitchen',   -- قسم التحضير: kitchen / grill / drinks / dessert
  available   INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS modifiers (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  price   REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ingredients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'كغ',
  stock         REAL NOT NULL DEFAULT 0,
  min_stock     REAL NOT NULL DEFAULT 0,
  cost_per_unit REAL NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  category      TEXT,                              -- مجموعة المخزن: لحوم، خضار، ألبان، جاف...
  storage       TEXT,                              -- التخزين: مبرد / مجمد / جاف
  par_level     REAL NOT NULL DEFAULT 0,           -- الكمية المستهدفة عند إعادة التعبئة
  supplier_id   INTEGER,                           -- المورد المعتاد
  shelf_life_days INTEGER                          -- مدة الصلاحية الافتراضية عند الاستلام
);

-- الوصفة: كمية كل مادة خام في الصنف
CREATE TABLE IF NOT EXISTS recipes (
  item_id       INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  qty           REAL NOT NULL,
  PRIMARY KEY (item_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  qty           REAL NOT NULL,              -- موجب = وارد، سالب = صادر
  type          TEXT NOT NULL CHECK (type IN ('purchase','sale','waste','adjust','issue','return')),
  unit_cost     REAL,
  note          TEXT,
  order_id      INTEGER,
  user_id       INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  reason        TEXT,                       -- سبب التالف / الصرف
  batch_id      INTEGER,
  receipt_id    INTEGER,
  supplier_id   INTEGER,
  stocktake_id  INTEGER,
  balance_after REAL                        -- الرصيد بعد الحركة (كشف حساب المادة)
);

CREATE TABLE IF NOT EXISTS dining_tables (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,
  seats  INTEGER NOT NULL DEFAULT 4,
  area   TEXT NOT NULL DEFAULT 'الصالة',
  active INTEGER NOT NULL DEFAULT 1,
  qr_token TEXT,                -- رمز QR العشوائي الخاص بالطاولة (يُستخدم في رابط الزبون)
  qr_open_until TEXT,           -- الطاولة مفتوحة لطلب QR حتى هذا الوقت (يفتحها الموظف)
  qr_request_at TEXT,           -- آخر وقت طلب فيه الزبون من الموظف فتح الطاولة
  qr_opened_by  INTEGER,        -- الموظف الذي فتح الطاولة لطلب QR (واستلم طلب الفتح)
  qr_opened_at  TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,
  phone      TEXT UNIQUE,
  address    TEXT,
  pay_method TEXT,                 -- آخر طريقة دفع إلكتروني اختارها العميل (من طلب الحساب)
  pay_phone  TEXT,                 -- رقم المحفظة / جوال بي
  pay_name   TEXT,                 -- اسم الدافع
  points     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  opening_cash   REAL NOT NULL DEFAULT 0,
  closing_cash   REAL,
  expected_cash  REAL,
  notes          TEXT,
  opened_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at      TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  number          INTEGER NOT NULL,             -- رقم الطلب اليومي
  code            TEXT,                         -- كود الطلب الثابت: ORD-YYMMDD-0001
  type            TEXT NOT NULL CHECK (type IN ('dine_in','takeaway','delivery')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  table_id        INTEGER REFERENCES dining_tables(id),
  customer_id     INTEGER REFERENCES customers(id),
  customer_name   TEXT,
  customer_phone  TEXT,
  address         TEXT,
  guests          INTEGER,
  notes           TEXT,
  discount_type   TEXT CHECK (discount_type IN ('amount','percent')),
  discount_value  REAL NOT NULL DEFAULT 0,
  subtotal        REAL NOT NULL DEFAULT 0,
  discount        REAL NOT NULL DEFAULT 0,
  service         REAL NOT NULL DEFAULT 0,
  delivery_fee    REAL NOT NULL DEFAULT 0,
  tax             REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  paid            REAL NOT NULL DEFAULT 0,
  waiter_id       INTEGER REFERENCES users(id),
  cashier_id      INTEGER REFERENCES users(id),
  shift_id        INTEGER REFERENCES shifts(id),
  cancel_reason   TEXT,
  source          TEXT NOT NULL DEFAULT 'staff',   -- staff / online (طلب من رابط الزبون)
  track_token     TEXT,                            -- رمز متابعة الزبون للطلب
  pending_confirm INTEGER NOT NULL DEFAULT 0,      -- طلب QR بانتظار تأكيد الموظف قبل المطبخ
  device_id       TEXT,                            -- معرّف جهاز الزبون (طلب QR)
  bill_method     TEXT,                            -- طريقة الدفع التي اختارها الزبون عند طلب الحساب: cash/wallet/bank/jawwalpay
  bill_name       TEXT,                            -- اسم الدافع
  bill_phone      TEXT,                            -- رقم المحفظة / جوال بي
  event_id        INTEGER,                         -- فعالية/مؤسسة استأجرت المكان (طلب من QR المؤسسة)
  place           TEXT,                            -- المكان/الطاولة التي كتبها موظف المؤسسة
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES menu_items(id),
  name        TEXT NOT NULL,
  price       REAL NOT NULL,           -- سعر الوحدة شامل الإضافات
  qty         INTEGER NOT NULL DEFAULT 1,
  modifiers   TEXT,                    -- JSON
  notes       TEXT,
  station     TEXT NOT NULL DEFAULT 'kitchen',
  -- pending: لم يرسل للمطبخ | new | preparing | ready | served | cancelled
  status      TEXT NOT NULL DEFAULT 'pending',
  sent_at     TEXT,
  sent_by     INTEGER,                 -- من أرسل الصنف للمطبخ
  ready_at    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_status ON order_items(status);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  method     TEXT NOT NULL CHECK (method IN ('cash','card','wallet','bank','jawwalpay')),
  amount     REAL NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  shift_id   INTEGER REFERENCES shifts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  -- التحويلات (محفظة / بنك / جوال بي): بيانات المحوِّل وتدقيق وصول المبلغ للحساب
  reference       TEXT,                     -- رقم العملية / مرجع التحويل
  payer_name      TEXT,
  payer_phone     TEXT,
  verify_status   TEXT,                     -- NULL للنقدي والبطاقة؛ للتحويل: pending / confirmed / mismatch / rejected
  received_amount REAL,                     -- المبلغ الذي وصل فعلاً حسب كشف الحساب
  verified_by     INTEGER REFERENCES users(id),
  verified_at     TEXT,
  verify_note     TEXT
);


CREATE TABLE IF NOT EXISTS reservations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id       INTEGER REFERENCES dining_tables(id),
  customer_name  TEXT NOT NULL,
  phone          TEXT,
  party_size     INTEGER NOT NULL DEFAULT 2,
  reserved_at    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','seated','cancelled','no_show')),
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═════════════ الموارد البشرية ═════════════
CREATE TABLE IF NOT EXISTS employees (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER UNIQUE REFERENCES users(id),  -- حساب الدخول المرتبط (اختياري)
  name              TEXT NOT NULL,
  job_title         TEXT,
  department        TEXT,
  phone             TEXT,
  email             TEXT,
  national_id       TEXT,
  nationality       TEXT,
  birth_date        TEXT,
  address           TEXT,
  hire_date         TEXT,
  contract_end      TEXT,
  basic_salary      REAL NOT NULL DEFAULT 0,
  allowances        REAL NOT NULL DEFAULT 0,
  work_start        TEXT NOT NULL DEFAULT '09:00',
  work_end          TEXT NOT NULL DEFAULT '17:00',
  weekly_off        TEXT NOT NULL DEFAULT '5',          -- أيام الراحة (0=الأحد … 6=السبت)
  annual_leave_days INTEGER NOT NULL DEFAULT 21,
  emergency_contact TEXT,
  bank_iban         TEXT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','terminated')),
  terminated_at     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL DEFAULT 'other',  -- id / passport / health / contract / license / other
  title        TEXT NOT NULL,
  number       TEXT,
  expiry_date  TEXT,
  file_name    TEXT,
  file_type    TEXT,
  file_size    INTEGER,
  file_data    TEXT,                            -- data URL
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  check_in        TEXT,
  check_out       TEXT,
  status          TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','absent','leave')),
  late_minutes    INTEGER NOT NULL DEFAULT 0,
  worked_minutes  INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  source          TEXT NOT NULL DEFAULT 'self',
  created_by      INTEGER,
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);

CREATE TABLE IF NOT EXISTS leaves (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('annual','sick','unpaid','emergency')),
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  days         INTEGER NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by   INTEGER,
  decided_at   TEXT,
  created_by   INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,                   -- YYYY-MM
  type         TEXT NOT NULL CHECK (type IN ('bonus','deduction','advance')),
  amount       REAL NOT NULL,
  note         TEXT,
  created_by   INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ═════════════ تسلسل عمليات الطلب ═════════════
CREATE TABLE IF NOT EXISTS order_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,   -- created / items_added / sent / preparing / ready / served / item_cancelled / discount / moved / payment / paid / cancelled
  message     TEXT,
  data        TEXT,
  user_id     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

-- ═════════════ الإشعارات ═════════════
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,   -- order_new / order_ready / leave_request / leave_decided / low_stock
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  level       TEXT NOT NULL DEFAULT 'info',  -- info / success / warning
  read_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);

-- ═════════════ أجهزة الإشعارات الفورية (Firebase) ═════════════
CREATE TABLE IF NOT EXISTS device_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  platform    TEXT NOT NULL DEFAULT 'android',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  last_seen   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON device_tokens(user_id);

-- ═════════════ صلاحيات الأدوار المخصّصة ═════════════
CREATE TABLE IF NOT EXISTS role_permissions (
  role   TEXT PRIMARY KEY,
  perms  TEXT NOT NULL   -- JSON array
);

-- ═════════════ مواقع تسجيل الحضور ═════════════
CREATE TABLE IF NOT EXISTS work_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  radius_m    INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- محاولات تسجيل الحضور المرفوضة (لكشف التحايل)
CREATE TABLE IF NOT EXISTS attendance_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  user_id      INTEGER,
  action       TEXT NOT NULL,            -- check_in / check_out
  reason       TEXT NOT NULL,            -- رمز السبب
  message      TEXT,
  lat          REAL,
  lng          REAL,
  accuracy     REAL,
  distance     REAL,
  device_id    TEXT,
  platform     TEXT,
  suspicious   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_date ON attendance_attempts(created_at);

-- سجل محاولات طلب QR (للمراقبة والتنبيه)
CREATE TABLE IF NOT EXISTS qr_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ip        TEXT,
  device_id TEXT,
  table_id  INTEGER,
  event     TEXT NOT NULL,
  detail    TEXT
);
CREATE INDEX IF NOT EXISTS idx_qrlog_at ON qr_log(at);

-- إشعارات Web Push للزبون (تصله حتى لو أغلق الصفحة)
CREATE TABLE IF NOT EXISTS web_push_subs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  url        TEXT,                       -- رابط صفحة الزبون ليُفتح عند الضغط على الإشعار
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_wps_order ON web_push_subs(order_id);

-- مفاتيح الخادم (لا تُعرض عبر الإعدادات)
CREATE TABLE IF NOT EXISTS server_keys (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- فعاليات المؤسسات: مؤسسة تستأجر المكان ويطلب موظفوها من قائمة محددة عبر QR خاص بها
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,                    -- اسم المؤسسة / الفعالية
  contact_name   TEXT,
  contact_phone  TEXT,
  starts_at      TEXT NOT NULL,                    -- بداية السماح بالطلب
  ends_at        TEXT NOT NULL,                    -- نهاية السماح بالطلب
  menu_mode      TEXT NOT NULL DEFAULT 'selected' CHECK (menu_mode IN ('full','selected','cap')),
  price_cap      REAL,                             -- (وضع cap) أقصى سعر للصنف الواحد
  order_cap      REAL,                             -- أقصى مجموع للطلب الواحد قبل الضريبة (اختياري)
  billing        TEXT NOT NULL DEFAULT 'institution' CHECK (billing IN ('institution','individual')),
  needs_approval INTEGER NOT NULL DEFAULT 0,       -- يحتاج تأكيد الموظف قبل المطبخ
  places         TEXT,                             -- JSON: قائمة أماكن/طاولات يختار منها الموظف (اختياري)
  notes          TEXT,
  cat_times      TEXT,                             -- JSON: {معرّف القسم: {from, to}} موعد بدء/انتهاء طلب كل قسم (مشروبات، وجبات...)
  welcome_message TEXT,                            -- رسالة ترحيب تظهر عند مسح QR المؤسسة
  support_phone  TEXT,                             -- رقم خدمة العملاء (الافتراضي: رقم المطعم)
  support_chat   INTEGER NOT NULL DEFAULT 1,       -- السماح بمراسلة المطعم من الصفحة
  token          TEXT UNIQUE,
  active         INTEGER NOT NULL DEFAULT 1,
  created_by     INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS event_items (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  item_id  INTEGER NOT NULL REFERENCES menu_items(id),
  PRIMARY KEY (event_id, item_id)
);

-- المصاريف (دفتر المحاسبة): أنواع، قيود، ومصاريف ثابتة متكررة
CREATE TABLE IF NOT EXISTS expense_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL DEFAULT 'operating' CHECK (kind IN ('operating','cogs','capital')),  -- تشغيلي / مشتريات مواد (محتسبة في تكلفة المبيعات) / رأسمالي
  color      TEXT NOT NULL DEFAULT '#64748b',
  icon       TEXT NOT NULL DEFAULT 'receipt',
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_date  TEXT NOT NULL,                    -- YYYY-MM-DD
  category_id   INTEGER NOT NULL REFERENCES expense_categories(id),
  amount        REAL NOT NULL,                    -- الإجمالي المدفوع شاملاً الضريبة
  tax           REAL NOT NULL DEFAULT 0,          -- جزء الضريبة (للاسترداد)
  method        TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank','card','wallet')),
  from_drawer   INTEGER NOT NULL DEFAULT 0,       -- دُفع نقداً من درج الكاشير (يخصم من نقد الوردية)
  shift_id      INTEGER REFERENCES shifts(id),
  vendor        TEXT,
  description   TEXT,
  reference     TEXT,                             -- رقم الفاتورة / السند
  recurring_id  INTEGER,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_exp_cat ON expenses(category_id);
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  category_id  INTEGER NOT NULL REFERENCES expense_categories(id),
  amount       REAL NOT NULL,
  method       TEXT NOT NULL DEFAULT 'bank' CHECK (method IN ('cash','bank','card','wallet')),
  vendor       TEXT,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- محادثة خدمة العملاء: رسائل زبائن المؤسسات (برمز الجهاز) وردود الموظفين
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,
  sender     TEXT NOT NULL CHECK (sender IN ('customer','staff')),
  staff_id   INTEGER,
  name       TEXT,
  body       TEXT NOT NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_chat_thread ON chat_messages(event_id, device_id, id);

-- تخصيص صلاحيات مستخدم بعينه فوق صلاحيات دوره (allow=1 منح، allow=0 سحب)
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  perm    TEXT NOT NULL,
  allow   INTEGER NOT NULL,
  PRIMARY KEY (user_id, perm)
);

-- إشعارات Web Push لمحادثة الزبون (برمز جهازه)، حتى لو لم يكن لديه طلب
CREATE TABLE IF NOT EXISTS chat_push_subs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  url        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cps_dev ON chat_push_subs(event_id, device_id);

-- الموردون ومستندات الاستلام والدفعات (لوطات) بتواريخ الصلاحية، وجلسات الجرد
CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  contact    TEXT,
  notes      TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stock_receipts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  invoice_no  TEXT,
  received_at TEXT NOT NULL,                  -- تاريخ الاستلام
  total       REAL NOT NULL DEFAULT 0,
  note        TEXT,
  user_id     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stock_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  receipt_id    INTEGER REFERENCES stock_receipts(id),
  supplier_id   INTEGER,
  qty_in        REAL NOT NULL,
  qty_left      REAL NOT NULL,
  unit_cost     REAL,
  received_at   TEXT NOT NULL,
  expiry_date   TEXT,                         -- NULL = لا تنتهي صلاحيته
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stocktakes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER,
  note           TEXT,
  items          INTEGER NOT NULL DEFAULT 0,
  shortage_value REAL NOT NULL DEFAULT 0,
  surplus_value  REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
