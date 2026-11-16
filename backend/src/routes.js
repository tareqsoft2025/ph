import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, all, run, tx, getSettings, setSettings, audit } from './db.js';
import { authenticate, allow, signToken, ROLES } from './auth.js';
import { bad, notFound, pick, updateSql, normalize, round2, today } from './util.js';
import * as Orders from './orders.js';
import { hrRoutes } from './hr.js';
import { setNotifyEmitter, notify, pushEnabled } from './notify.js';

/**
 * @param {(event: string, payload?: any) => void} emit إرسال حدث لحظي لكل الأجهزة
 */
export function buildRouter(emit) {
  const r = Router();
  const changed = (...events) => events.forEach((e) => emit(e));
  setNotifyEmitter(emit);

  // ───────────── المصادقة ─────────────
  r.get('/health', (req, res) => res.json({ ok: true, name: getSettings().restaurant_name }));

  r.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = get('SELECT * FROM users WHERE username = ?', String(username || '').trim());
    if (!user || !user.active || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    audit(user.id, 'auth.login');
    res.json({ token: signToken(user), user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  });

  r.use(authenticate);

  r.get('/auth/me', (req, res) => res.json(req.user));

  // ───────────── الإعدادات ─────────────
  r.get('/settings', (req, res) => res.json(getSettings()));
  r.put('/settings', allow('manager'), (req, res) => {
    const s = setSettings(req.body || {});
    audit(req.user.id, 'settings.update');
    changed('settings');
    res.json(s);
  });

  // ───────────── المستخدمون ─────────────
  r.get('/users', allow('manager'), (req, res) => {
    res.json(all('SELECT id, name, username, role, active, created_at FROM users ORDER BY id'));
  });
  r.post('/users', allow(), (req, res) => {
    const { name, username, password, role } = req.body || {};
    if (!name || !username || !password) throw bad('أكمل البيانات');
    if (!ROLES.includes(role)) throw bad('الدور غير صحيح');
    if (String(password).length < 4) throw bad('كلمة المرور قصيرة (4 أحرف على الأقل)');
    if (get('SELECT id FROM users WHERE username = ?', username)) throw bad('اسم المستخدم مستخدم مسبقاً');
    const info = run('INSERT INTO users(name, username, password_hash, role) VALUES(?,?,?,?)',
      name, username.trim(), bcrypt.hashSync(password, 10), role);
    audit(req.user.id, 'user.create', 'user', Number(info.lastInsertRowid));
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/users/:id', allow(), (req, res) => {
    const id = Number(req.params.id);
    const fields = pick(req.body, ['name', 'role', 'active']);
    if (fields.role && !ROLES.includes(fields.role)) throw bad('الدور غير صحيح');
    if (id === req.user.id && (fields.active === false || fields.active === 0 || (fields.role && fields.role !== 'admin'))) {
      throw bad('لا يمكنك تعطيل حسابك أو تغيير دورك');
    }
    if (req.body.password) {
      if (String(req.body.password).length < 4) throw bad('كلمة المرور قصيرة');
      fields.password_hash = bcrypt.hashSync(req.body.password, 10);
    }
    const u = updateSql('users', fields, id);
    if (u) run(u.sql, ...u.params);
    audit(req.user.id, 'user.update', 'user', id);
    res.json({ ok: true });
  });

  // ───────────── قائمة الطعام ─────────────
  r.get('/menu', (req, res) => {
    const categories = all('SELECT * FROM categories WHERE active = 1 ORDER BY sort, id');
    const items = all('SELECT * FROM menu_items WHERE active = 1 ORDER BY sort, id');
    const mods = all('SELECT * FROM modifiers ORDER BY id');
    for (const it of items) it.modifiers = mods.filter((m) => m.item_id === it.id);
    res.json({ categories, items });
  });

  r.post('/categories', allow('manager'), (req, res) => {
    const { name, icon, sort } = req.body || {};
    if (!name) throw bad('أدخل اسم الفئة');
    const info = run('INSERT INTO categories(name, icon, sort) VALUES(?,?,?)', name, icon || null, sort || 0);
    changed('menu');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/categories/:id', allow('manager'), (req, res) => {
    const u = updateSql('categories', pick(req.body, ['name', 'icon', 'sort']), Number(req.params.id));
    if (u) run(u.sql, ...u.params);
    changed('menu');
    res.json({ ok: true });
  });
  r.delete('/categories/:id', allow('manager'), (req, res) => {
    const id = Number(req.params.id);
    const { c } = get('SELECT COUNT(*) AS c FROM menu_items WHERE category_id = ? AND active = 1', id);
    if (c) throw bad('الفئة تحتوي أصنافاً، انقلها أو احذفها أولاً');
    run('UPDATE categories SET active = 0 WHERE id = ?', id);
    changed('menu');
    res.json({ ok: true });
  });

  r.get('/items/:id', allow('manager'), (req, res) => {
    const item = get('SELECT * FROM menu_items WHERE id = ?', Number(req.params.id));
    if (!item) throw notFound();
    item.modifiers = all('SELECT * FROM modifiers WHERE item_id = ?', item.id);
    item.recipe = all(`SELECT r.ingredient_id, r.qty, i.name, i.unit, i.cost_per_unit
      FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.item_id = ?`, item.id);
    item.cost = round2(item.recipe.reduce((a, x) => a + x.qty * x.cost_per_unit, 0));
    res.json(item);
  });

  const ITEM_FIELDS = ['category_id', 'name', 'description', 'price', 'image', 'station', 'available', 'sort'];
  function saveItemChildren(itemId, body) {
    if (Array.isArray(body.modifiers)) {
      run('DELETE FROM modifiers WHERE item_id = ?', itemId);
      for (const m of body.modifiers) if (m.name) run('INSERT INTO modifiers(item_id, name, price) VALUES(?,?,?)', itemId, m.name, Number(m.price) || 0);
    }
    if (Array.isArray(body.recipe)) {
      run('DELETE FROM recipes WHERE item_id = ?', itemId);
      for (const x of body.recipe) if (x.ingredient_id && Number(x.qty) > 0) {
        run('INSERT INTO recipes(item_id, ingredient_id, qty) VALUES(?,?,?)', itemId, x.ingredient_id, Number(x.qty));
      }
    }
  }
  r.post('/items', allow('manager'), (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.category_id) throw bad('أدخل الاسم والفئة');
    const id = tx(() => {
      const info = run('INSERT INTO menu_items(category_id, name, description, price, image, station, available, sort) VALUES(?,?,?,?,?,?,?,?)',
        b.category_id, b.name, b.description || null, Number(b.price) || 0, b.image || null, b.station || 'kitchen', b.available === false ? 0 : 1, b.sort || 0);
      const newId = Number(info.lastInsertRowid);
      saveItemChildren(newId, b);
      return newId;
    });
    audit(req.user.id, 'item.create', 'item', id);
    changed('menu');
    res.status(201).json({ id });
  });
  r.put('/items/:id', allow('manager'), (req, res) => {
    const id = Number(req.params.id);
    const before = get('SELECT price FROM menu_items WHERE id = ?', id);
    if (!before) throw notFound();
    tx(() => {
      const u = updateSql('menu_items', pick(req.body, ITEM_FIELDS), id);
      if (u) run(u.sql, ...u.params);
      saveItemChildren(id, req.body || {});
    });
    if (req.body.price !== undefined && Number(req.body.price) !== before.price) {
      audit(req.user.id, 'item.price_change', 'item', id, { from: before.price, to: Number(req.body.price) });
    }
    changed('menu');
    res.json({ ok: true });
  });
  // تفعيل/إيقاف الصنف سريعاً (مسموح للمطبخ أيضاً عند نفاد صنف)
  r.patch('/items/:id/availability', allow('manager', 'kitchen', 'cashier'), (req, res) => {
    run('UPDATE menu_items SET available = ? WHERE id = ?', req.body.available ? 1 : 0, Number(req.params.id));
    changed('menu');
    res.json({ ok: true });
  });
  r.delete('/items/:id', allow('manager'), (req, res) => {
    run('UPDATE menu_items SET active = 0 WHERE id = ?', Number(req.params.id));
    audit(req.user.id, 'item.delete', 'item', Number(req.params.id));
    changed('menu');
    res.json({ ok: true });
  });

  // ───────────── الطاولات ─────────────
  r.get('/tables', (req, res) => {
    const tables = all(`
      SELECT t.*, o.id AS order_id, o.number AS order_number, o.code AS order_code, o.total AS order_total, o.created_at AS opened_at,
        o.guests, w.name AS waiter_name,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'ready') AS ready_items,
        (SELECT r.customer_name || ' ' || substr(r.reserved_at, 12, 5) FROM reservations r
          WHERE r.table_id = t.id AND r.status = 'booked' AND date(r.reserved_at) = date('now','localtime')
          ORDER BY r.reserved_at LIMIT 1) AS reservation
      FROM dining_tables t
      LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
      LEFT JOIN users w ON w.id = o.waiter_id
      WHERE t.active = 1 ORDER BY t.area, t.id`);
    res.json(tables.map((t) => ({ ...t, status: t.order_id ? 'occupied' : t.reservation ? 'reserved' : 'free' })));
  });
  r.post('/tables', allow('manager'), (req, res) => {
    const { name, seats, area } = req.body || {};
    if (!name) throw bad('أدخل اسم الطاولة');
    const info = run('INSERT INTO dining_tables(name, seats, area) VALUES(?,?,?)', name, Number(seats) || 4, area || 'الصالة');
    changed('tables');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/tables/:id', allow('manager'), (req, res) => {
    const u = updateSql('dining_tables', pick(req.body, ['name', 'seats', 'area']), Number(req.params.id));
    if (u) run(u.sql, ...u.params);
    changed('tables');
    res.json({ ok: true });
  });
  r.delete('/tables/:id', allow('manager'), (req, res) => {
    const id = Number(req.params.id);
    if (get("SELECT id FROM orders WHERE table_id = ? AND status = 'open'", id)) throw bad('الطاولة عليها طلب مفتوح');
    run('UPDATE dining_tables SET active = 0 WHERE id = ?', id);
    changed('tables');
    res.json({ ok: true });
  });

  // ───────────── الطلبات ─────────────
  r.get('/orders', (req, res) => {
    const { status, type, date, from, to } = req.query;
    const where = [];
    const params = [];
    if (status) { where.push('o.status = ?'); params.push(status); }
    if (type) { where.push('o.type = ?'); params.push(type); }
    if (date) { where.push('date(o.created_at) = ?'); params.push(date); }
    if (from) { where.push('date(o.created_at) >= ?'); params.push(from); }
    if (to) { where.push('date(o.created_at) <= ?'); params.push(to); }
    if (req.user.role === 'waiter' && !status) { where.push("o.status = 'open'"); }
    const rows = all(`
      SELECT o.*, t.name AS table_name, w.name AS waiter_name,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status != 'cancelled') AS items_count,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'ready') AS ready_items,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'pending') AS pending_items
      FROM orders o
      LEFT JOIN dining_tables t ON t.id = o.table_id
      LEFT JOIN users w ON w.id = o.waiter_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY o.id DESC LIMIT 300`, ...params);
    res.json(rows);
  });

  r.get('/orders/:id', (req, res) => res.json(Orders.getOrder(Number(req.params.id))));

  const orderChanged = (id) => {
    changed('orders', 'tables');
    return Orders.getOrder(id);
  };

  r.post('/orders', allow('cashier', 'waiter', 'manager'), (req, res) => {
    const id = Orders.createOrder(req.body || {}, req.user);
    if (req.body?.send) { Orders.sendToKitchen(id, req.user); changed('kitchen'); }
    res.status(201).json(orderChanged(id));
  });
  r.post('/orders/:id/items', allow('cashier', 'waiter', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    Orders.addItems(id, req.body?.items, req.user);
    if (req.body?.send) { Orders.sendToKitchen(id, req.user); changed('kitchen'); }
    res.json(orderChanged(id));
  });
  r.patch('/orders/:id/items/:lineId', allow('cashier', 'waiter', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    Orders.updateItem(id, Number(req.params.lineId), req.body || {}, req.user);
    changed('kitchen');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/send', allow('cashier', 'waiter', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    const count = Orders.sendToKitchen(id, req.user);
    if (count) changed('kitchen');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/serve', allow('cashier', 'waiter', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    const ch = run("UPDATE order_items SET status = 'served' WHERE order_id = ? AND status = 'ready'", id);
    Orders.kitchenProgress(id, 'served', req.user, Number(ch.changes));
    changed('kitchen');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/discount', allow('cashier', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    Orders.setDiscount(id, req.body || {}, req.user);
    res.json(orderChanged(id));
  });
  r.put('/orders/:id', allow('cashier', 'waiter', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    const o = get('SELECT status FROM orders WHERE id = ?', id);
    if (!o) throw notFound();
    if (o.status !== 'open') throw bad('الطلب مغلق');
    const u = updateSql('orders', pick(req.body, ['customer_name', 'customer_phone', 'address', 'guests', 'notes']), id);
    if (u) run(u.sql, ...u.params);
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/pay', allow('cashier', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    const result = Orders.pay(id, req.body?.payments, req.user);
    if (result.closed) changed('inventory', 'kitchen');
    res.json({ ...result, order: orderChanged(id) });
  });
  r.post('/orders/:id/cancel', allow('cashier', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    Orders.cancelOrder(id, req.body?.reason, req.user);
    changed('kitchen');
    res.json(orderChanged(id));
  });
  r.post('/orders/:id/move', allow('cashier', 'waiter', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    Orders.moveTable(id, Number(req.body?.table_id), req.user);
    res.json(orderChanged(id));
  });

  // ───────────── شاشة المطبخ ─────────────
  r.get('/kitchen', allow('kitchen', 'manager', 'cashier', 'waiter'), (req, res) => {
    const { station } = req.query;
    const items = all(`
      SELECT oi.*, o.number, o.code, o.type, o.guests, o.customer_name, o.notes AS order_notes, t.name AS table_name,
        w.name AS waiter_name, sb.name AS sent_by_name, sb.role AS sent_by_role
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN dining_tables t ON t.id = o.table_id
      LEFT JOIN users w ON w.id = o.waiter_id
      LEFT JOIN users sb ON sb.id = oi.sent_by
      WHERE oi.status IN ('new','preparing','ready') AND o.status != 'cancelled'
      ${station ? 'AND oi.station = ?' : ''}
      ORDER BY oi.sent_at, oi.id`, ...(station ? [station] : []));
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.order_id)) {
        map.set(it.order_id, {
          order_id: it.order_id, number: it.number, code: it.code, type: it.type, table_name: it.table_name,
          guests: it.guests, customer_name: it.customer_name,
          waiter_name: it.waiter_name, sent_by_name: it.sent_by_name || it.waiter_name, sent_by_role: it.sent_by_role,
          notes: it.order_notes, sent_at: it.sent_at, items: [],
        });
      }
      map.get(it.order_id).items.push({
        id: it.id, name: it.name, qty: it.qty, notes: it.notes, status: it.status, station: it.station,
        modifiers: it.modifiers ? JSON.parse(it.modifiers) : [], sent_at: it.sent_at, sent_by_name: it.sent_by_name,
      });
    }
    const orders = [...map.values()];
    // حالة التذكرة = أقل حالة بين أصنافها
    for (const o of orders) {
      o.stage = o.items.some((i) => i.status === 'new') ? 'new' : o.items.some((i) => i.status === 'preparing') ? 'preparing' : 'ready';
    }
    res.json(orders);
  });
  r.patch('/kitchen/items/:id', allow('kitchen', 'manager'), (req, res) => {
    const { status } = req.body || {};
    if (!['new', 'preparing', 'ready', 'served'].includes(status)) throw bad('الحالة غير صحيحة');
    const item = get('SELECT order_id, status FROM order_items WHERE id = ?', Number(req.params.id));
    if (!item) throw notFound();
    run(`UPDATE order_items SET status = ?, ready_at = CASE WHEN ? = 'ready' THEN datetime('now','localtime') ELSE ready_at END WHERE id = ?`,
      status, status, Number(req.params.id));
    if (status !== 'new') Orders.kitchenProgress(item.order_id, status, req.user, item.status !== status);
    changed('kitchen', 'orders', 'tables');
    res.json({ ok: true });
  });
  r.post('/kitchen/orders/:id/bump', allow('kitchen', 'manager'), (req, res) => {
    const { status = 'ready' } = req.body || {};
    if (!['preparing', 'ready', 'served'].includes(status)) throw bad('الحالة غير صحيحة');
    const from = { preparing: "('new')", ready: "('new','preparing')", served: "('ready')" }[status];
    const id = Number(req.params.id);
    const ch = run(`UPDATE order_items SET status = ?, ready_at = CASE WHEN ? = 'ready' THEN datetime('now','localtime') ELSE ready_at END
      WHERE order_id = ? AND status IN ${from}`, status, status, id);
    Orders.kitchenProgress(id, status, req.user, Number(ch.changes));
    changed('kitchen', 'orders', 'tables');
    res.json({ ok: true });
  });

  // ───────────── المخزون ─────────────
  r.get('/ingredients', allow('manager', 'kitchen'), (req, res) => {
    res.json(all('SELECT *, (stock <= min_stock) AS low FROM ingredients WHERE active = 1 ORDER BY name'));
  });
  r.post('/ingredients', allow('manager'), (req, res) => {
    const b = req.body || {};
    if (!b.name) throw bad('أدخل اسم المادة');
    const info = run('INSERT INTO ingredients(name, unit, stock, min_stock, cost_per_unit) VALUES(?,?,?,?,?)',
      b.name, b.unit || 'كغ', Number(b.stock) || 0, Number(b.min_stock) || 0, Number(b.cost_per_unit) || 0);
    changed('inventory');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/ingredients/:id', allow('manager'), (req, res) => {
    const u = updateSql('ingredients', pick(req.body, ['name', 'unit', 'min_stock', 'cost_per_unit']), Number(req.params.id));
    if (u) run(u.sql, ...u.params);
    changed('inventory');
    res.json({ ok: true });
  });
  r.delete('/ingredients/:id', allow('manager'), (req, res) => {
    run('UPDATE ingredients SET active = 0 WHERE id = ?', Number(req.params.id));
    changed('inventory');
    res.json({ ok: true });
  });
  // حركة مخزون: شراء / تالف / تسوية جرد
  r.post('/stock-movements', allow('manager', 'kitchen'), (req, res) => {
    const { ingredient_id, qty, type, unit_cost, note } = req.body || {};
    const ing = get('SELECT * FROM ingredients WHERE id = ?', ingredient_id);
    if (!ing) throw notFound('المادة غير موجودة');
    if (!['purchase', 'waste', 'adjust'].includes(type)) throw bad('نوع الحركة غير صحيح');
    let delta = Number(qty);
    if (!Number.isFinite(delta)) throw bad('الكمية غير صحيحة');
    if (type === 'purchase' && delta <= 0) throw bad('كمية الشراء يجب أن تكون موجبة');
    if (type === 'waste') delta = -Math.abs(delta);
    if (type === 'adjust') delta = delta - ing.stock; // qty = الكمية الفعلية بعد الجرد
    tx(() => {
      run('UPDATE ingredients SET stock = stock + ? WHERE id = ?', delta, ing.id);
      if (type === 'purchase' && Number(unit_cost) > 0) {
        // متوسط التكلفة المرجّح
        const newStock = ing.stock + delta;
        const avg = newStock > 0 ? (Math.max(ing.stock, 0) * ing.cost_per_unit + delta * Number(unit_cost)) / (Math.max(ing.stock, 0) + delta) : Number(unit_cost);
        run('UPDATE ingredients SET cost_per_unit = ? WHERE id = ?', round2(avg * 1000) / 1000, ing.id);
      }
      run('INSERT INTO stock_movements(ingredient_id, qty, type, unit_cost, note, user_id) VALUES(?,?,?,?,?,?)',
        ing.id, delta, type, unit_cost ? Number(unit_cost) : null, note || null, req.user.id);
    });
    changed('inventory');
    res.status(201).json({ ok: true });
  });
  r.get('/stock-movements', allow('manager'), (req, res) => {
    const { ingredient_id } = req.query;
    res.json(all(`SELECT m.*, i.name AS ingredient_name, i.unit, u.name AS user_name
      FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id LEFT JOIN users u ON u.id = m.user_id
      ${ingredient_id ? 'WHERE m.ingredient_id = ?' : ''} ORDER BY m.id DESC LIMIT 300`, ...(ingredient_id ? [Number(ingredient_id)] : [])));
  });

  // ───────────── الورديات ─────────────
  function shiftSummary(shift) {
    const pays = all('SELECT method, SUM(amount) AS total, COUNT(*) AS count FROM payments WHERE shift_id = ? GROUP BY method', shift.id);
    const cash = pays.find((p) => p.method === 'cash')?.total || 0;
    const orders = get("SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS s FROM orders WHERE shift_id = ? AND status = 'paid'", shift.id);
    return { ...shift, payments: pays, orders_count: orders.c, sales: round2(orders.s), expected_cash: round2(shift.opening_cash + cash) };
  }
  r.get('/shifts/current', (req, res) => {
    const s = get('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE closed_at IS NULL ORDER BY s.id DESC LIMIT 1');
    res.json(s ? shiftSummary(s) : null);
  });
  r.get('/shifts', allow('manager'), (req, res) => {
    res.json(all('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 100'));
  });
  r.post('/shifts/open', allow('cashier', 'manager'), (req, res) => {
    if (get('SELECT id FROM shifts WHERE closed_at IS NULL')) throw bad('توجد وردية مفتوحة بالفعل');
    const info = run('INSERT INTO shifts(user_id, opening_cash) VALUES(?,?)', req.user.id, Number(req.body?.opening_cash) || 0);
    audit(req.user.id, 'shift.open', 'shift', Number(info.lastInsertRowid));
    changed('shift');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.post('/shifts/close', allow('cashier', 'manager'), (req, res) => {
    const s = get('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
    if (!s) throw bad('لا توجد وردية مفتوحة');
    const summary = shiftSummary(s);
    const closing = Number(req.body?.closing_cash) || 0;
    run("UPDATE shifts SET closing_cash = ?, expected_cash = ?, notes = ?, closed_at = datetime('now','localtime') WHERE id = ?",
      closing, summary.expected_cash, req.body?.notes || null, s.id);
    audit(req.user.id, 'shift.close', 'shift', s.id, { closing, expected: summary.expected_cash });
    changed('shift');
    res.json({ ...summary, closing_cash: closing, difference: round2(closing - summary.expected_cash) });
  });

  // ───────────── الحجوزات ─────────────
  r.get('/reservations', (req, res) => {
    const date = req.query.date || today();
    res.json(all(`SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN dining_tables t ON t.id = r.table_id
      WHERE date(r.reserved_at) = ? ORDER BY r.reserved_at`, date));
  });
  r.post('/reservations', allow('cashier', 'waiter', 'manager'), (req, res) => {
    const b = req.body || {};
    if (!b.customer_name || !b.reserved_at) throw bad('أدخل اسم العميل ووقت الحجز');
    const info = run('INSERT INTO reservations(table_id, customer_name, phone, party_size, reserved_at, notes) VALUES(?,?,?,?,?,?)',
      b.table_id || null, b.customer_name, b.phone || null, Number(b.party_size) || 2, String(b.reserved_at).replace('T', ' '), b.notes || null);
    changed('tables', 'reservations');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/reservations/:id', allow('cashier', 'waiter', 'manager'), (req, res) => {
    const fields = pick(req.body, ['table_id', 'customer_name', 'phone', 'party_size', 'reserved_at', 'status', 'notes']);
    if (fields.reserved_at) fields.reserved_at = String(fields.reserved_at).replace('T', ' ');
    if (fields.status && !['booked', 'seated', 'cancelled', 'no_show'].includes(fields.status)) throw bad('الحالة غير صحيحة');
    const u = updateSql('reservations', fields, Number(req.params.id));
    if (u) run(u.sql, ...u.params);
    changed('tables', 'reservations');
    res.json({ ok: true });
  });

  // ───────────── العملاء ─────────────
  r.get('/customers', (req, res) => {
    const q = req.query.q ? `%${req.query.q}%` : null;
    res.json(all(`SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status='paid') AS orders_count,
      (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.customer_id = c.id AND o.status='paid') AS total_spent
      FROM customers c ${q ? 'WHERE c.phone LIKE ? OR c.name LIKE ?' : ''} ORDER BY c.id DESC LIMIT 100`, ...(q ? [q, q] : [])));
  });

  // ───────────── التقارير ─────────────
  r.get('/reports/summary', allow('manager'), (req, res) => {
    const from = req.query.from || today();
    const to = req.query.to || from;
    const range = "date(o.created_at) BETWEEN ? AND ?";
    const paid = `o.status = 'paid' AND ${range}`;
    const totals = get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(tax),0) AS tax,
      COALESCE(SUM(discount),0) AS discounts, COALESCE(SUM(service),0) AS service, COALESCE(AVG(total),0) AS avg_ticket
      FROM orders o WHERE ${paid}`, from, to);
    const cancelled = get(`SELECT COUNT(*) AS c FROM orders o WHERE o.status = 'cancelled' AND ${range}`, from, to).c;
    const byPayment = all(`SELECT p.method, SUM(p.amount) AS total FROM payments p JOIN orders o ON o.id = p.order_id
      WHERE ${paid} GROUP BY p.method`, from, to);
    const byType = all(`SELECT type, COUNT(*) AS orders, SUM(total) AS total FROM orders o WHERE ${paid} GROUP BY type`, from, to);
    const topItems = all(`SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price) AS total
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE ${paid} AND oi.status != 'cancelled' GROUP BY oi.item_id ORDER BY qty DESC LIMIT 10`, from, to);
    const byCategory = all(`SELECT c.name, SUM(oi.qty * oi.price) AS total, SUM(oi.qty) AS qty
      FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN menu_items m ON m.id = oi.item_id JOIN categories c ON c.id = m.category_id
      WHERE ${paid} AND oi.status != 'cancelled' GROUP BY c.id ORDER BY total DESC`, from, to);
    const byHour = all(`SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS hour, COUNT(*) AS orders, SUM(total) AS total
      FROM orders o WHERE ${paid} GROUP BY hour ORDER BY hour`, from, to);
    const byDay = all(`SELECT date(o.created_at) AS day, COUNT(*) AS orders, SUM(total) AS total
      FROM orders o WHERE ${paid} GROUP BY day ORDER BY day`, from, to);
    const byStaff = all(`SELECT u.name, COUNT(*) AS orders, SUM(o.total) AS total
      FROM orders o JOIN users u ON u.id = o.waiter_id WHERE ${paid} GROUP BY u.id ORDER BY total DESC`, from, to);
    const cogs = get(`SELECT COALESCE(SUM(-m.qty * i.cost_per_unit),0) AS v FROM stock_movements m
      JOIN ingredients i ON i.id = m.ingredient_id JOIN orders o ON o.id = m.order_id
      WHERE m.type = 'sale' AND ${paid}`, from, to).v;
    const waste = get(`SELECT COALESCE(SUM(-m.qty * i.cost_per_unit),0) AS v FROM stock_movements m
      JOIN ingredients i ON i.id = m.ingredient_id WHERE m.type = 'waste' AND date(m.created_at) BETWEEN ? AND ?`, from, to).v;
    const lowStock = all('SELECT id, name, unit, stock, min_stock FROM ingredients WHERE active = 1 AND stock <= min_stock ORDER BY name');
    const netSales = totals.sales - totals.tax;
    res.json({
      from, to,
      totals: { ...mapRound(totals), cancelled, cogs: round2(cogs), waste: round2(waste), net_sales: round2(netSales), gross_profit: round2(netSales - cogs) },
      byPayment: byPayment.map(mapRound), byType: byType.map(mapRound), topItems: topItems.map(mapRound),
      byCategory: byCategory.map(mapRound), byHour: byHour.map(mapRound), byDay: byDay.map(mapRound), byStaff: byStaff.map(mapRound),
      lowStock,
    });
  });

  // ───────────── الموارد البشرية ─────────────
  hrRoutes(r, changed);

  // ───────────── الإشعارات ─────────────
  r.get('/notifications', (req, res) => {
    const rows = all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
    const unread = get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).c;
    res.json({ rows, unread });
  });
  r.post('/notifications/read', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
    if (ids?.length) {
      run(`UPDATE notifications SET read_at = datetime('now','localtime') WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, req.user.id, ...ids);
    } else {
      run("UPDATE notifications SET read_at = datetime('now','localtime') WHERE user_id = ? AND read_at IS NULL", req.user.id);
    }
    res.json({ ok: true });
  });
  r.delete('/notifications', (req, res) => {
    run('DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL', req.user.id);
    res.json({ ok: true });
  });

  // ───────────── الإشعارات الفورية (أجهزة الأندرويد) ─────────────
  r.get('/push/status', (req, res) => {
    const devices = get('SELECT COUNT(*) AS c FROM device_tokens WHERE user_id = ?', req.user.id).c;
    res.json({ enabled: pushEnabled(), devices });
  });
  r.post('/push/register', (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (token.length < 20 || token.length > 4096) throw bad('رمز الجهاز غير صحيح');
    const platform = ['android', 'ios', 'web'].includes(req.body?.platform) ? req.body.platform : 'android';
    run(`INSERT INTO device_tokens(user_id, token, platform) VALUES(?,?,?)
      ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen = datetime('now','localtime')`,
    req.user.id, token, platform);
    res.json({ ok: true, enabled: pushEnabled() });
  });
  r.post('/push/unregister', (req, res) => {
    run('DELETE FROM device_tokens WHERE token = ? AND user_id = ?', String(req.body?.token || ''), req.user.id);
    res.json({ ok: true });
  });
  r.post('/push/test', (req, res) => {
    notify({ userIds: [req.user.id], type: 'test', level: 'success', link: '/settings', title: 'إشعار تجريبي', body: 'الإشعارات تعمل على هذا الجهاز ✓' });
    res.json({ ok: true, enabled: pushEnabled() });
  });

  r.get('/audit', allow(), (req, res) => {
    res.json(all(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 300`));
  });

  return r;
}

function mapRound(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'number' && !Number.isInteger(v) ? round2(v) : normalize(v);
  return out;
}
