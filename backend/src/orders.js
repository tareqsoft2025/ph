// منطق الطلبات: الحساب، الإضافة، الإرسال للمطبخ، الدفع
import { get, all, run, tx, getSettings, audit } from './db.js';
import { bad, notFound, round2 } from './util.js';

export function getOrder(id) {
  const order = get(`
    SELECT o.*, t.name AS table_name, w.name AS waiter_name, c.name AS cashier_name
    FROM orders o
    LEFT JOIN dining_tables t ON t.id = o.table_id
    LEFT JOIN users w ON w.id = o.waiter_id
    LEFT JOIN users c ON c.id = o.cashier_id
    WHERE o.id = ?`, id);
  if (!order) throw notFound('الطلب غير موجود');
  order.items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', id).map((i) => ({
    ...i,
    modifiers: i.modifiers ? JSON.parse(i.modifiers) : [],
  }));
  order.payments = all('SELECT * FROM payments WHERE order_id = ? ORDER BY id', id);
  order.remaining = round2(order.total - order.paid);
  return order;
}

/** يعيد حساب إجماليات الطلب ويحفظها */
export function recalc(orderId) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  const s = getSettings();
  const taxRate = Number(s.tax_rate) / 100;
  const serviceRate = Number(s.service_rate) / 100;
  const inclusive = s.tax_inclusive === '1';

  const { sum } = get(
    "SELECT COALESCE(SUM(price * qty), 0) AS sum FROM order_items WHERE order_id = ? AND status != 'cancelled'",
    orderId,
  );
  const gross = round2(sum);
  let discount = 0;
  if (order.discount_type === 'percent') discount = round2(gross * Math.min(order.discount_value, 100) / 100);
  else if (order.discount_type === 'amount') discount = round2(Math.min(order.discount_value, gross));

  const afterDiscount = gross - discount;
  const service = order.type === 'dine_in' ? round2(afterDiscount * serviceRate) : 0;
  const deliveryFee = order.type === 'delivery' ? round2(Number(s.delivery_fee) || 0) : 0;

  let subtotal, tax, total;
  if (inclusive) {
    total = round2(afterDiscount + service + deliveryFee);
    tax = round2(total - total / (1 + taxRate));
    subtotal = gross;
  } else {
    tax = round2((afterDiscount + service + deliveryFee) * taxRate);
    subtotal = gross;
    total = round2(afterDiscount + service + deliveryFee + tax);
  }

  run('UPDATE orders SET subtotal=?, discount=?, service=?, delivery_fee=?, tax=?, total=? WHERE id=?',
    subtotal, discount, service, deliveryFee, tax, total, orderId);
}

function nextOrderNumber() {
  const r = get("SELECT COALESCE(MAX(number),0) + 1 AS n FROM orders WHERE date(created_at) = date('now','localtime')");
  return r.n;
}

function assertOpen(order) {
  if (!order) throw notFound('الطلب غير موجود');
  if (order.status !== 'open') throw bad('الطلب مغلق ولا يمكن تعديله');
}

