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
  proc = spawn(process.execPath, ['--no-warnings', 'src/server.js'], { env: { ...process.env, PORT, DB_PATH: ':memory:', ATT_REQUIRED_DEFAULT: '0' } });
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
