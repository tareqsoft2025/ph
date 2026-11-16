import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 3998;
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
const month = () => new Date().toISOString().slice(0, 7);

before(async () => {
  proc = spawn(process.execPath, ['--no-warnings', 'src/server.js'], { env: { ...process.env, PORT, DB_PATH: ':memory:' } });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => proc.kill());

test('employees: list, profile, create, documents, permissions', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  const list = (await api('/employees', { token: admin })).data;
  assert.ok(list.length >= 6);
  assert.equal((await api('/employees', { token: waiter })).status, 403);

  const created = await api('/employees', { method: 'POST', token: admin, body: {
    name: 'موظف اختبار', job_title: 'مساعد', basic_salary: 3000, allowances: 0, work_start: '09:00', work_end: '17:00', weekly_off: [5, 6],
  } });
  assert.equal(created.status, 201);
  const id = created.data.id;
  const doc = await api(`/employees/${id}/documents`, { method: 'POST', token: admin, body: {
    title: 'الإقامة', doc_type: 'id', expiry_date: '2000-01-01', file_name: 'a.txt', file_type: 'text/plain', file_data: 'data:text/plain;base64,aGVsbG8=',
  } });
  assert.equal(doc.status, 201);
  const prof = (await api(`/employees/${id}`, { token: admin })).data;
  assert.equal(prof.documents.length, 1);
  assert.equal(prof.documents[0].file_data, undefined, 'profile must not include file payloads');
  const file = (await api(`/documents/${doc.data.id}/file`, { token: admin })).data;
  assert.equal(file.file_data, 'data:text/plain;base64,aGVsbG8=');
  const alerts = (await api('/hr/alerts', { token: admin })).data;
  assert.ok(alerts.docs.some((d) => d.employee_id === id), 'expired document should alert');
});

test('attendance: self check-in/out, double check-in blocked, daily sheet and manual entry', async () => {
  const admin = await login('admin', 'admin123');
  const cashier = await login('cashier', '1234');
  const me = (await api('/attendance/me', { token: cashier })).data;
  assert.ok(me.employee, 'cashier is linked to an employee');
  const ci = await api('/attendance/check-in', { method: 'POST', token: cashier });
  assert.equal(ci.status, 200, JSON.stringify(ci.data));
  assert.equal((await api('/attendance/check-in', { method: 'POST', token: cashier })).status, 400);
  const co = await api('/attendance/check-out', { method: 'POST', token: cashier });
  assert.equal(co.status, 200);
  // admin has no employee file
  assert.equal((await api('/attendance/check-in', { method: 'POST', token: admin })).status, 400);

  const sheet = (await api('/attendance', { token: admin })).data;
  const row = sheet.rows.find((r) => r.employee_id === me.employee.id);
  assert.equal(row.day_status, 'done');

  // manual: 30 min late on a past day, worked 8h
  const emp = sheet.rows.find((r) => r.employee_id !== me.employee.id);
  const d = new Date(); d.setDate(d.getDate() - 1);
  const date = d.toISOString().slice(0, 10);
  const [h, m] = emp.work_start.split(':').map(Number);
  const inT = `${String(h).padStart(2, '0')}:${String(m + 30).padStart(2, '0')}`;
  const outT = `${String(h + 8).padStart(2, '0')}:${String(m + 30).padStart(2, '0')}`;
  const man = await api('/attendance', { method: 'POST', token: admin, body: { employee_id: emp.employee_id, date, check_in: inT, check_out: outT } });
  assert.equal(man.status, 200, JSON.stringify(man.data));
  const day = (await api(`/attendance?date=${date}`, { token: admin })).data.rows.find((r) => r.employee_id === emp.employee_id);
  assert.equal(day.late_minutes, 30);
  assert.equal(day.worked_minutes, 480);
});

test('leaves: request, overlap blocked, approve; payroll with adjustments', async () => {
  const admin = await login('admin', 'admin123');
  const waiter = await login('waiter', '1234');
  const req1 = await api('/leaves', { method: 'POST', token: waiter, body: { type: 'annual', start_date: '2099-01-10', end_date: '2099-01-12', reason: 'x' } });
  assert.equal(req1.status, 201);
  assert.equal((await api('/leaves', { method: 'POST', token: waiter, body: { type: 'sick', start_date: '2099-01-11', end_date: '2099-01-11' } })).status, 400);
  assert.equal((await api(`/leaves/${req1.data.id}`, { method: 'PATCH', token: waiter, body: { status: 'approved' } })).status, 403);
  assert.equal((await api(`/leaves/${req1.data.id}`, { method: 'PATCH', token: admin, body: { status: 'approved' } })).status, 200);
  const mine = (await api('/leaves', { token: waiter })).data;
  assert.ok(mine.rows.every((l) => l.employee_id === mine.employee.id), 'waiter sees only own leaves');
  assert.equal(mine.rows.find((l) => l.id === req1.data.id).status, 'approved');

  const pay = (await api(`/payroll?month=${month()}`, { token: admin })).data;
  const row = pay.rows[0];
  assert.equal(row.gross, row.basic_salary + row.allowances);
  const before = row.net;
  await api('/payroll/adjustments', { method: 'POST', token: admin, body: { employee_id: row.employee_id, month: month(), type: 'bonus', amount: 100 } });
  const after = (await api(`/payroll?month=${month()}`, { token: admin })).data.rows.find((r) => r.employee_id === row.employee_id);
  assert.equal(after.net, Math.round((before + 100) * 100) / 100);
  assert.equal(after.bonus, 100);
});
