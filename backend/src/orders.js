// منطق الطلبات: الحساب، الإضافة، الإرسال للمطبخ، الدفع
import { get, all, run, tx, getSettings, audit } from './db.js';
import { bad, notFound, round2 } from './util.js';
import { notify, customerNotify } from './notify.js';
import { hasPerm } from './perms.js';

const TYPE_LABEL = { dine_in: 'صالة', takeaway: 'سفري', delivery: 'توصيل' };

/** يسجّل خطوة في تسلسل عمليات الطلب */
const CUSTOMER_MSG = {
  welcome: ['🔔 تم تفعيل إشعارات طلبك', 'سنخبرك فور تغيّر حالته حتى لو أغلقت الصفحة.'],
  confirmed: ['✅ تم قبول طلبك', 'وصل طلبك إلى المطبخ.'],
  preparing: ['👨‍🍳 بدأ تحضير طلبك', 'الشيف يجهّز طلبك الآن.'],
  ready: ['🔔 طلبك جاهز!', 'سيصلك إلى طاولتك خلال لحظات.'],
  served: ['🍽️ بالهناء والعافية', 'تم تقديم طلبك.'],
  rejected: ['⚠️ تعذّر قبول طلبك', 'نادِ النادل للمساعدة.'],
  cancelled: ['⚠️ أُلغي طلبك', 'نادِ النادل للمساعدة.'],
  paid: ['💚 شكراً لزيارتكم', 'نتمنى أن نراكم قريباً.'],
};
/** إشعار لزبون طلب QR (Web Push) عند تغيّر حالة طلبه */
export function notifyCustomer(orderId, kind, extra = null) {
  const o = get("SELECT code FROM orders WHERE id = ? AND source = 'online'", orderId);
  if (!o) return;
  const [title, body] = CUSTOMER_MSG[kind] || [];
  if (!title) return;
  customerNotify(orderId, { kind, title, body: extra || body, tag: o.code, code: o.code });
}

export function logEvent(orderId, type, userId, message = null, data = null) {
  run('INSERT INTO order_events(order_id, type, message, data, user_id) VALUES(?,?,?,?,?)',
    orderId, type, message, data ? JSON.stringify(data) : null, userId ?? null);
}

/** وصف مختصر للطلب: الكود + الطاولة أو العميل */
export function orderLabel(orderId) {
  const o = get('SELECT o.code, o.type, o.customer_name, t.name AS table_name FROM orders o LEFT JOIN dining_tables t ON t.id = o.table_id WHERE o.id = ?', orderId);
  return { code: o.code, where: o.table_name || `${TYPE_LABEL[o.type]}${o.customer_name ? ` · ${o.customer_name}` : ''}` };
}

