// الإشعارات الفورية عبر Firebase Cloud Messaging (HTTP v1)
// تعمل حتى لو كان تطبيق الأندرويد مغلقاً. تحتاج ملف حساب الخدمة من Firebase:
//   FIREBASE_SERVICE_ACCOUNT=/path/to/service-account.json   (أو ضع الملف في backend/firebase-service-account.json)
//   أو FIREBASE_SERVICE_ACCOUNT_JSON='{...}'
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { all, run } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export function loadServiceAccount(env = process.env) {
  try {
    if (env.FIREBASE_SERVICE_ACCOUNT_JSON) return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    const file = env.FIREBASE_SERVICE_ACCOUNT || join(__dirname, '..', 'firebase-service-account.json');
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('⚠️ تعذّر قراءة حساب خدمة Firebase:', e.message);
  }
  return null;
}

/** ينشئ مُرسلاً للإشعارات الفورية، أو null إذا لم يُضبط Firebase */
export function createPushSender(sa, { fetchFn = globalThis.fetch, log = console } = {}) {
  if (!sa?.client_email || !sa?.private_key || !sa?.project_id) return null;
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  let cached = null;

  async function accessToken() {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }, sa.private_key, { algorithm: 'RS256' });
    const res = await fetchFn(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) throw new Error(`Firebase auth failed: ${data.error_description || data.error || res.status}`);
    cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
    return cached.token;
  }

  async function sendOne(token, n, auth) {
    const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: n.title, body: n.body || '' },
          data: { link: n.link || '', type: n.type || '', level: n.level || 'info' },
          android: {
            priority: 'high',
            notification: { channel_id: n.type === 'order_ready' || n.type === 'order_new' ? 'orders' : 'general', sound: 'default', default_vibrate_timings: true },
          },
        },
      }),
    });
    if (res.ok) return 'ok';
    const err = await res.json().catch(() => ({}));
    const code = err?.error?.details?.find?.((d) => d.errorCode)?.errorCode || err?.error?.status;
    // الجهاز لم يعد مسجلاً: نحذف الرمز
    if (res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') {
      run('DELETE FROM device_tokens WHERE token = ?', token);
      return 'removed';
    }
    log.error?.(`FCM ${res.status}: ${err?.error?.message || ''}`);
    return 'error';
  }

  return async function send(userIds, n) {
    if (!userIds.length) return [];
    const tokens = all(`SELECT token FROM device_tokens WHERE user_id IN (${userIds.map(() => '?').join(',')})`, ...userIds).map((r) => r.token);
    if (!tokens.length) return [];
    const auth = await accessToken();
    return Promise.all(tokens.map((t) => sendOne(t, n, auth)));
  };
}