export function createOrder(data, user) {
  const type = data.type || 'dine_in';
  if (!['dine_in', 'takeaway', 'delivery'].includes(type)) throw bad('نوع الطلب غير صحيح');
  if (type === 'dine_in') {
    if (!data.table_id) throw bad('اختر الطاولة');
    const busy = get("SELECT id FROM orders WHERE table_id = ? AND status = 'open'", data.table_id);
    if (busy) throw bad('الطاولة مشغولة بطلب مفتوح');
  }
  if (type === 'delivery' && (!data.customer_phone || !data.address)) throw bad('أدخل رقم الهاتف والعنوان للتوصيل');

  return tx(() => {
    let customerId = null;
    if (data.customer_phone) {
      const existing = get('SELECT id FROM customers WHERE phone = ?', data.customer_phone);
      if (existing) {
        customerId = existing.id;
        run('UPDATE customers SET name = COALESCE(?, name), address = COALESCE(?, address) WHERE id = ?',
          data.customer_name || null, data.address || null, customerId);
      } else {
        customerId = Number(run('INSERT INTO customers(name, phone, address) VALUES(?,?,?)',
          data.customer_name || null, data.customer_phone, data.address || null).lastInsertRowid);
      }
    }
    const shift = get('SELECT id FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
    const info = run(`INSERT INTO orders(number, type, table_id, customer_id, customer_name, customer_phone, address, guests, notes, waiter_id, shift_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      nextOrderNumber(), type, type === 'dine_in' ? data.table_id : null, customerId,
      data.customer_name || null, data.customer_phone || null, data.address || null,
      data.guests || null, data.notes || null, user.id, shift?.id ?? null);
    const id = Number(info.lastInsertRowid);
    if (Array.isArray(data.items)) for (const it of data.items) insertItem(id, it);
    recalc(id);
    audit(user.id, 'order.create', 'order', id, { type });
    return id;
  });
}

function insertItem(orderId, it) {
  const item = get('SELECT * FROM menu_items WHERE id = ? AND active = 1', it.item_id);
  if (!item) throw bad('الصنف غير موجود');
  if (!item.available) throw bad(`الصنف "${item.name}" غير متوفر حالياً`);
  const qty = Math.max(1, parseInt(it.qty, 10) || 1);
  let mods = [];
  if (Array.isArray(it.modifier_ids) && it.modifier_ids.length) {
    mods = all(
      `SELECT id, name, price FROM modifiers WHERE item_id = ? AND id IN (${it.modifier_ids.map(() => '?').join(',')})`,
      item.id, ...it.modifier_ids.map(Number),
    );
  }
  const unit = round2(item.price + mods.reduce((a, m) => a + m.price, 0));
  run('INSERT INTO order_items(order_id, item_id, name, price, qty, modifiers, notes, station) VALUES(?,?,?,?,?,?,?,?)',
    orderId, item.id, item.name, unit, qty, mods.length ? JSON.stringify(mods) : null, it.notes || null, item.station);
}

export function addItems(orderId, items, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  if (!Array.isArray(items) || !items.length) throw bad('لا توجد أصناف');
  tx(() => {
    for (const it of items) insertItem(orderId, it);
    recalc(orderId);
  });
  audit(user.id, 'order.add_items', 'order', orderId, { count: items.length });
}

export function updateItem(orderId, lineId, data, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  const line = get('SELECT * FROM order_items WHERE id = ? AND order_id = ?', lineId, orderId);
  if (!line) throw notFound('السطر غير موجود');
  const sent = line.status !== 'pending';

  if (data.cancel) {
    if (sent && !['admin', 'manager', 'cashier'].includes(user.role)) throw bad('إلغاء صنف أُرسل للمطبخ يحتاج صلاحية الكاشير أو المدير');
    if (sent) run("UPDATE order_items SET status = 'cancelled' WHERE id = ?", lineId);
    else run('DELETE FROM order_items WHERE id = ?', lineId);
    audit(user.id, 'order.cancel_item', 'order', orderId, { line: lineId, name: line.name, qty: line.qty, sent });
  } else {
    if (sent && data.qty !== undefined && Number(data.qty) !== line.qty) throw bad('لا يمكن تعديل كمية صنف أُرسل للمطبخ، ألغِه وأضف من جديد');
    const qty = data.qty !== undefined ? Math.max(1, parseInt(data.qty, 10) || 1) : line.qty;
    run('UPDATE order_items SET qty = ?, notes = ? WHERE id = ?', qty, data.notes !== undefined ? data.notes : line.notes, lineId);
  }
  recalc(orderId);
}

/** إرسال الأصناف الجديدة للمطبخ */
export function sendToKitchen(orderId, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  const r = run("UPDATE order_items SET status = 'new', sent_at = datetime('now','localtime') WHERE order_id = ? AND status = 'pending'", orderId);
  audit(user.id, 'order.send', 'order', orderId, { count: Number(r.changes) });
  return Number(r.changes);
}

export function setDiscount(orderId, { type, value }, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  const v = Number(value) || 0;
  if (v < 0) throw bad('قيمة الخصم غير صحيحة');
  if (type && !['amount', 'percent'].includes(type)) throw bad('نوع الخصم غير صحيح');
  run('UPDATE orders SET discount_type = ?, discount_value = ? WHERE id = ?', v ? type : null, v, orderId);
  recalc(orderId);
  audit(user.id, 'order.discount', 'order', orderId, { type, value: v });
}

/** الدفع: يقبل دفعة واحدة أو عدة دفعات (دفع مختلط) */
export function pay(orderId, payments, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  const pending = get("SELECT COUNT(*) AS c FROM order_items WHERE order_id = ? AND status != 'cancelled'", orderId);
  if (!pending.c) throw bad('الطلب فارغ');
  if (!Array.isArray(payments) || !payments.length) throw bad('أدخل طريقة الدفع');
  const shift = get('SELECT id FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');

  return tx(() => {
    let paid = order.paid;
    for (const p of payments) {
      const amount = round2(p.amount);
      if (!(amount > 0)) throw bad('المبلغ غير صحيح');
      if (!['cash', 'card', 'wallet'].includes(p.method)) throw bad('طريقة دفع غير صحيحة');
      run('INSERT INTO payments(order_id, method, amount, user_id, shift_id) VALUES(?,?,?,?,?)',
        orderId, p.method, amount, user.id, shift?.id ?? null);
      paid = round2(paid + amount);
    }
    // الباقي للعميل (الفكة) يُحسب على الدفع النقدي فقط
    let change = 0;
    if (paid > order.total) {
      change = round2(paid - order.total);
      const cash = get("SELECT id, amount FROM payments WHERE order_id = ? AND method = 'cash' ORDER BY id DESC LIMIT 1", orderId);
      if (!cash || cash.amount < change) throw bad('المبلغ المدفوع بالبطاقة أو المحفظة أكبر من المطلوب');
      run('UPDATE payments SET amount = ? WHERE id = ?', round2(cash.amount - change), cash.id);
      paid = order.total;
    }
    run('UPDATE orders SET paid = ?, cashier_id = ? WHERE id = ?', paid, user.id, orderId);

    const closed = paid >= order.total;
    if (closed) closeOrder(orderId, user);
    audit(user.id, 'order.pay', 'order', orderId, { payments, change });
    return { change, closed };
  });
}

function closeOrder(orderId, user) {
  const s = getSettings();
  run("UPDATE orders SET status = 'paid', closed_at = datetime('now','localtime'), shift_id = COALESCE(shift_id, (SELECT id FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1)) WHERE id = ?", orderId);
  // الأصناف التي لم تُرسل تُعتبر مقدّمة
  run("UPDATE order_items SET status = 'served' WHERE order_id = ? AND status = 'pending'", orderId);
  // خصم المخزون حسب الوصفات
  const usage = all(`
    SELECT r.ingredient_id, SUM(r.qty * oi.qty) AS used
    FROM order_items oi JOIN recipes r ON r.item_id = oi.item_id
    WHERE oi.order_id = ? AND oi.status != 'cancelled'
    GROUP BY r.ingredient_id`, orderId);
  for (const u of usage) {
    run('UPDATE ingredients SET stock = stock - ? WHERE id = ?', u.used, u.ingredient_id);
    run("INSERT INTO stock_movements(ingredient_id, qty, type, order_id, user_id) VALUES(?,?, 'sale', ?, ?)",
      u.ingredient_id, -u.used, orderId, user.id);
  }
  // نقاط الولاء
  const order = get('SELECT customer_id, total FROM orders WHERE id = ?', orderId);
  if (order.customer_id) {
    const pts = Math.floor(order.total * (Number(s.loyalty_points_per_unit) || 0));
    run('UPDATE customers SET points = points + ? WHERE id = ?', pts, order.customer_id);
  }
}

export function cancelOrder(orderId, reason, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  if (order.paid > 0) throw bad('لا يمكن إلغاء طلب عليه دفعات');
  run("UPDATE orders SET status = 'cancelled', cancel_reason = ?, closed_at = datetime('now','localtime') WHERE id = ?", reason || null, orderId);
  run("UPDATE order_items SET status = 'cancelled' WHERE order_id = ? AND status NOT IN ('served')", orderId);
  audit(user.id, 'order.cancel', 'order', orderId, { reason });
}

export function moveTable(orderId, tableId, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  if (order.type !== 'dine_in') throw bad('الطلب ليس طلب صالة');
  const busy = get("SELECT id FROM orders WHERE table_id = ? AND status = 'open' AND id != ?", tableId, orderId);
  if (busy) throw bad('الطاولة الجديدة مشغولة');
  run('UPDATE orders SET table_id = ? WHERE id = ?', tableId, orderId);
  audit(user.id, 'order.move_table', 'order', orderId, { from: order.table_id, to: tableId });
}
