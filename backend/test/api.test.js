import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}/api`;
let proc;

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}
const login = async (u, p) => (await api('/auth/login', { method: 'POST', body: { username: u, password: p } })).data.token;

before(async () => {
  proc = spawn(process.execPath, ['--no-warnings', 'src/server.js'], { env: { ...process.env, PORT, DB_PATH: ':memory:', ATT_REQUIRED_DEFAULT: '0', QR_RATE_LIMIT: '100' } });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => proc.kill());

test('login fails with wrong password', async () => {
  const r = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'x' } });
  assert.equal(r.status, 401);
});

test('full dine-in flow: order → kitchen → pay → stock deducted', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  const kitchen = await login('kitchen', '1234');
  const cashier = await login('cashier', '1234');

  await api('/settings', { method: 'PUT', token: admin, body: { tax_rate: 15, service_rate: 10 } });
  assert.equal((await api('/shifts/open', { method: 'POST', token: cashier, body: { opening_cash: 100 } })).status, 201);

  const menu = (await api('/menu', { token: waiter })).data;
  const burger = menu.items.find((i) => i.name === 'برجر لحم');
  const cheese = burger.modifiers.find((m) => m.name === 'جبن إضافي');
  const beefBefore = (await api('/ingredients', { token: admin })).data.find((i) => i.name === 'لحم بقري').stock;

  const tables = (await api('/tables', { token: waiter })).data;
  const create = await api('/orders', { method: 'POST', token: waiter, body: {
    type: 'dine_in', table_id: tables[0].id, guests: 2, customer_name: 'عميل', customer_phone: '0501234567',
    items: [{ item_id: burger.id, qty: 2, modifier_ids: [cheese.id] }], send: true,
  } });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const order = create.data;
  assert.match(order.code, /^ORD-\d{6}-\d{4}$/);
  assert.deepEqual(order.events.map((e) => e.type), ['created', 'items_added', 'sent']);
  // (28+3)*2 = 62, service 6.2, tax (68.2)*0.15=10.23, total 78.43
  assert.equal(order.subtotal, 62);
  assert.equal(order.service, 6.2);
  assert.equal(order.total, 78.43);

  // table is busy
  const dup = await api('/orders', { method: 'POST', token: waiter, body: { type: 'dine_in', table_id: tables[0].id, guests: 1, customer_name: 'x', customer_phone: '0500000000' } });
  assert.equal(dup.status, 400);

  // waiter cannot pay
  assert.equal((await api(`/orders/${order.id}/pay`, { method: 'POST', token: waiter, body: { payments: [{ method: 'cash', amount: 100 }] } })).status, 403);

  const k = (await api('/kitchen', { token: kitchen })).data;
  assert.equal(k.length, 1);
  assert.equal(k[0].code, order.code);
  assert.equal(k[0].sent_by_name, 'النادل أحمد');
  assert.equal(k[0].stage, 'new');
  const kn = (await api('/notifications', { token: kitchen })).data;
  assert.ok(kn.rows.some((n) => n.type === 'order_new' && n.title.includes(order.code)), 'kitchen notified of new order');
  await api(`/kitchen/orders/${order.id}/bump`, { method: 'POST', token: kitchen, body: { status: 'ready' } });
  assert.equal((await api('/kitchen', { token: kitchen })).data[0].items[0].status, 'ready');
  const wn = (await api('/notifications', { token: waiter })).data;
  const ready = wn.rows.find((n) => n.type === 'order_ready');
  assert.ok(ready && ready.title.includes(order.code), 'waiter notified when ready');
  assert.equal(wn.unread, 1);
  await api('/notifications/read', { method: 'POST', token: waiter, body: {} });
  assert.equal((await api('/notifications', { token: waiter })).data.unread, 0);

  await api(`/orders/${order.id}/discount`, { method: 'POST', token: cashier, body: { type: 'percent', value: 10 } });
  const pay = await api(`/orders/${order.id}/pay`, { method: 'POST', token: cashier, body: { payments: [{ method: 'card', amount: 20 }, { method: 'cash', amount: 100 }] } });
  assert.equal(pay.status, 200, JSON.stringify(pay.data));
  assert.equal(pay.data.closed, true);
  assert.ok(pay.data.change > 0);
  assert.equal(pay.data.order.status, 'paid');
  const types = pay.data.order.events.map((e) => e.type);
  for (const t of ['created', 'sent', 'ready', 'discount', 'payment', 'paid']) assert.ok(types.includes(t), `timeline has ${t}`);
  assert.ok(pay.data.order.events.every((e) => e.user_name), 'every step records who did it');
  const logged = pay.data.order.events.filter((e) => e.type === 'payment').reduce((a, e) => a + e.data.amount, 0);
  assert.equal(Math.round(logged * 100) / 100, pay.data.order.total, 'payment events record actual amounts after change');

  // سجل التحصيلات: الكاشير يرى تحصيلاته فقط، والمدير يرى الجميع مع اسم المحصّل
  const hist = (await api('/payments/history', { token: cashier })).data;
  assert.equal(hist.all, false);
  assert.equal(hist.rows.length, 1);
  assert.equal(hist.rows[0].order_id, order.id);
  assert.ok(hist.rows[0].user_name);
  assert.equal(hist.summary.byMethod.length, 2, 'card + cash');
  const adminHist = (await api('/payments/history', { token: admin })).data;
  assert.equal(adminHist.all, true);
  assert.ok(adminHist.rows.length >= 1 && adminHist.summary.byCashier.length >= 1 && adminHist.cashiers.length >= 1);
  assert.equal((await api(`/payments/history?user_id=${hist.rows[0].user_id + 99}`, { token: admin })).data.rows.length, 0);
  assert.equal((await api('/payments/history', { token: waiter })).status, 403, 'waiter has no access');

  const beefAfter = (await api('/ingredients', { token: admin })).data.find((i) => i.name === 'لحم بقري').stock;
  assert.ok(Math.abs(beefBefore - beefAfter - 0.3) < 1e-9);

  const tablesAfter = (await api('/tables', { token: waiter })).data;
  assert.equal(tablesAfter[0].status, 'free');
  assert.ok(pay.data.order.items.every((i) => i.status === 'served'), 'dine-in items served on payment');
  assert.ok(pay.data.order.events.some((e) => e.type === 'table_released'), 'table release logged');
  assert.equal((await api('/kitchen', { token: kitchen })).data.length, 0, 'paid dine-in order leaves the kitchen screen');

  const rep = (await api('/reports/summary', { token: admin })).data;
  assert.equal(rep.totals.orders, 1);
  assert.equal(rep.totals.sales, pay.data.order.total);

  const close = await api('/shifts/close', { method: 'POST', token: cashier, body: { closing_cash: 100 } });
  assert.equal(close.status, 200);
  assert.equal(close.data.orders_count, 1);
});

test('customer data required per order type; takeaway cancel works', async () => {
  const cashier = await login('cashier', '1234');
  const waiter = await login('waiter', '1234');
  const tables = (await api('/tables', { token: waiter })).data;
  assert.equal((await api('/orders', { method: 'POST', token: cashier, body: { type: 'takeaway', customer_name: 'a', customer_phone: '0501112223' } })).status, 403, 'cashier cannot create orders');
  const post = (body) => api('/orders', { method: 'POST', token: waiter, body });
  assert.equal((await post({ type: 'delivery', customer_name: 'a', customer_phone: '0501112223' })).status, 400, 'delivery needs address');
  assert.equal((await post({ type: 'takeaway', customer_name: 'a' })).status, 400, 'takeaway needs phone');
  assert.equal((await post({ type: 'takeaway', customer_phone: '0501112223' })).status, 400, 'takeaway needs name');
  assert.equal((await post({ type: 'takeaway', customer_name: 'a', customer_phone: 'abc' })).status, 400, 'phone must be valid');
  assert.equal((await post({ type: 'dine_in', table_id: tables[3].id, customer_name: 'a', customer_phone: '0501112223' })).status, 400, 'dine-in needs guests');
  assert.equal((await post({ type: 'dine_in', table_id: tables[3].id, guests: 2, customer_phone: '0501112223' })).status, 400, 'dine-in needs name');
  const o = (await post({ type: 'takeaway', customer_name: 'سعد', customer_phone: '0501112223' })).data;
  const c = await api(`/orders/${o.id}/cancel`, { method: 'POST', token: cashier, body: { reason: 'test' } });
  assert.equal(c.data.status, 'cancelled');
});

test('device tokens: register, status, unregister', async () => {
  const waiter = await login('waiter', '1234');
  assert.equal((await api('/push/register', { method: 'POST', token: waiter, body: { token: 'short' } })).status, 400);
  const tok = 'fcm-token-' + 'x'.repeat(40);
  const r = await api('/push/register', { method: 'POST', token: waiter, body: { token: tok, platform: 'android' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.enabled, false, 'no service account in tests');
  assert.equal((await api('/push/status', { token: waiter })).data.devices, 1);
  await api('/push/register', { method: 'POST', token: waiter, body: { token: tok } });
  assert.equal((await api('/push/status', { token: waiter })).data.devices, 1, 'same token is not duplicated');
  await api('/push/unregister', { method: 'POST', token: waiter, body: { token: tok } });
  assert.equal((await api('/push/status', { token: waiter })).data.devices, 0);
});

test('bill request notifies cashier; custom permissions are enforced', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  const cashier = await login('cashier', '1234');
  const tables = (await api('/tables', { token: waiter })).data;
  const free = tables.find((t) => t.status === 'free');
  const menu = (await api('/menu', { token: waiter })).data;
  const o = (await api('/orders', { method: 'POST', token: waiter, body: {
    type: 'dine_in', table_id: free.id, guests: 2, customer_name: 'ب', customer_phone: '0507654321', items: [{ item_id: menu.items[0].id }], send: true,
  } })).data;
  const rb = await api(`/orders/${o.id}/request-bill`, { method: 'POST', token: waiter });
  assert.equal(rb.status, 200);
  assert.ok(rb.data.bill_requested_at);
  const cn = (await api('/notifications', { token: cashier })).data.rows;
  assert.ok(cn.some((n) => n.type === 'bill_request' && n.link.includes(String(o.id))), 'cashier notified of bill request');

  // permissions matrix
  assert.equal((await api('/permissions', { token: cashier })).status, 403);
  const pm = (await api('/permissions', { token: admin })).data;
  const w = pm.roles.find((r) => r.role === 'waiter');
  assert.ok(w.perms.includes('pos.create'));
  await api('/permissions/waiter', { method: 'PUT', token: admin, body: { perms: w.perms.filter((k) => k !== 'pos.create') } });
  const denied = await api('/orders', { method: 'POST', token: waiter, body: { type: 'takeaway', customer_name: 'a', customer_phone: '0501112223' } });
  assert.equal(denied.status, 403, 'removed permission blocks waiter');
  const me = (await api('/auth/me', { token: waiter })).data;
  assert.ok(!me.perms.includes('pos.create'));
  await api('/permissions/waiter', { method: 'PUT', token: admin, body: { reset: true } });
  assert.ok((await api('/auth/me', { token: waiter })).data.perms.includes('pos.create'), 'reset restores defaults');

  // grant cashier the right to create orders
  const c = pm.roles.find((r) => r.role === 'cashier');
  await api('/permissions/cashier', { method: 'PUT', token: admin, body: { perms: [...c.perms, 'pos.create'] } });
  const ok = await api('/orders', { method: 'POST', token: cashier, body: { type: 'takeaway', customer_name: 'a', customer_phone: '0501112223' } });
  assert.equal(ok.status, 201);
  await api('/permissions/cashier', { method: 'PUT', token: admin, body: { reset: true } });

  const log = (await api('/audit', { token: admin })).data.rows;
  assert.ok(log.some((a) => a.action === 'permissions.update'), 'permission changes are logged');
  const ordersLog = (await api('/audit?category=order', { token: admin })).data.rows;
  assert.ok(ordersLog.length && ordersLog.every((a) => a.action.startsWith('order.')));
  assert.ok(ordersLog.some((a) => a.order_code === o.code), 'order code resolved');
  assert.equal((await api('/audit', { token: waiter })).status, 403);
});

test('table QR ordering: per-table secret token, table opening, waiter confirmation, one open order per phone, alerts', async () => {
  const admin = await login('admin', 'admin123');
  const kitchen = await login('kitchen', '1234');
  const waiter = await login('waiter', '1234');
  const cashier = await login('cashier', '1234');
  // الرموز: للإدارة فقط ولا تظهر في قائمة الطاولات العادية
  assert.equal((await api('/tables/qr', { token: waiter })).status, 403);
  const qrs = (await api('/tables/qr', { token: admin })).data;
  assert.ok(qrs.length >= 3 && qrs.every((t) => t.token && t.token.length >= 24));
  assert.equal(new Set(qrs.map((t) => t.token)).size, qrs.length, 'each table has its own token');
  assert.ok((await api('/tables', { token: waiter })).data.every((t) => !('qr_token' in t)));
  const [t1, t2, t3] = qrs;
  // لا يوجد رابط عام
  assert.ok([401, 404].includes((await api('/public/config')).status), 'old public config route is gone');
  assert.equal((await api('/public/table/' + t1.id)).status, 404, 'table id is not a valid token');
  assert.equal((await api('/public/table/' + 'a'.repeat(24))).status, 404);
  const info = (await api('/public/table/' + t1.token)).data;
  assert.equal(info.table.name, t1.name);
  assert.equal(info.table.open, false, 'table is closed until a waiter opens it');
  const menu = (await api(`/public/table/${t1.token}/menu`)).data;
  assert.ok(menu.items.length && menu.items.every((i) => !('station' in i)));
  const item = menu.items.find((i) => i.available && i.modifiers.length === 0);
  const post = (tok, body) => api(`/public/table/${tok}/orders`, { method: 'POST', body });
  const good = (extra = {}) => ({ guests: 2, customer_name: 'زبون QR', customer_phone: '0551230001', device_id: 'dev-A', items: [{ item_id: item.id, qty: 1 }], ...extra });

  // طلب الزبون من النادل فتح الطاولة: إشعار + علامة على الطاولة، مع تهدئة
  const req1 = await api(`/public/table/${t1.token}/request-open`, { method: 'POST', body: { device_id: 'dev-A' } });
  assert.equal(req1.status, 200);
  assert.ok(!req1.data.already);
  assert.equal((await api(`/public/table/${t1.token}/request-open`, { method: 'POST', body: {} })).data.already, true, 'repeat is throttled');
  const reqNote = (await api('/notifications', { token: waiter })).data.rows.find((n) => n.type === 'qr_request' && n.title.includes(t1.name));
  assert.ok(reqNote, 'waiter is notified');
  assert.equal(reqNote.link, `/tables?table=${t1.id}`, 'notification links straight to the table');
  assert.ok((await api('/notifications', { token: admin })).data.rows.some((n) => n.type === 'qr_request'), 'admin is notified');
  assert.equal((await api('/tables', { token: waiter })).data.find((t) => t.id === t1.id).qr_requested, 1, 'table card is flagged');
  assert.equal((await api(`/public/table/${'b'.repeat(24)}/request-open`, { method: 'POST', body: {} })).status, 404);

  // 1) الطاولة مغلقة حتى يفتحها النادل
  const closed = await post(t1.token, good());
  assert.equal(closed.status, 403);
  assert.equal(closed.data.reason, 'table_closed');
  assert.equal((await api(`/tables/${t1.id}/qr/open`, { method: 'POST', token: kitchen })).status, 403, 'kitchen cannot open tables');
  assert.equal((await api(`/tables/${t1.id}/qr/open`, { method: 'POST', token: waiter })).status, 200);
  assert.equal((await api('/public/table/' + t1.token)).data.table.open, true);
  assert.equal((await api('/tables', { token: waiter })).data.find((t) => t.id === t1.id).qr_requested, 0, 'opening clears the request');
  assert.equal((await api('/tables', { token: waiter })).data.find((t) => t.id === t1.id).qr_opened_by_name, 'النادل أحمد', 'who opened the table is recorded');
  assert.ok((await api('/notifications', { token: cashier })).data.rows.some((n) => n.type === 'qr_request_taken' && n.title.includes('النادل أحمد')), 'colleagues learn who took the request');

  // 2) أول طلب لجوال جديد يحتاج تأكيداً: لا يصل المطبخ قبل القبول
  assert.equal((await post(t1.token, good({ customer_name: '', customer_phone: '' }))).status, 400);
  const first = await post(t1.token, good());
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.needs_confirm, true);
  const { code, token } = first.data;
  assert.ok(!(await api('/kitchen', { token: kitchen })).data.some((o) => o.code === code), 'not in kitchen before confirmation');
  const tr = (await api(`/public/orders/${code}?t=${token}`)).data;
  assert.equal(tr.pending_confirm, true);
  const staffOrder = (await api('/orders?status=open', { token: cashier })).data.find((o) => o.code === code);
  assert.equal(staffOrder.pending_confirm, 1);
  assert.equal(staffOrder.source, 'online');
  const wn = (await api('/notifications', { token: waiter })).data.rows;
  assert.ok(wn.some((n) => n.type === 'online_confirm'), 'waiter is asked to confirm');
  assert.equal((await api(`/orders/${staffOrder.id}/confirm`, { method: 'POST', token: kitchen })).status, 403);
  const conf = await api(`/orders/${staffOrder.id}/confirm`, { method: 'POST', token: waiter });
  assert.equal(conf.status, 200, JSON.stringify(conf.data));
  assert.equal(conf.data.pending_confirm, 0);
  assert.ok((await api('/kitchen', { token: kitchen })).data.some((o) => o.code === code && o.table_name === t1.name), 'reaches kitchen after confirmation');
  const det = (await api(`/orders/${staffOrder.id}`, { token: cashier })).data;
  assert.equal(det.waiter_name, 'النادل أحمد', 'the waiter who opened the table owns the order');
  assert.ok(det.events.some((e) => e.type === 'online' && /فتحها النادل أحمد/.test(e.message)), 'timeline records who opened the table');
  assert.ok(det.events.some((e) => e.type === 'confirmed' && e.user_name === 'النادل أحمد'), 'timeline records who confirmed');
  const acts = (await api('/audit?category=qr', { token: admin })).data.rows;
  assert.ok(acts.some((a) => a.action === 'qr.request_open' && a.entity_name === t1.name), 'audit: customer request');
  assert.ok(acts.some((a) => a.action === 'qr.table_open' && a.user_name === 'النادل أحمد' && a.details.answered_request), 'audit: who opened and that it answered a request');
  assert.ok(acts.some((a) => a.action === 'qr.order' && a.details.table === t1.name && a.details.needs_confirm === true), 'audit: the QR order details');
  assert.ok((await api('/audit?category=order', { token: admin })).data.rows.some((a) => a.action === 'order.confirm' && a.user_name === 'النادل أحمد'), 'audit: who confirmed');
  assert.equal((await api(`/orders/${staffOrder.id}/confirm`, { method: 'POST', token: waiter })).status, 400, 'cannot confirm twice');
  assert.equal((await api(`/public/orders/${code}?t=wrong`)).status, 404, 'tracking needs the token');

  // 3) غريب لا يضيف على طلب الطاولة، وصاحب الطلب يضيف (جوال مؤكَّد سابقاً ليس ضروريا هنا: الإضافة صغيرة)
  assert.equal((await post(t1.token, good({ customer_phone: '0507654321', device_id: 'dev-B' }))).status, 400);
  const add = await post(t1.token, { order_token: token, device_id: 'dev-A', items: [{ item_id: item.id, qty: 1 }] });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  assert.equal(add.data.added, true);
  assert.equal(add.data.needs_confirm, false, 'small add-on on a confirmed order needs no confirmation');

  // 4) طلب مفتوح واحد لكل جوال وجهاز
  await api(`/tables/${t2.id}/qr/open`, { method: 'POST', token: waiter });
  const dupPhone = await post(t2.token, good({ device_id: 'dev-C' }));
  assert.equal(dupPhone.status, 400);
  assert.match(dupPhone.data.error, /طلب مفتوح/);
  const dupDevice = await post(t2.token, good({ customer_phone: '0509998887', device_id: 'dev-A' }));
  assert.equal(dupDevice.status, 400, 'same device cannot open a second order');
  // رمز طاولة لا يفتح طاولة أخرى
  assert.equal((await post(t2.token, good({ customer_phone: '0509998887', device_id: 'dev-D', order_token: token }))).status, 201, 'other table: new order, token of other table order is ignored');

  // 5) الرفض يلغي الطلب ويغلق الطاولة
  const o2 = (await api('/orders?status=open', { token: cashier })).data.find((o) => o.table_id === t2.id);
  assert.equal(o2.pending_confirm, 1);
  const rej = await api(`/orders/${o2.id}/reject`, { method: 'POST', token: cashier, body: { reason: 'طاولة خاطئة' } });
  assert.equal(rej.status, 200);
  assert.equal(rej.data.status, 'cancelled');
  assert.equal((await api('/public/table/' + t2.token)).data.table.open, false, 'rejecting closes the table for QR');

  // 6) الدفع يغلق الطاولة للـ QR
  await api('/shifts/open', { method: 'POST', token: cashier, body: { opening_cash: 0 } });
  const full = (await api(`/orders/${staffOrder.id}`, { token: cashier })).data;
  const paid = await api(`/orders/${staffOrder.id}/pay`, { method: 'POST', token: cashier, body: { payments: [{ method: 'cash', amount: full.total + 50 }] } });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal((await api('/public/table/' + t1.token)).data.table.open, false, 'payment closes the QR session');

  // 7) وضع التأكيد: دائماً / بدون، وفتح الطاولة اختياري
  await api('/settings', { method: 'PUT', token: admin, body: { qr_confirm_mode: 'never', qr_require_open: '0' } });
  const free = await post(t3.token, good({ customer_phone: '0501110000', device_id: 'dev-E' }));
  assert.equal(free.status, 201, 'no opening needed when the option is off');
  assert.equal(free.data.needs_confirm, false);
  assert.ok((await api('/kitchen', { token: kitchen })).data.some((o) => o.code === free.data.code), 'goes straight to kitchen');
  await api('/settings', { method: 'PUT', token: admin, body: { qr_confirm_mode: 'smart', qr_require_open: '1' } });

  // 8) سجل المحاولات والتنبيه: رموز خاطئة متكررة
  for (let i = 0; i < 6; i++) await api('/public/table/' + String(i).repeat(24));
  const log = (await api('/qr/log', { token: admin })).data;
  assert.ok(log.some((l) => l.event === 'bad_token') && log.some((l) => l.event === 'closed_attempt') && log.some((l) => l.event === 'dup_open'));
  assert.ok((await api('/notifications', { token: admin })).data.rows.some((n) => n.type === 'qr_alert'), 'manager is alerted about repeated bad tokens');
  assert.equal((await api('/qr/log', { token: waiter })).status, 403);

  // 9) تغيير الرمز يبطل البطاقة القديمة، وإيقاف الخدمة
  const rot = await api(`/tables/${t1.id}/qr/rotate`, { method: 'POST', token: admin });
  assert.notEqual(rot.data.token, t1.token);
  assert.equal((await api('/public/table/' + t1.token)).status, 404, 'old card no longer works');
  assert.equal((await api('/public/table/' + rot.data.token)).status, 200);
  await api('/settings', { method: 'PUT', token: admin, body: { online_ordering: '0' } });
  assert.equal((await api(`/public/table/${rot.data.token}/menu`)).status, 403);
  await api('/settings', { method: 'PUT', token: admin, body: { online_ordering: '1' } });
});

test('customer web push subscription: needs the order token, validates the endpoint', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  await api('/settings', { method: 'PUT', token: admin, body: { qr_confirm_mode: 'never', qr_require_open: '0' } });
  const key = (await api('/public/push/key')).data;
  assert.equal(key.enabled, true);
  assert.ok(key.key && key.key.length > 60, 'VAPID public key is served');
  const t = (await api('/tables/qr', { token: admin })).data.find((x) => x.name === 'طاولة 9') || (await api('/tables/qr', { token: admin })).data.at(-1);
  const menu = (await api(`/public/table/${t.token}/menu`)).data;
  const item = menu.items.find((i) => i.available && !i.modifiers.length);
  const o = await api(`/public/table/${t.token}/orders`, { method: 'POST', body: { guests: 1, customer_name: 'زبون', customer_phone: '0559990001', device_id: 'dev-wp', items: [{ item_id: item.id, qty: 1 }] } });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  const { code, token } = o.data;
  const body = { subscription: { endpoint: 'https://push.example.invalid/abc', keys: { p256dh: 'BPk', auth: 'au' } }, url: 'https://r.example/#/t/x' };
  const post = (tok, b) => api(`/public/orders/${code}/push?t=${tok}`, { method: 'POST', body: b });
  assert.equal((await post('wrong', body)).status, 404, 'needs the order token');
  assert.equal((await post(token, { subscription: { endpoint: 'http://insecure/x', keys: { p256dh: 'a', auth: 'b' } } })).status, 400, 'https endpoints only');
  assert.equal((await post(token, { subscription: { endpoint: 'https://x.example/a', keys: {} } })).status, 400);
  assert.equal((await post(token, body)).status, 200);
  assert.equal((await post(token, body)).status, 200, 're-subscribing is idempotent');
  assert.equal((await api('/public/orders/ORD-NOPE/push?t=x', { method: 'POST', body })).status, 404);
  await api('/settings', { method: 'PUT', token: admin, body: { qr_confirm_mode: 'smart', qr_require_open: '1' } });
});

test('customer bill request: payment method + name/phone reach the cashier and are saved to customers', async () => {
  const admin = await login('admin', 'admin123');
  const cashier = await login('cashier', '1234');
  await api('/settings', { method: 'PUT', token: admin, body: { qr_confirm_mode: 'never', qr_require_open: '0' } });
  const tbl = (await api('/tables/qr', { token: admin })).data.at(-2);
  const item = (await api(`/public/table/${tbl.token}/menu`)).data.items.find((i) => i.available && !i.modifiers.length);
  const o = await api(`/public/table/${tbl.token}/orders`, { method: 'POST', body: { guests: 2, customer_name: 'سامي', customer_phone: '0561112233', device_id: 'dev-bill', items: [{ item_id: item.id, qty: 2 }] } });
  assert.equal(o.status, 201, JSON.stringify(o.data));
  const { code, token } = o.data;
  const bill = (body, t = token) => api(`/public/orders/${code}/bill?t=${t}`, { method: 'POST', body });

  // لا طلب حساب قبل تجهيز الطلب في المطبخ
  const early = await bill({ method: 'cash' });
  assert.equal(early.status, 400);
  assert.match(early.data.error, /بعد تجهيز/);
  const kitchenTok = await login('kitchen', '1234');
  const kid = (await api('/kitchen', { token: kitchenTok })).data.find((k) => k.code === code).order_id;
  await api(`/kitchen/orders/${kid}/bump`, { method: 'POST', token: kitchenTok, body: { status: 'preparing' } });
  assert.equal((await bill({ method: 'cash' })).status, 400, 'still blocked while preparing');
  await api(`/kitchen/orders/${kid}/bump`, { method: 'POST', token: kitchenTok, body: { status: 'ready' } });

  assert.equal((await bill({ method: 'wallet', name: 'سامي', phone: '0561112233' }, 'wrong')).status, 404, 'needs the order token');
  assert.equal((await bill({ method: 'crypto' })).status, 400, 'unknown method');
  assert.equal((await bill({ method: 'jawwalpay', name: 'سامي', phone: '' })).status, 400, 'Jawwal Pay needs the phone number');
  assert.equal((await bill({ method: 'wallet', name: '', phone: '0561112233' })).status, 400, 'name required for e-payment');
  const ok = await bill({ method: 'jawwalpay', name: 'سامي علي', phone: '0569998877' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));

  const tr = (await api(`/public/orders/${code}?t=${token}`)).data;
  assert.equal(tr.bill.method, 'jawwalpay');
  assert.equal(tr.bill.phone, '0569998877');
  const row = (await api('/orders?status=open', { token: cashier })).data.find((x) => x.code === code);
  assert.equal(row.bill_method, 'jawwalpay');
  assert.ok(row.bill_requested_at, 'order is flagged as bill requested');
  const nt = (await api('/notifications', { token: cashier })).data.rows.find((n) => n.type === 'bill_request' && n.body.includes(code));
  assert.ok(nt && nt.title.includes('جوال بي') && nt.body.includes('0569998877') && nt.link === `/cashier?order=${row.id}`, 'cashier notification carries method, phone and links to the order');
  const cust = (await api('/customers?q=0561112233', { token: cashier })).data.find((c) => c.phone === '0561112233');
  assert.equal(cust.pay_method, 'jawwalpay');
  assert.equal(cust.pay_phone, '0569998877');
  assert.equal(cust.pay_name, 'سامي علي');
  const det = (await api(`/orders/${row.id}`, { token: cashier })).data;
  assert.ok(det.events.some((e) => e.type === 'bill_requested' && /جوال بي/.test(e.message)), 'timeline records the request');
  assert.ok((await api('/audit?category=qr', { token: admin })).data.rows.some((a) => a.action === 'qr.request_bill' && a.details.method === 'jawwalpay'), 'audit records the request');
  // لا إضافة بعد طلب الحساب
  assert.equal((await api(`/public/table/${tbl.token}/orders`, { method: 'POST', body: { order_token: token, items: [{ item_id: item.id, qty: 1 }] } })).status, 400);
  // إلغاء طلب الحساب
  assert.equal((await api(`/public/orders/${code}/bill?t=${token}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/public/orders/${code}?t=${token}`)).data.bill, null);
  // نقداً: بلا بيانات
  assert.equal((await bill({ method: 'cash' })).status, 200);
  // السماح قابل للإيقاف
  await api('/settings', { method: 'PUT', token: admin, body: { qr_allow_bill: '0' } });
  assert.equal((await bill({ method: 'cash' })).status, 400);
  await api('/settings', { method: 'PUT', token: admin, body: { qr_allow_bill: '1', qr_confirm_mode: 'smart', qr_require_open: '1' } });
});

test('live command-center snapshot: floor, stages, KPIs; managers only', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  assert.equal((await api('/live', { token: waiter })).status, 403);
  const live = (await api('/live', { token: admin })).data;
  assert.ok(live.floor.length >= 10 && live.floor.every((t) => ['free', 'occupied', 'reserved'].includes(t.status)));
  assert.equal(live.hourly.length, 24);
  for (const k of ['confirm', 'draft', 'new', 'preparing', 'ready', 'served', 'bill']) assert.ok(k in live.stages, `stage ${k}`);
  assert.equal(Object.values(live.stages).reduce((a, b) => a + b, 0), live.kpis.open_orders, 'every open order sits in exactly one stage');
  assert.equal(live.kpis.tables, live.floor.length);
  assert.ok(live.orders.every((o) => o.stage && 'items' in o && 'age_min' in o));
  assert.ok(live.kpis.sales_today >= 0 && live.kpis.paid_today >= 0);
});

test('corporate events: QR per institution, selected menu / full menu / price cap, order cap, window, billing and bulk settlement', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  const kitchen = await login('kitchen', '1234');
  const cashier = await login('cashier', '1234');
  const menu = (await api('/menu', { token: admin })).data;
  const plain = menu.items.filter((i) => i.available && !i.modifiers.length);
  assert.ok(plain.length >= 4);
  const cheap = [...plain].sort((a, b) => a.price - b.price);
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = Date.now();
  const win = (fromH, toH) => ({ starts_at: fmt(new Date(now + fromH * 36e5)), ends_at: fmt(new Date(now + toH * 36e5)) });
  const base = { name: 'شركة الأفق', contact_name: 'سعد', contact_phone: '0501234567', ...win(-1, 3) };

  // الصلاحية والتحقق
  assert.equal((await api('/events', { token: waiter })).status, 403);
  assert.equal((await api('/events', { method: 'POST', token: admin, body: { ...base, menu_mode: 'selected', item_ids: [] } })).status, 400, 'selected menu needs items');
  assert.equal((await api('/events', { method: 'POST', token: admin, body: { ...base, menu_mode: 'cap' } })).status, 400, 'cap mode needs a price');
  assert.equal((await api('/events', { method: 'POST', token: admin, body: { ...base, ...win(3, 1), menu_mode: 'full' } })).status, 400, 'end must be after start');

  // قائمة محددة
  const sel = [cheap[0].id, cheap[1].id];
  const e1 = await api('/events', { method: 'POST', token: admin, body: { ...base, menu_mode: 'selected', item_ids: sel, order_cap: Math.round(cheap[0].price + cheap[1].price) + 1, places: ['قاعة 1', 'قاعة 2'], billing: 'institution' } });
  assert.equal(e1.status, 201, JSON.stringify(e1.data));
  const list = (await api('/events', { token: admin })).data;
  const ev1 = list.find((e) => e.id === e1.data.id);
  assert.equal(ev1.state, 'open');
  const det = (await api(`/events/${ev1.id}`, { token: admin })).data;
  const tok = det.token;
  assert.ok(tok && tok.length >= 24);

  const info = (await api(`/public/event/${tok}`)).data;
  assert.equal(info.event.name, 'شركة الأفق');
  assert.equal(info.event.menu_mode, 'selected');
  assert.equal((await api('/public/event/' + 'z'.repeat(24))).status, 404);
  const pm = (await api(`/public/event/${tok}/menu`)).data;
  assert.deepEqual(pm.items.map((i) => i.id).sort(), [...sel].sort(), 'only the predefined items are offered');
  const post = (t, body) => api(`/public/event/${t}/orders`, { method: 'POST', body });
  const line = (id, qty = 1) => ({ item_id: id, qty });
  assert.equal((await post(tok, { customer_name: '', place: 'قاعة 1', items: [line(sel[0])] })).status, 400, 'name required');
  assert.equal((await post(tok, { customer_name: 'نورة', place: 'قاعة 1', items: [line(cheap[3].id)] })).status, 400, 'item outside the list is refused');
  assert.equal((await post(tok, { customer_name: 'نورة', place: 'غرفة سرية', items: [line(sel[0])] })).status, 400, 'place must be one of the configured places');
  assert.equal((await post(tok, { customer_name: 'نورة', place: 'قاعة 1', items: [line(sel[0], 5)] })).status, 400, 'order cap enforced');
  const ok = await post(tok, { customer_name: 'نورة', place: 'قاعة 1', device_id: 'ev-a', items: [line(sel[0]), line(sel[1])] });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.needs_confirm, false);
  const kt = (await api('/kitchen', { token: kitchen })).data.find((k) => k.code === ok.data.code);
  assert.ok(kt && kt.event_name === 'شركة الأفق' && kt.place === 'قاعة 1', 'kitchen sees the institution and place');
  const ok2 = await post(tok, { customer_name: 'خالد', customer_phone: '0507654321', place: 'قاعة 2', device_id: 'ev-b', items: [line(sel[0])] });
  assert.equal(ok2.status, 201, 'several employees order independently, phone optional');
  const tr = (await api(`/public/orders/${ok.data.code}?t=${ok.data.token}`)).data;
  assert.equal(tr.event.name, 'شركة الأفق');
  assert.equal(tr.place, 'قاعة 1');
  // الحساب على المؤسسة: لا طلب حساب فردي
  const kid = (await api('/kitchen', { token: kitchen })).data.find((k) => k.code === ok.data.code).order_id;
  await api(`/kitchen/orders/${kid}/bump`, { method: 'POST', token: kitchen, body: { status: 'ready' } });
  const bill = await api(`/public/orders/${ok.data.code}/bill?t=${ok.data.token}`, { method: 'POST', body: { method: 'cash' } });
  assert.equal(bill.status, 400);
  assert.match(bill.data.error, /المؤسسة/);
  // كشف الحساب والتحصيل الجماعي
  const after = (await api(`/events/${ev1.id}`, { token: admin })).data;
  assert.equal(after.orders.length, 2);
  assert.equal(after.open_orders, 2);
  assert.ok(after.total > 0);
  const od = (await api('/orders?status=open', { token: cashier })).data.find((o) => o.code === ok.data.code);
  assert.equal(od.event_name, 'شركة الأفق');
  assert.equal((await api(`/events/${ev1.id}/settle`, { method: 'POST', token: waiter, body: { method: 'cash' } })).status, 403);
  await api('/shifts/open', { method: 'POST', token: cashier, body: { opening_cash: 0 } }).catch(() => {});
  const settle = await api(`/events/${ev1.id}/settle`, { method: 'POST', token: admin, body: { method: 'card' } });
  assert.equal(settle.status, 200, JSON.stringify(settle.data));
  assert.equal(settle.data.settled, 2);
  const done = (await api(`/events/${ev1.id}`, { token: admin })).data;
  assert.equal(done.open_orders, 0);
  assert.equal(Math.round(done.paid * 100), Math.round(done.total * 100), 'everything is paid');

  // قائمة كاملة + أفراد يدفعون
  const e2 = (await api('/events', { method: 'POST', token: admin, body: { ...base, name: 'جمعية الخير', menu_mode: 'full', billing: 'individual', needs_approval: true } })).data;
  const tok2 = (await api(`/events/${e2.id}`, { token: admin })).data.token;
  const full = (await api(`/public/event/${tok2}/menu`)).data;
  assert.ok(full.items.length >= menu.items.filter((i) => i.active !== 0).length - 1, 'full menu is open');
  const o3 = await post(tok2, { customer_name: 'ليلى', items: [line(cheap[3].id)] });
  assert.equal(o3.status, 201);
  assert.equal(o3.data.needs_confirm, true, 'approval mode holds the order');
  assert.ok(!(await api('/kitchen', { token: kitchen })).data.some((k) => k.code === o3.data.code), 'not in kitchen before approval');

  // سقف السعر
  const capPrice = cheap[2].price;
  const e3 = (await api('/events', { method: 'POST', token: admin, body: { ...base, name: 'ورشة', menu_mode: 'cap', price_cap: capPrice } })).data;
  const tok3 = (await api(`/events/${e3.id}`, { token: admin })).data.token;
  const cm = (await api(`/public/event/${tok3}/menu`)).data;
  assert.ok(cm.items.length > 0 && cm.items.every((i) => i.price <= capPrice), 'only items within the price cap');
  const pricey = [...plain].sort((a, b) => b.price - a.price)[0];
  assert.ok(pricey.price > capPrice);
  assert.equal((await post(tok3, { customer_name: 'سامي', items: [line(pricey.id)] })).status, 400, 'item above the cap is refused');
  assert.equal((await post(tok3, { customer_name: 'سامي', items: [line(cheap[0].id)] })).status, 201);

  // النافذة الزمنية والإيقاف وتغيير الرمز
  const e4 = (await api('/events', { method: 'POST', token: admin, body: { ...base, name: 'قادمة', ...win(2, 4), menu_mode: 'full' } })).data;
  const tok4 = (await api(`/events/${e4.id}`, { token: admin })).data.token;
  assert.equal((await api(`/public/event/${tok4}`)).data.event.state, 'not_started');
  assert.equal((await api(`/public/event/${tok4}/menu`)).status, 403);
  assert.equal((await post(tok4, { customer_name: 'x', items: [line(cheap[0].id)] })).status, 403);
  await api(`/events/${e3.id}`, { method: 'PUT', token: admin, body: { ...base, name: 'ورشة', menu_mode: 'cap', price_cap: capPrice, active: false } });
  assert.equal((await api(`/public/event/${tok3}`)).data.event.state, 'paused');
  assert.equal((await post(tok3, { customer_name: 'سامي', items: [line(cheap[0].id)] })).status, 403, 'paused event refuses orders');
  const rot = await api(`/events/${e4.id}/rotate-token`, { method: 'POST', token: admin });
  assert.notEqual(rot.data.token, tok4);
  assert.equal((await api(`/public/event/${tok4}`)).status, 404, 'old QR stops working');
  assert.equal((await api(`/events/${ev1.id}`, { method: 'DELETE', token: admin })).status, 400, 'cannot delete an event that has orders');
  assert.equal((await api(`/events/${e4.id}`, { method: 'DELETE', token: admin })).status, 200);
  // سجل الحركات
  assert.ok((await api('/audit?category=event', { token: admin })).data.rows.some((a) => a.action === 'event.settle'));
});

test('expenses ledger: categories, cashier records own, manager sees all + summary, drawer cash hits the shift, recurring, audit', async () => {
  const admin = await login('admin', 'admin123');
  const cashier = await login('cashier', '1234');
  const waiter = await login('waiter', '1234');
  const kitchen = await login('kitchen', '1234');
  const today = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const T = ymd(today);

  // الصلاحيات
  assert.equal((await api('/expenses/meta', { token: waiter })).status, 403);
  assert.equal((await api('/expenses/summary', { token: cashier })).status, 403, 'summary is for managers');
  const meta = (await api('/expenses/meta', { token: cashier })).data;
  assert.ok(meta.categories.length >= 10 && meta.categories.every((c) => c.color && c.icon));
  assert.equal(meta.manage, false);
  const cat = (n) => meta.categories.find((c) => c.name === n).id;

  // التحقق
  const post = (token, body) => api('/expenses', { method: 'POST', token, body });
  assert.equal((await post(cashier, { category_id: cat('كهرباء'), amount: 0 })).status, 400, 'amount must be positive');
  assert.equal((await post(cashier, { category_id: 99999, amount: 10 })).status, 400, 'category must exist');
  assert.equal((await post(cashier, { category_id: cat('كهرباء'), amount: 10, tax: 20 })).status, 400, 'tax cannot exceed amount');
  assert.equal((await post(cashier, { category_id: cat('كهرباء'), amount: 10, expense_date: '2099-01-01' })).status, 400, 'no future dates for cashiers');

  // الدرج: يحتاج وردية مفتوحة ويخصم من النقد المتوقع
  await api('/shifts/close', { method: 'POST', token: cashier, body: { closing_cash: 0 } });   // إغلاق أي وردية تركتها اختبارات سابقة
  assert.equal((await post(cashier, { category_id: cat('نظافة ومستلزمات'), amount: 30, method: 'cash', from_drawer: true })).status, 400, 'no open shift');
  await api('/shifts/open', { method: 'POST', token: cashier, body: { opening_cash: 500 } });
  const before = (await api('/shifts/current', { token: cashier })).data.expected_cash;
  const e1 = await post(cashier, { category_id: cat('نظافة ومستلزمات'), amount: 30, method: 'cash', from_drawer: true, vendor: 'بقالة الحي', description: 'مناديل ومنظفات' });
  assert.equal(e1.status, 201, JSON.stringify(e1.data));
  const sh = (await api('/shifts/current', { token: cashier })).data;
  assert.equal(sh.expenses_cash, 30);
  assert.equal(Math.round((before - sh.expected_cash) * 100), 3000, 'expected cash drops by the drawer expense');
  // مصروف إداري (بنك) من المدير
  const e2 = await post(admin, { category_id: cat('إيجار'), amount: 2500, method: 'bank', vendor: 'المؤجر', reference: 'INV-77', expense_date: T });
  assert.equal(e2.status, 201);
  const e3 = await post(admin, { category_id: cat('مشتريات مواد خام'), amount: 400, tax: 52.17, method: 'card', vendor: 'مورد الخضار', expense_date: T });
  assert.equal(e3.status, 201);

  // الكاشير يرى مصاريفه فقط، والمدير يرى الكل
  const mine = (await api('/expenses', { token: cashier })).data;
  assert.equal(mine.rows.length, 1);
  assert.equal(mine.rows[0].vendor, 'بقالة الحي');
  const all_ = (await api(`/expenses?from=${T}&to=${T}`, { token: admin })).data;
  assert.equal(all_.rows.length, 3);
  assert.equal(all_.total, 2930);
  assert.equal((await api(`/expenses?q=INV-77`, { token: admin })).data.rows.length, 1, 'search by invoice ref');
  assert.equal((await api(`/expenses?method=card`, { token: admin })).data.rows.length, 1, 'filter by method');
  assert.equal((await api('/expenses/' + e1.data.id, { method: 'PUT', token: cashier, body: { category_id: cat('كهرباء'), amount: 5 } })).status, 403, 'cashier cannot edit');

  // الملخص المحاسبي
  const sum = (await api(`/expenses/summary?from=${T}&to=${T}`, { token: admin })).data;
  assert.equal(sum.total, 2930);
  assert.equal(sum.count, 3);
  assert.equal(sum.drawer_cash, 30);
  assert.equal(sum.tax_recoverable, 52.17);
  assert.equal(sum.byCategory[0].name, 'إيجار');
  assert.equal(sum.profit.operating, 2530, 'operating excludes purchases (already in COGS)');
  assert.equal(sum.profit.purchases, 400);
  assert.equal(sum.profit.net, Math.round((sum.profit.gross - 2530) * 100) / 100);
  assert.ok(sum.byDay.length === 1 && sum.byMethod.length === 3);

  // تعديل وحذف
  assert.equal((await api('/expenses/' + e2.data.id, { method: 'PUT', token: admin, body: { category_id: cat('إيجار'), amount: 2600, method: 'bank', vendor: 'المؤجر', reference: 'INV-77', expense_date: T } })).status, 200);
  assert.equal((await api(`/expenses?q=INV-77`, { token: admin })).data.rows[0].amount, 2600);
  assert.equal((await api('/expenses/' + e3.data.id, { method: 'DELETE', token: admin })).status, 200);

  // أنواع المصاريف
  const nc = await api('/expense-categories', { method: 'POST', token: admin, body: { name: 'ضيافة', kind: 'operating', color: '#ff8800', icon: 'coffee' } });
  assert.equal(nc.status, 201);
  assert.equal((await api('/expense-categories', { method: 'POST', token: admin, body: { name: 'ضيافة' } })).status, 400, 'unique names');
  assert.equal((await api('/expense-categories', { method: 'POST', token: cashier, body: { name: 'x' } })).status, 403);
  assert.equal((await api(`/expense-categories/${nc.data.id}`, { method: 'DELETE', token: admin })).data.deleted, true, 'unused category is deleted');
  assert.equal((await api(`/expense-categories/${cat('إيجار')}`, { method: 'DELETE', token: admin })).data.hidden, true, 'used category is only hidden');

  // مصاريف ثابتة
  const reb = await api('/expense-categories', { method: 'POST', token: admin, body: { name: 'اشتراكات', kind: 'operating' } });
  const rc = await api('/expenses/recurring', { method: 'POST', token: admin, body: { name: 'اشتراك برنامج', category_id: reb.data.id, amount: 150, method: 'card', day_of_month: 5 } });
  assert.equal(rc.status, 201, JSON.stringify(rc.data));
  const run1 = (await api('/expenses/recurring/run', { method: 'POST', token: admin, body: {} })).data;
  assert.equal(run1.created, 1);
  assert.equal((await api('/expenses/recurring/run', { method: 'POST', token: admin, body: {} })).data.created, 0, 'no duplicates in the same month');
  assert.ok((await api('/expenses/recurring', { token: admin })).data[0].done_this_month >= 1);

  // سجل الحركات
  const acts = (await api('/audit?category=expense', { token: admin })).data.rows.map((a) => a.action);
  for (const a of ['expense.create', 'expense.update', 'expense.delete', 'expense.category_create', 'expense.category_hide', 'expense.recurring_run']) assert.ok(acts.includes(a), a);
  await api('/shifts/close', { method: 'POST', token: cashier, body: { closing_cash: 470 } });
});

test('corporate QR: welcome message, support phone and customer chat with staff replies and notifications', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  const kitchen = await login('kitchen', '1234');
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = Date.now();
  const mk = async (extra) => (await api('/events', { method: 'POST', token: admin, body: { name: 'مؤسسة الندى', starts_at: fmt(new Date(now - 36e5)), ends_at: fmt(new Date(now + 36e5)), menu_mode: 'full', ...extra } })).data.id;
  const id = await mk({ welcome_message: 'مرحباً بكم، نتمنى لكم قضاء أجمل الأوقات', support_phone: '+970599000111' });
  const tok = (await api(`/events/${id}`, { token: admin })).data.token;
  const pub = (await api(`/public/event/${tok}`)).data.event;
  assert.equal(pub.welcome_message, 'مرحباً بكم، نتمنى لكم قضاء أجمل الأوقات');
  assert.equal(pub.support_phone, '+970599000111');
  assert.equal(pub.support_chat, true);

  const dev = 'device-abc-12345';
  assert.equal((await api(`/public/event/${tok}/chat?device_id=short`)).status, 400, 'device id required');
  assert.equal((await api(`/public/event/${tok}/chat`, { method: 'POST', body: { device_id: dev, body: '   ' } })).status, 400, 'empty message refused');
  const sent = await api(`/public/event/${tok}/chat`, { method: 'POST', body: { device_id: dev, name: 'ليلى', body: 'نريد طاولة إضافية' } });
  assert.equal(sent.status, 201);
  // الموظف المخوَّل يتلقى إشعاراً بالرسالة
  const notes = (await api('/notifications', { token: waiter })).data;
  assert.ok((notes.rows || notes).some((n) => n.type === 'chat' && /ليلى/.test(n.title)), 'waiter notified');
  assert.equal((await api('/chat/threads', { token: kitchen })).status, 403, 'kitchen cannot read chats');
  const thr = await api('/chat/threads', { token: waiter }); assert.equal(thr.status, 200, JSON.stringify(thr.data));
  const th = thr.data;
  assert.equal(th.find((t) => t.event_id === id).unread, 1);
  const open = (await api(`/chat/thread?event_id=${id}&device_id=${dev}`, { token: waiter })).data;
  assert.equal(open.messages.length, 1);
  assert.equal((await api('/chat/threads', { token: waiter })).data.find((t) => t.event_id === id).unread, 0, 'opening marks read');
  assert.equal((await api('/chat/reply', { method: 'POST', token: waiter, body: { event_id: id, device_id: dev, body: 'تم، سنجهزها خلال دقائق' } })).status, 201);
  const mine = (await api(`/public/event/${tok}/chat?device_id=${dev}`)).data;
  assert.deepEqual(mine.messages.map((m) => m.sender), ['customer', 'staff']);
  // جهاز آخر لا يرى المحادثة
  assert.equal((await api(`/public/event/${tok}/chat?device_id=another-device-1`)).data.messages.length, 0);
  // إيقاف المحادثة
  const id2 = await mk({ support_chat: false });
  const tok2 = (await api(`/events/${id2}`, { token: admin })).data.token;
  assert.equal((await api(`/public/event/${tok2}/chat`, { method: 'POST', body: { device_id: dev, body: 'مرحبا' } })).status, 400);
});