const PHONE_RE = /^\+?[0-9\s-]{7,15}$/;

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
  order.payments = all('SELECT p.*, u.name AS user_name FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.order_id = ? ORDER BY p.id', id);
  order.events = all(`SELECT e.*, u.name AS user_name, u.role AS user_role FROM order_events e
    LEFT JOIN users u ON u.id = e.user_id WHERE e.order_id = ? ORDER BY e.id`, id).map((e) => ({ ...e, data: e.data ? JSON.parse(e.data) : null }));
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
  const name = String(data.customer_name || '').trim();
  const phone = String(data.customer_phone || '').trim();
  if (type === 'dine_in') {
    if (!data.table_id) throw bad('اختر الطاولة');
    if (!(Number(data.guests) >= 1)) throw bad('أدخل عدد الأشخاص');
    const busy = get("SELECT id FROM orders WHERE table_id = ? AND status = 'open'", data.table_id);
    if (busy) throw bad('الطاولة مشغولة بطلب مفتوح');
  }
  if (!name) throw bad('أدخل اسم العميل');
  if (!phone) throw bad('أدخل رقم جوال العميل');
  if (!PHONE_RE.test(phone)) throw bad('رقم الجوال غير صحيح');
  if (type === 'delivery' && !String(data.address || '').trim()) throw bad('أدخل عنوان التوصيل');
  data = { ...data, customer_name: name, customer_phone: phone };

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
    const number = nextOrderNumber();
    const d = new Date();
    const code = `ORD-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(number).padStart(4, '0')}`;
    const info = run(`INSERT INTO orders(number, code, type, table_id, customer_id, customer_name, customer_phone, address, guests, notes, waiter_id, shift_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      number, code, type, type === 'dine_in' ? data.table_id : null, customerId,
      data.customer_name || null, data.customer_phone || null, data.address || null,
      data.guests || null, data.notes || null, user.id, shift?.id ?? null);
    const id = Number(info.lastInsertRowid);
    logEvent(id, 'created', user.id, `طلب ${TYPE_LABEL[type]} جديد`, { type, table_id: data.table_id || null, guests: data.guests || null });
    if (Array.isArray(data.items) && data.items.length) {
      for (const it of data.items) insertItem(id, it);
      logEvent(id, 'items_added', user.id, `أُضيف ${data.items.reduce((a, x) => a + (Number(x.qty) || 1), 0)} صنف`);
    }
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
    logEvent(orderId, 'items_added', user.id, `أُضيف ${items.reduce((a, x) => a + (Number(x.qty) || 1), 0)} صنف`);
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
    if (sent && !hasPerm(user, 'orders.cancel_item')) throw bad('إلغاء صنف أُرسل للمطبخ يحتاج صلاحية خاصة');
    if (!sent && !hasPerm(user, 'pos.create')) throw bad('ليس لديك صلاحية تعديل الطلب');
    if (sent) run("UPDATE order_items SET status = 'cancelled' WHERE id = ?", lineId);
    else run('DELETE FROM order_items WHERE id = ?', lineId);
    audit(user.id, 'order.cancel_item', 'order', orderId, { line: lineId, name: line.name, qty: line.qty, sent });
    logEvent(orderId, 'item_cancelled', user.id, `إلغاء ${line.qty}× ${line.name}`);
  } else {
    if (!hasPerm(user, 'pos.create')) throw bad('ليس لديك صلاحية تعديل الطلب');
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
  const lines = all("SELECT name, qty FROM order_items WHERE order_id = ? AND status = 'pending'", orderId);
  const r = run("UPDATE order_items SET status = 'new', sent_at = datetime('now','localtime'), sent_by = ? WHERE order_id = ? AND status = 'pending'", user.id, orderId);
  const count = Number(r.changes);
  if (count) run('UPDATE orders SET pending_confirm = 0 WHERE id = ?', orderId);
  audit(user.id, 'order.send', 'order', orderId, { count });
  if (count) {
    const qty = lines.reduce((a, l) => a + l.qty, 0);
    logEvent(orderId, 'sent', user.id, `أُرسل ${qty} صنف للمطبخ`, { items: lines });
    const { code, where } = orderLabel(orderId);
    notify({
      perms: ['kitchen.update'], type: 'order_new', level: 'info', link: '/kitchen',
      title: `طلب جديد ${code}`, body: `${where} · ${qty} صنف · من ${user.name}`,
    });
  }
  return count;
}

export function setDiscount(orderId, { type, value }, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  const v = Number(value) || 0;
  if (v < 0) throw bad('قيمة الخصم غير صحيحة');
  if (type && !['amount', 'percent'].includes(type)) throw bad('نوع الخصم غير صحيح');
  run('UPDATE orders SET discount_type = ?, discount_value = ? WHERE id = ?', v ? type : null, v, orderId);
  recalc(orderId);
  logEvent(orderId, 'discount', user.id, v ? `خصم ${type === 'percent' ? `${v}%` : v}` : 'إزالة الخصم');
  audit(user.id, 'order.discount', 'order', orderId, { type, value: v });
}

/** الدفع: يقبل دفعة واحدة أو عدة دفعات (دفع مختلط) */
export function pay(orderId, payments, user) {
  if (get('SELECT pending_confirm FROM orders WHERE id = ?', orderId)?.pending_confirm) throw bad('طلب QR بانتظار التأكيد: أكّده أو ارفضه قبل التحصيل');
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  const pending = get("SELECT COUNT(*) AS c FROM order_items WHERE order_id = ? AND status != 'cancelled'", orderId);
  if (!pending.c) throw bad('الطلب فارغ');
  if (!Array.isArray(payments) || !payments.length) throw bad('أدخل طريقة الدفع');
  const shift = get('SELECT id FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');

  return tx(() => {
    let paid = order.paid;
    const newIds = [];
    for (const p of payments) {
      const amount = round2(p.amount);
      if (!(amount > 0)) throw bad('المبلغ غير صحيح');
      if (!['cash', 'card', 'wallet'].includes(p.method)) throw bad('طريقة دفع غير صحيحة');
      const ins = run('INSERT INTO payments(order_id, method, amount, user_id, shift_id) VALUES(?,?,?,?,?)',
        orderId, p.method, amount, user.id, shift?.id ?? null);
      newIds.push(Number(ins.lastInsertRowid));
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
    // تسجيل الدفعات بمبالغها الفعلية (بعد خصم الباقي للعميل)
    for (const pid of newIds) {
      const pr = get('SELECT method, amount FROM payments WHERE id = ?', pid);
      logEvent(orderId, 'payment', user.id, null, { method: pr.method, amount: pr.amount });
    }

    const closed = paid >= order.total;
    if (closed) {
      closeOrder(orderId, user);
      logEvent(orderId, 'paid', user.id, change ? `تم السداد · الباقي للعميل ${change}` : 'تم السداد وإغلاق الطلب', { total: order.total, change });
      notifyCustomer(orderId, 'paid');
    }
    audit(user.id, 'order.pay', 'order', orderId, { payments, change });
    return { change, closed };
  });
}

function closeOrder(orderId, user) {
  const s = getSettings();
  run("UPDATE orders SET status = 'paid', closed_at = datetime('now','localtime'), shift_id = COALESCE(shift_id, (SELECT id FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1)) WHERE id = ?", orderId);
  // الأصناف التي لم تُرسل تُعتبر مقدّمة
  run("UPDATE order_items SET status = 'served' WHERE order_id = ? AND status = 'pending'", orderId);
  // طلب الصالة ينتهي بالدفع: كل الأصناف مقدّمة وتُحرَّر الطاولة
  const o0 = get('SELECT type, table_id FROM orders WHERE id = ?', orderId);
  if (o0.type === 'dine_in') {
    const r = run("UPDATE order_items SET status = 'served' WHERE order_id = ? AND status IN ('new','preparing','ready')", orderId);
    if (Number(r.changes) || !get("SELECT id FROM order_events WHERE order_id = ? AND type = 'served'", orderId)) {
      logEvent(orderId, 'served', user.id, 'تم التقديم');
    }
    run('UPDATE dining_tables SET qr_open_until = NULL, qr_opened_by = NULL WHERE id = ?', o0.table_id);
    const t = get('SELECT name FROM dining_tables WHERE id = ?', o0.table_id);
    if (t) logEvent(orderId, 'table_released', user.id, `تحرير ${t.name}`);
  }
  // خصم المخزون حسب الوصفات
  const usage = all(`
    SELECT r.ingredient_id, SUM(r.qty * oi.qty) AS used
    FROM order_items oi JOIN recipes r ON r.item_id = oi.item_id
    WHERE oi.order_id = ? AND oi.status != 'cancelled'
    GROUP BY r.ingredient_id`, orderId);
  for (const u of usage) {
    const ing = get('SELECT name, unit, stock, min_stock FROM ingredients WHERE id = ?', u.ingredient_id);
    if (ing && ing.stock > ing.min_stock && ing.stock - u.used <= ing.min_stock) {
      notify({ perms: ['inventory.manage'], roles: ['admin'], type: 'low_stock', level: 'warning', link: '/inventory',
        title: `مخزون منخفض: ${ing.name}`, body: `المتبقي ${+(ing.stock - u.used).toFixed(2)} ${ing.unit} (الحد الأدنى ${ing.min_stock})` });
    }
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

export function cancelOrder(orderId, reason, user, quiet = false) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  if (order.paid > 0) throw bad('لا يمكن إلغاء طلب عليه دفعات');
  run("UPDATE orders SET status = 'cancelled', pending_confirm = 0, cancel_reason = ?, closed_at = datetime('now','localtime') WHERE id = ?", reason || null, orderId);
  if (order.table_id) run('UPDATE dining_tables SET qr_open_until = NULL, qr_opened_by = NULL WHERE id = ?', order.table_id);
  run("UPDATE order_items SET status = 'cancelled' WHERE order_id = ? AND status NOT IN ('served')", orderId);
  audit(user.id, 'order.cancel', 'order', orderId, { reason });
  logEvent(orderId, 'cancelled', user.id, reason ? `إلغاء الطلب: ${reason}` : 'إلغاء الطلب');
  if (!quiet) notifyCustomer(orderId, 'cancelled', reason ? `السبب: ${reason}` : null);
}

export function moveTable(orderId, tableId, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  if (order.type !== 'dine_in') throw bad('الطلب ليس طلب صالة');
  const busy = get("SELECT id FROM orders WHERE table_id = ? AND status = 'open' AND id != ?", tableId, orderId);
  if (busy) throw bad('الطاولة الجديدة مشغولة');
  run('UPDATE orders SET table_id = ? WHERE id = ?', tableId, orderId);
  // جلسة QR تنتقل مع الزبون: تُفتح الطاولة الجديدة وتُغلق القديمة
  const oldOpen = get('SELECT qr_open_until FROM dining_tables WHERE id = ?', order.table_id)?.qr_open_until;
  if (oldOpen || order.source === 'online') {
    run("UPDATE dining_tables SET qr_open_until = COALESCE(?, datetime('now','localtime','+2 hours')), qr_opened_by = (SELECT qr_opened_by FROM dining_tables WHERE id = ?) WHERE id = ?", oldOpen || null, order.table_id, tableId);
    run('UPDATE dining_tables SET qr_open_until = NULL, qr_opened_by = NULL WHERE id = ?', order.table_id);
  }
  audit(user.id, 'order.move_table', 'order', orderId, { from: order.table_id, to: tableId });
  const names = all('SELECT id, name FROM dining_tables WHERE id IN (?, ?)', order.table_id, tableId);
  const nm = (id) => names.find((t) => t.id === id)?.name;
  logEvent(orderId, 'moved', user.id, `نقل من ${nm(order.table_id)} إلى ${nm(tableId)}`);
}

/**
 * بعد تغيير حالة أصناف في المطبخ: يسجّل الخطوة، وإذا أصبح الطلب كله جاهزاً يُشعر النادل/الكاشير
 * @param {'preparing'|'ready'|'served'} status
 */
export function kitchenProgress(orderId, status, user, changed) {
  if (!changed) return;
  const msg = { preparing: 'بدأ التحضير في المطبخ', ready: 'أصناف جاهزة', served: 'تم تقديم الطلب' }[status];
  const pending = get("SELECT COUNT(*) AS c FROM order_items WHERE order_id = ? AND status IN ('new','preparing')", orderId).c;
  if (status === 'ready' && pending === 0) {
    logEvent(orderId, 'ready', user.id, 'الطلب جاهز للتقديم');
    notifyCustomer(orderId, 'ready');
    audit(user.id, 'kitchen.ready', 'order', orderId);
    const o = get('SELECT waiter_id, type FROM orders WHERE id = ?', orderId);
    const { code, where } = orderLabel(orderId);
    notify({
      userIds: [o.waiter_id], perms: o.type === 'dine_in' && o.waiter_id ? [] : o.type === 'dine_in' ? ['pos.create', 'payments.collect'] : ['payments.collect'],
      type: 'order_ready', level: 'success', link: `/pos/${orderId}`,
      title: `الطلب ${code} جاهز`, body: `${where} · جهّزه ${user.name}`,
    });
  } else if (status === 'preparing') {
    const already = get("SELECT id FROM order_events WHERE order_id = ? AND type = 'preparing' AND id > COALESCE((SELECT MAX(id) FROM order_events WHERE order_id = ? AND type = 'sent'), 0)", orderId, orderId);
    if (!already) { logEvent(orderId, 'preparing', user.id, msg); notifyCustomer(orderId, 'preparing'); }
  } else if (status === 'served') {
    logEvent(orderId, 'served', user.id, msg);
    notifyCustomer(orderId, 'served');
  }
}

/** النادل يطلب الحساب: يُشعر الكاشير */
export function requestBill(orderId, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  run("UPDATE orders SET bill_requested_at = datetime('now','localtime') WHERE id = ?", orderId);
  logEvent(orderId, 'bill_requested', user.id, 'طُلب الحساب');
  const { code, where } = orderLabel(orderId);
  notify({
    perms: ['payments.collect'], exclude: user.id, type: 'bill_request', level: 'warning', link: `/cashier?order=${orderId}`,
    title: `${where} تطلب الحساب`, body: `${code} · ${order.total} · من ${user.name}`,
  });
}

/** قبول طلب QR بانتظار التأكيد: يُرسل للمطبخ */
export function confirmOrder(orderId, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  if (!order.pending_confirm) throw bad('هذا الطلب لا ينتظر تأكيداً');
  const n = sendToKitchen(orderId, user);
  run('UPDATE orders SET pending_confirm = 0 WHERE id = ?', orderId);
  logEvent(orderId, 'confirmed', user.id, 'تأكيد طلب الزبون وإرساله للمطبخ');
  notifyCustomer(orderId, 'confirmed');
  audit(user.id, 'order.confirm', 'order', orderId, { items: n, table: get('SELECT name FROM dining_tables WHERE id = ?', order.table_id)?.name || null });
  return n;
}

/** رفض طلب QR بانتظار التأكيد */
export function rejectOrder(orderId, reason, user) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  assertOpen(order);
  if (!order.pending_confirm) throw bad('هذا الطلب لا ينتظر تأكيداً');
  cancelOrder(orderId, reason || 'رفضه الموظف', user, true);
  notifyCustomer(orderId, 'rejected', reason ? `السبب: ${reason}` : null);
  audit(user.id, 'order.reject', 'order', orderId, { reason });
}
