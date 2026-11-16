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
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','waiter','kitchen')),
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
  active        INTEGER NOT NULL DEFAULT 1
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
  qty           REAL NOT NULL,              -- موجب = إضافة، سالب = خصم
  type          TEXT NOT NULL CHECK (type IN ('purchase','sale','waste','adjust')),
  unit_cost     REAL,
  note          TEXT,
  order_id      INTEGER,
  user_id       INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS dining_tables (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,
  seats  INTEGER NOT NULL DEFAULT 4,
  area   TEXT NOT NULL DEFAULT 'الصالة',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,
  phone      TEXT UNIQUE,
  address    TEXT,
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
  ready_at    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_status ON order_items(status);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  method     TEXT NOT NULL CHECK (method IN ('cash','card','wallet')),
  amount     REAL NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  shift_id   INTEGER REFERENCES shifts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
