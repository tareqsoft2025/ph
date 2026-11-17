import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3997;
const BASE = `http://127.0.0.1:${PORT}/api`;
let proc;
async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}
const login = async (u, p) => (await api('/auth/login', { method: 'POST', body: { username: u, password: p } })).data.token;
before(async () => {
  proc = spawn(process.execPath, ['--no-warnings', 'src/server.js'], { env: { ...process.env, PORT, DB_PATH: ':memory:', ATT_RATE_LIMIT: '14', ATT_REQUIRED_DEFAULT: '0' } });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => proc.kill());

// مطعم في الرياض، ونقطة داخل النطاق وأخرى على بعد ~1.1 كم
const SITE = { lat: 24.713600, lng: 46.675300 };
const INSIDE = { lat: 24.713900, lng: 46.675500, accuracy: 15 };
const OUTSIDE = { lat: 24.723600, lng: 46.675300, accuracy: 10 };
const DEV_A = 'device-A-1234567890abcdef';
const DEV_B = 'device-B-1234567890abcdef';

async function punch(token, path, extra = {}) {
  const { nonce } = (await api('/attendance/challenge', { method: 'POST', token })).data;
  return api(path, { method: 'POST', token, body: { nonce, platform: 'android', device_id: DEV_A, ...INSIDE, ...extra } });
}

test('geofenced, device-bound, tamper-resistant attendance', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  const loc = await api('/work-locations', { method: 'POST', token: admin, body: { name: 'الفرع الرئيسي', ...SITE, radius_m: 100 } });
  assert.equal(loc.status, 201);
  assert.equal((await api('/work-locations', { method: 'POST', token: waiter, body: { name: 'x', ...SITE, radius_m: 100 } })).status, 403);

  const me = (await api('/attendance/me', { token: waiter })).data;
  assert.equal(me.rules.location, true);
  assert.equal(me.rules.locations.length, 1);
  await api(`/employees/${me.employee.id}`, { method: 'PUT', token: admin, body: { early_checkin_minutes: 1440 } });

  // بدون رمز التحدي
  let r = await api('/attendance/check-in', { method: 'POST', token: waiter, body: { device_id: DEV_A, ...INSIDE, platform: 'android' } });
  assert.equal(r.data.reason, 'bad_nonce');
  // خارج النطاق، ثم إعادة استخدام نفس الرمز
  const { nonce } = (await api('/attendance/challenge', { method: 'POST', token: waiter })).data;
  r = await api('/attendance/check-in', { method: 'POST', token: waiter, body: { nonce, device_id: DEV_A, platform: 'android', ...OUTSIDE } });
  assert.equal(r.data.reason, 'out_of_range');
  assert.ok(r.data.nearest.distance > 1000, 'reports distance from site');
  r = await api('/attendance/check-in', { method: 'POST', token: waiter, body: { nonce, device_id: DEV_A, platform: 'android', ...INSIDE } });
  assert.equal(r.data.reason, 'bad_nonce', 'nonce cannot be replayed');
  // موقع وهمي، محاكي، روت، دقة ضعيفة، موقع قديم، بدون موقع
  assert.equal((await punch(waiter, '/attendance/check-in', { mock: true })).data.reason, 'mock_location');
  assert.equal((await punch(waiter, '/attendance/check-in', { emulator: true })).data.reason, 'emulator');
  assert.equal((await punch(waiter, '/attendance/check-in', { rooted: true })).data.reason, 'rooted');
  assert.equal((await punch(waiter, '/attendance/check-in', { accuracy: 800 })).data.reason, 'low_accuracy');
  assert.equal((await punch(waiter, '/attendance/check-in', { age_ms: 600000 })).data.reason, 'stale_location');
  assert.equal((await punch(waiter, '/attendance/check-in', { lat: null, lng: null })).data.reason, 'no_location');

  // حضور صحيح من داخل الموقع يربط الجهاز، والوقت من الخادم مهما أرسل الجهاز
  r = await punch(waiter, '/attendance/check-in', { client_time: '2001-01-01 08:00:00' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.location, 'الفرع الرئيسي');
  assert.ok(r.data.distance < 100);
  const now = new Date();
  assert.equal(r.data.check_in.slice(0, 10), `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, 'server clock is used');

  // جهاز زميل آخر لا يستطيع التسجيل بدلاً منه
  assert.equal((await punch(waiter, '/attendance/check-out', { device_id: DEV_B })).data.reason, 'device_mismatch');
  r = await punch(waiter, '/attendance/check-out');
  assert.equal(r.status, 200, JSON.stringify(r.data));

  // محاولات مرفوضة مسجلة، والمشبوهة منها تُشعر المدير
  const rep = (await api('/attendance/report', { token: admin })).data;
  assert.ok(rep.totals.rejected >= 9, `rejected ${rep.totals.rejected}`);
  assert.ok(rep.totals.suspicious >= 5);
  assert.ok(rep.rows.some((x) => x.employee_id === me.employee.id && x.present >= 1));
  assert.ok(rep.daily.length >= 1);
  const notes = (await api('/notifications', { token: admin })).data.rows;
  assert.ok(notes.some((n) => n.type === 'attendance_alert'), 'manager alerted about suspicious attempts');

  // إعادة تعيين الجهاز من المدير
  await api(`/employees/${me.employee.id}/reset-device`, { method: 'POST', token: admin });
  const prof = (await api(`/employees/${me.employee.id}`, { token: admin })).data;
  assert.equal(prof.bound_device, null);
});

test('settings: web blocking, anywhere mode, per-employee grace; staff accounts', async () => {
  const admin = await login('admin', 'admin123');
  const kitchen = await login('kitchen', '1234');
  const me = (await api('/attendance/me', { token: kitchen })).data;
  await api(`/employees/${me.employee.id}`, { method: 'PUT', token: admin, body: { early_checkin_minutes: 1440, location_mode: 'anywhere', grace_minutes: 30 } });
  await api('/settings', { method: 'PUT', token: admin, body: { att_allow_web: '0' } });
  assert.equal((await punch(kitchen, '/attendance/check-in', { platform: 'web' })).data.reason, 'web_blocked');
  await api('/settings', { method: 'PUT', token: admin, body: { att_allow_web: '1' } });
  // "أي مكان": بدون موقع مقبول
  const r = await punch(kitchen, '/attendance/check-in', { lat: null, lng: null, accuracy: null });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await api('/attendance/me', { token: kitchen })).data.employee.grace, 30);

  // حساب دخول لموظف بلا حساب، بدور "موظف"
  const emps = (await api('/employees', { token: admin })).data;
  const noAcc = emps.find((e) => !e.user_id);
  const acc = await api(`/employees/${noAcc.id}/account`, { method: 'POST', token: admin, body: { username: 'john.s', password: 'pass123' } });
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  assert.equal(acc.data.role, 'staff');
  const staff = await login('john.s', 'pass123');
  assert.ok(staff);
  assert.equal((await api('/attendance/me', { token: staff })).data.employee.id, noAcc.id);
  assert.equal((await api('/orders', { token: staff })).status, 403, 'staff cannot see orders');
  assert.equal((await api('/leaves', { token: staff })).status, 200, 'staff can request leaves');
});

test('rate limiting blocks brute-force attempts', async () => {
  const cashier = await login('cashier', '1234');
  let last;
  for (let i = 0; i < 16; i++) last = await punch(cashier, '/attendance/check-in', { mock: true });
  assert.equal(last.data.reason, 'rate_limited');
});
