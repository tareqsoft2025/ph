import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3996;
const BASE = `http://127.0.0.1:${PORT}/api`;
let proc;
async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}
const login = async (u, p) => (await api('/auth/login', { method: 'POST', body: { username: u, password: p } })).data.token;
before(async () => {
  proc = spawn(process.execPath, ['--no-warnings', 'src/server.js'], { env: { ...process.env, PORT, DB_PATH: ':memory:', ATT_REQUIRED_DEFAULT: '1' } });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => proc.kill());

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

test('attendance is required before using the system (enforced on the server)', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  const me = (await api('/attendance/me', { token: waiter })).data;
  const id = me.employee.id;
  const now = new Date();
  const put = (body) => api(`/employees/${id}`, { method: 'PUT', token: admin, body });

  // الدوام يشمل الآن، ويوم الراحة ليس اليوم: الحضور إلزامي
  await put({ work_start: hhmm(new Date(now.getTime() - 3600e3)), work_end: '23:59', weekly_off: [(now.getDay() + 3) % 7], location_mode: 'anywhere', device_binding: 0 });
  if (now.getHours() === 0 && now.getMinutes() < 5) return; // حافة منتصف الليل
  assert.equal((await api('/attendance/me', { token: waiter })).data.required, true);
  const blocked = await api('/tables', { token: waiter });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.reason, 'attendance_required');
  assert.equal((await api('/orders', { token: waiter })).status, 403);
  // المسارات اللازمة للتسجيل والإشعارات مفتوحة
  assert.equal((await api('/notifications', { token: waiter })).status, 200);
  assert.equal((await api('/settings', { token: waiter })).status, 200);
  // المدير العام (بلا ملف موظف) غير مقيّد
  assert.equal((await api('/tables', { token: admin })).status, 200);

  // بعد تسجيل الحضور يُفتح النظام
  const { nonce } = (await api('/attendance/challenge', { method: 'POST', token: waiter })).data;
  const ci = await api('/attendance/check-in', { method: 'POST', token: waiter, body: { nonce, platform: 'android', device_id: 'device-gate-1234567890' } });
  assert.equal(ci.status, 200, JSON.stringify(ci.data));
  assert.equal((await api('/attendance/me', { token: waiter })).data.required, false);
  assert.equal((await api('/tables', { token: waiter })).status, 200);
});

test('not required on a day off, on approved leave, outside shift hours, or when disabled', async () => {
  const admin = await login('admin', 'admin123');
  const cashier = await login('cashier', '1234');
  const id = (await api('/attendance/me', { token: cashier })).data.employee.id;
  const now = new Date();
  const put = (body) => api(`/employees/${id}`, { method: 'PUT', token: admin, body });
  const required = async () => (await api('/attendance/me', { token: cashier })).data.required;
  const window = { work_start: hhmm(new Date(now.getTime() - 3600e3)), work_end: '23:59', weekly_off: [(now.getDay() + 3) % 7] };

  await put(window);
  if (now.getHours() === 0 && now.getMinutes() < 5) return;
  assert.equal(await required(), true);
  await put({ ...window, weekly_off: [now.getDay()] });
  assert.equal(await required(), false, 'weekly day off');
  await put(window);
  assert.equal(await required(), true);
  const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  await api('/leaves', { method: 'POST', token: admin, body: { employee_id: id, type: 'annual', start_date: d, end_date: d, approve: true } });
  assert.equal(await required(), false, 'approved leave');
  await api('/leaves', { method: 'POST', token: admin, body: { employee_id: id, type: 'annual', start_date: '2099-01-01', end_date: '2099-01-01' } }); // لا أثر
  const lv = (await api('/leaves', { token: admin })).data.rows.find((l) => l.employee_id === id && l.start_date === d);
  await api(`/leaves/${lv.id}`, { method: 'DELETE', token: admin });
  assert.equal(await required(), true);
  await put({ ...window, work_start: '03:00', work_end: '03:30' });
  assert.equal(await required(), false, 'outside shift hours');
  await put(window);
  await api('/settings', { method: 'PUT', token: admin, body: { att_required_before_work: '0' } });
  assert.equal(await required(), false, 'setting disabled');
});
