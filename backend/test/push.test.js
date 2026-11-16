import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';

process.env.DB_PATH = ':memory:';
const { run, get } = await import('../src/db.js');
const { ensureSeed } = await import('../src/seed.js');
const { createPushSender, loadServiceAccount } = await import('../src/push.js');
const { notify, setPushSender, pushEnabled } = await import('../src/notify.js');
ensureSeed();

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = {
  project_id: 'demo-restaurant', client_email: 'push@demo-restaurant.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token',
};

function mockFetch() {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'tok-123', expires_in: 3600 }) };
    const body = JSON.parse(opts.body);
    if (body.message.token === 'dead-token-xxxxxxxxxxxxxxxx') {
      return { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }) };
    }
    return { ok: true, status: 200, json: async () => ({ name: 'projects/x/messages/1' }) };
  };
  return { fn, calls };
}

test('push disabled without service account', () => {
  assert.equal(createPushSender(null), null);
  assert.equal(loadServiceAccount({ FIREBASE_SERVICE_ACCOUNT: '/nonexistent.json' }), null);
  assert.equal(pushEnabled(), false);
});

test('sends signed FCM v1 messages and removes dead tokens', async () => {
  const waiter = get("SELECT id FROM users WHERE username = 'waiter'").id;
  run("INSERT INTO device_tokens(user_id, token) VALUES(?, 'good-token-xxxxxxxxxxxxxxxx'), (?, 'dead-token-xxxxxxxxxxxxxxxx')", waiter, waiter);
  const { fn, calls } = mockFetch();
  const send = createPushSender(sa, { fetchFn: fn, log: {} });
  const results = await send([waiter], { type: 'order_ready', title: 'الطلب ORD-1 جاهز', body: 'طاولة 3', link: '/pos/1' });
  assert.deepEqual(results.sort(), ['ok', 'removed']);

  // OAuth: JWT موقّع بمفتاح الحساب
  const auth = calls.find((c) => c.url.includes('oauth2'));
  const assertion = new URLSearchParams(auth.opts.body).get('assertion');
  const claims = jwt.verify(assertion, publicKey.export({ type: 'spki', format: 'pem' }), { algorithms: ['RS256'] });
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');

  const msg = calls.find((c) => c.url.includes('fcm.googleapis.com/v1/projects/demo-restaurant/messages:send'));
  assert.ok(msg, 'FCM v1 endpoint called');
  assert.equal(msg.opts.headers.Authorization, 'Bearer tok-123');
  const m = JSON.parse(msg.opts.body).message;
  assert.equal(m.notification.title, 'الطلب ORD-1 جاهز');
  assert.equal(m.data.link, '/pos/1');
  assert.equal(m.android.priority, 'high');
  assert.equal(m.android.notification.channel_id, 'orders');

  assert.equal(get("SELECT COUNT(*) AS c FROM device_tokens WHERE token = 'dead-token-xxxxxxxxxxxxxxxx'").c, 0, 'dead token removed');
  assert.equal(get("SELECT COUNT(*) AS c FROM device_tokens WHERE token = 'good-token-xxxxxxxxxxxxxxxx'").c, 1);

  // التوكن يُعاد استخدامه دون طلب جديد
  await send([waiter], { title: 'x' });
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1, 'access token cached');
});

test('notify() triggers the push sender for targeted users', async () => {
  const got = [];
  setPushSender(async (ids, n) => { got.push({ ids, n }); });
  assert.equal(pushEnabled(), true);
  const kitchenId = get("SELECT id FROM users WHERE username = 'kitchen'").id;
  notify({ roles: ['kitchen'], type: 'order_new', title: 'طلب جديد' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].ids, [kitchenId]);
  assert.equal(got[0].n.title, 'طلب جديد');
  setPushSender(null);
});
