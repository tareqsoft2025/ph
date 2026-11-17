import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const { run, get, all } = await import('../src/db.js');
const { ensureSeed } = await import('../src/seed.js');
const { createWebPush, ensureVapid } = await import('../src/webpush.js');
const { setWebPush, customerNotify, webPushKey } = await import('../src/notify.js');
const Orders = await import('../src/orders.js');
ensureSeed();

const mkOrder = () => {
  const id = Number(run("INSERT INTO orders(number, code, type, status, source, track_token) VALUES(1, 'ORD-TEST-0001', 'takeaway', 'open', 'online', 'tok')").lastInsertRowid);
  run("INSERT INTO order_items(order_id, item_id, name, price, qty, station, status) VALUES(?, 1, 'x', 10, 1, 'kitchen', 'new')", id);
  return id;
};
const sub = (orderId, endpoint, url = 'https://r.example/#/t/abc') => run('INSERT INTO web_push_subs(order_id, endpoint, p256dh, auth, url) VALUES(?,?,?,?,?)', orderId, endpoint, 'p', 'a', url);

test('VAPID keys are generated once and persisted', () => {
  let calls = 0;
  const a = ensureVapid(() => { calls++; return { publicKey: 'PUB', privateKey: 'PRIV' }; });
  const b = ensureVapid(() => { calls++; return { publicKey: 'X', privateKey: 'Y' }; });
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal(get("SELECT value FROM server_keys WHERE name = 'vapid_public'").value, 'PUB');
});

test('customer web push: elegant status messages, per-subscription url, dead subscriptions removed, final cleanup', async () => {
  const sent = [];
  const send = async (s, body) => {
    if (s.endpoint.includes('dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push({ endpoint: s.endpoint, ...JSON.parse(body) });
  };
  setWebPush(createWebPush({ send, keys: { publicKey: 'PUB', privateKey: 'PRIV' }, log: { error() {} } }));
  assert.equal(webPushKey(), 'PUB');
  const id = mkOrder();
  sub(id, 'https://push.example/ok');
  sub(id, 'https://push.example/dead');
  const flush = () => new Promise((r) => setTimeout(r, 30));

  Orders.notifyCustomer(id, 'welcome'); await flush();
  assert.equal(sent.length, 1, 'one live subscription receives it');
  assert.match(sent[0].title, /تفعيل إشعارات/);
  assert.equal(sent[0].url, 'https://r.example/#/t/abc');
  assert.equal(sent[0].tag, 'ORD-TEST-0001');
  assert.equal(get('SELECT COUNT(*) AS c FROM web_push_subs WHERE order_id = ?', id).c, 1, 'dead subscription removed');

  const staff = { id: 1, name: 'x', role: 'admin', perms: [] };
  Orders.kitchenProgress(id, 'preparing', staff, 1); await flush();
  assert.match(sent.at(-1).title, /بدأ تحضير/);
  run("UPDATE order_items SET status = 'ready' WHERE order_id = ?", id);
  Orders.kitchenProgress(id, 'ready', staff, 1); await flush();
  assert.match(sent.at(-1).title, /طلبك جاهز/);
  assert.equal(sent.at(-1).kind, 'ready');

  Orders.notifyCustomer(id, 'rejected', 'السبب: طاولة خاطئة'); await flush();
  assert.match(sent.at(-1).body, /طاولة خاطئة/);
  assert.equal(get('SELECT COUNT(*) AS c FROM web_push_subs WHERE order_id = ?', id).c, 0, 'subscriptions removed after the final message');

  // طلب الموظفين (ليس من QR) لا يُرسل شيئاً
  const staffOrder = Number(run("INSERT INTO orders(number, code, type, status, source) VALUES(2, 'ORD-TEST-0002', 'takeaway', 'open', 'staff')").lastInsertRowid);
  sub(staffOrder, 'https://push.example/other');
  const n = sent.length;
  Orders.notifyCustomer(staffOrder, 'ready'); await flush();
  assert.equal(sent.length, n);
  setWebPush(null);
  customerNotify(id, { kind: 'x' }); // بلا مُرسل: لا يفشل
});
