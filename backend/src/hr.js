// الموارد البشرية: الموظفون، المستندات، الحضور والانصراف، الإجازات، الرواتب
import { get, all, run, getSettings, audit } from './db.js';
import { allow } from './auth.js';
import { bad, notFound, pick, updateSql, round2, today } from './util.js';

const p2 = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const nowStamp = () => { const d = new Date(); return `${fmtDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const stampMin = (ts) => toMin(String(ts).slice(11, 16));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isMonth = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));
const offDays = (emp) => String(emp.weekly_off ?? '').split(',').filter((x) => x !== '').map(Number);

/** كل أيام الشهر حتى اليوم (لا نحسب الأيام المستقبلية) */
function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const t = today();
  const out = [];
  for (let d = 1; d <= last; d++) {
    const ds = `${month}-${p2(d)}`;
    if (ds > t) break;
    out.push(ds);
  }
  return out;
}

function lateMinutes(emp, checkIn) {
  const grace = Number(getSettings().late_grace_minutes) || 0;
  const diff = stampMin(checkIn) - toMin(emp.work_start);
  return diff > grace ? diff : 0;
}

function workedMinutes(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  let m = stampMin(checkOut) - stampMin(checkIn);
  if (String(checkOut).slice(0, 10) > String(checkIn).slice(0, 10)) m += 24 * 60; // وردية تمتد بعد منتصف الليل
  return Math.max(0, m);
}

const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'emergency'];
const DOC_TYPES = ['id', 'passport', 'health', 'contract', 'license', 'other'];
const EMP_FIELDS = ['user_id', 'name', 'job_title', 'department', 'phone', 'email', 'national_id', 'nationality', 'birth_date',
  'address', 'hire_date', 'contract_end', 'basic_salary', 'allowances', 'work_start', 'work_end', 'weekly_off',
  'annual_leave_days', 'emergency_contact', 'bank_iban', 'notes'];
const MAX_FILE = 2.5 * 1024 * 1024;

function employeeOf(user) {
  return get("SELECT * FROM employees WHERE user_id = ? AND status = 'active'", user.id);
}

function requireEmployee(id) {
  const e = get('SELECT * FROM employees WHERE id = ?', id);
  if (!e) throw notFound('الموظف غير موجود');
  return e;
}

/** ملخص شهر لموظف: حضور، غياب، تأخير، ساعات، إجازات */
export function monthSummary(emp, month) {
  const days = monthDays(month);
  const recs = Object.fromEntries(all('SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ?', emp.id, `${month}-%`).map((r) => [r.date, r]));
  const leaves = all("SELECT * FROM leaves WHERE employee_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?",
    emp.id, `${month}-31`, `${month}-01`);
  const leaveType = (d) => leaves.find((l) => l.start_date <= d && l.end_date >= d)?.type;
  const off = offDays(emp);
  const s = { working_days: 0, present: 0, absent: 0, leave: 0, unpaid_leave: 0, late_days: 0, late_minutes: 0, worked_minutes: 0 };
  for (const d of days) {
    if (emp.hire_date && d < emp.hire_date) continue;
    const isOff = off.includes(parseDate(d).getDay());
    const r = recs[d];
    if (r?.status === 'present') {
      s.present++;
      s.late_minutes += r.late_minutes;
      if (r.late_minutes > 0) s.late_days++;
      s.worked_minutes += r.worked_minutes;
      if (!isOff) s.working_days++;
      continue;
    }
    if (isOff) continue;
    s.working_days++;
    const lt = leaveType(d) || (r?.status === 'leave' ? 'annual' : null);
    if (lt) { s.leave++; if (lt === 'unpaid') s.unpaid_leave++; continue; }
    if (d === today() && !r) continue; // اليوم لم ينتهِ بعد
    s.absent++;
  }
  return s;
}

function payslip(emp, month) {
  const st = getSettings();
  const s = monthSummary(emp, month);
  const gross = round2(emp.basic_salary + emp.allowances);
  const daily = gross / 30;
  const hours = Math.max(1, (toMin(emp.work_end) - toMin(emp.work_start)) / 60);
  const perMinute = daily / hours / 60;
  const absence = round2(daily * (s.absent + s.unpaid_leave));
  const late = st.late_deduction === '1' ? round2(perMinute * s.late_minutes) : 0;
  const adj = all('SELECT * FROM payroll_adjustments WHERE employee_id = ? AND month = ? ORDER BY id', emp.id, month);
  const sum = (t) => round2(adj.filter((a) => a.type === t).reduce((x, a) => x + a.amount, 0));
  const bonus = sum('bonus');
  const deduction = sum('deduction');
  const advance = sum('advance');
  const net = round2(Math.max(0, gross + bonus - absence - late - deduction - advance));
  return {
    employee_id: emp.id, name: emp.name, job_title: emp.job_title, department: emp.department, bank_iban: emp.bank_iban,
    basic_salary: emp.basic_salary, allowances: emp.allowances, gross,
    absent_days: s.absent, unpaid_leave_days: s.unpaid_leave, late_minutes: s.late_minutes,
    absence_deduction: absence, late_deduction: late, bonus, deduction, advance, net, adjustments: adj, summary: s,
  };
}

/** يسجّل مسارات الموارد البشرية على الموجّه */
export function hrRoutes(r, changed) {
  // ───── الموظفون ─────
  r.get('/employees', allow('manager'), (req, res) => {
    const st = req.query.status || 'active';
    const t = today();
    const alertDays = Number(getSettings().doc_alert_days) || 30;
    const limit = fmtDate(new Date(Date.now() + alertDays * 864e5));
    res.json(all(`
      SELECT e.*, u.username,
        a.check_in AS today_in, a.check_out AS today_out, a.status AS today_status, a.late_minutes AS today_late,
        (SELECT COUNT(*) FROM employee_documents d WHERE d.employee_id = e.id AND d.expiry_date IS NOT NULL AND d.expiry_date <= ?) AS doc_alerts,
        (SELECT COUNT(*) FROM leaves l WHERE l.employee_id = e.id AND l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ?) AS on_leave
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = ?
      ${st === 'all' ? '' : 'WHERE e.status = ?'}
      ORDER BY e.status, e.name`, limit, t, t, t, ...(st === 'all' ? [] : [st])));
  });

  r.get('/employees/:id', allow('manager'), (req, res) => {
    const e = requireEmployee(Number(req.params.id));
    const u = e.user_id ? get('SELECT username, role FROM users WHERE id = ?', e.user_id) : null;
    e.username = u?.username; e.user_role = u?.role;
    e.documents = all('SELECT id, doc_type, title, number, expiry_date, file_name, file_type, file_size, created_at FROM employee_documents WHERE employee_id = ? ORDER BY expiry_date IS NULL, expiry_date', e.id);
    e.leaves = all('SELECT * FROM leaves WHERE employee_id = ? ORDER BY start_date DESC LIMIT 50', e.id);
    const month = isMonth(req.query.month) ? req.query.month : today().slice(0, 7);
    e.attendance = all('SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? ORDER BY date DESC', e.id, `${month}-%`);
    e.summary = monthSummary(e, month);
    const year = today().slice(0, 4);
    e.annual_leave_used = get("SELECT COALESCE(SUM(days),0) AS d FROM leaves WHERE employee_id = ? AND type = 'annual' AND status = 'approved' AND start_date LIKE ?", e.id, `${year}-%`).d;
    res.json(e);
  });

  function cleanEmployee(body) {
    const f = pick(body, EMP_FIELDS);
    for (const k of ['basic_salary', 'allowances', 'annual_leave_days']) if (k in f) f[k] = Number(f[k]) || 0;
    if ('user_id' in f) f.user_id = f.user_id ? Number(f.user_id) : null;
    for (const k of ['birth_date', 'hire_date', 'contract_end']) if (k in f && f[k] && !isDate(f[k])) throw bad('صيغة التاريخ غير صحيحة');
    for (const k of ['work_start', 'work_end']) if (k in f && !/^\d{2}:\d{2}$/.test(f[k])) throw bad('صيغة الوقت غير صحيحة');
    if ('weekly_off' in f) f.weekly_off = Array.isArray(f.weekly_off) ? f.weekly_off.join(',') : String(f.weekly_off ?? '');
    if (f.user_id && get('SELECT id FROM employees WHERE user_id = ? AND id != ?', f.user_id, Number(body.id) || 0)) {
      throw bad('حساب الدخول مرتبط بموظف آخر');
    }
    return f;
  }

  r.post('/employees', allow('manager'), (req, res) => {
    const f = cleanEmployee(req.body || {});
    if (!f.name) throw bad('أدخل اسم الموظف');
    const keys = Object.keys(f);
    const info = run(`INSERT INTO employees(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => f[k] ?? null));
    const id = Number(info.lastInsertRowid);
    audit(req.user.id, 'employee.create', 'employee', id);
    changed('hr');
    res.status(201).json({ id });
  });

  r.put('/employees/:id', allow('manager'), (req, res) => {
    const id = Number(req.params.id);
    requireEmployee(id);
    const f = cleanEmployee({ ...req.body, id });
    const u = updateSql('employees', f, id);
    if (u) run(u.sql, ...u.params);
    audit(req.user.id, 'employee.update', 'employee', id);
    changed('hr');
    res.json({ ok: true });
  });

  r.post('/employees/:id/status', allow('manager'), (req, res) => {
    const id = Number(req.params.id);
    requireEmployee(id);
    const status = req.body?.status === 'terminated' ? 'terminated' : 'active';
    run('UPDATE employees SET status = ?, terminated_at = ? WHERE id = ?', status, status === 'terminated' ? (req.body?.date || today()) : null, id);
    audit(req.user.id, `employee.${status}`, 'employee', id);
    changed('hr');
    res.json({ ok: true });
  });

  // ───── المستندات ─────
  r.post('/employees/:id/documents', allow('manager'), (req, res) => {
    const id = Number(req.params.id);
    requireEmployee(id);
    const b = req.body || {};
    if (!b.title) throw bad('أدخل اسم المستند');
    if (b.expiry_date && !isDate(b.expiry_date)) throw bad('صيغة تاريخ الانتهاء غير صحيحة');
    let size = null;
    if (b.file_data) {
      if (!/^data:[\w/+.-]+;base64,/.test(b.file_data)) throw bad('ملف غير صالح');
      size = Math.round((b.file_data.length - b.file_data.indexOf(',') - 1) * 0.75);
      if (size > MAX_FILE) throw bad('حجم الملف أكبر من 2.5 ميجابايت');
    }
    const info = run('INSERT INTO employee_documents(employee_id, doc_type, title, number, expiry_date, file_name, file_type, file_size, file_data) VALUES(?,?,?,?,?,?,?,?,?)',
      id, DOC_TYPES.includes(b.doc_type) ? b.doc_type : 'other', b.title, b.number || null, b.expiry_date || null,
      b.file_data ? b.file_name || 'ملف' : null, b.file_data ? b.file_type || null : null, size, b.file_data || null);
    audit(req.user.id, 'employee.document_add', 'employee', id, { title: b.title });
    changed('hr');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.get('/documents/:id/file', allow('manager'), (req, res) => {
    const d = get('SELECT file_name, file_type, file_data FROM employee_documents WHERE id = ?', Number(req.params.id));
    if (!d?.file_data) throw notFound('لا يوجد ملف مرفق');
    res.json(d);
  });
  r.delete('/documents/:id', allow('manager'), (req, res) => {
    const d = get('SELECT employee_id, title FROM employee_documents WHERE id = ?', Number(req.params.id));
    if (!d) throw notFound();
    run('DELETE FROM employee_documents WHERE id = ?', Number(req.params.id));
    audit(req.user.id, 'employee.document_delete', 'employee', d.employee_id, { title: d.title });
    changed('hr');
    res.json({ ok: true });
  });

  r.get('/hr/alerts', allow('manager'), (req, res) => {
    const alertDays = Number(getSettings().doc_alert_days) || 30;
    const limit = fmtDate(new Date(Date.now() + alertDays * 864e5));
    const docs = all(`SELECT d.id, d.title, d.doc_type, d.expiry_date, e.id AS employee_id, e.name
      FROM employee_documents d JOIN employees e ON e.id = d.employee_id
      WHERE e.status = 'active' AND d.expiry_date IS NOT NULL AND d.expiry_date <= ? ORDER BY d.expiry_date`, limit);
    const contracts = all(`SELECT id AS employee_id, name, contract_end FROM employees
      WHERE status = 'active' AND contract_end IS NOT NULL AND contract_end <= ? ORDER BY contract_end`, limit);
    const pendingLeaves = get("SELECT COUNT(*) AS c FROM leaves WHERE status = 'pending'").c;
    res.json({ today: today(), docs, contracts, pending_leaves: pendingLeaves });
  });

  // ───── الحضور والانصراف ─────
  r.get('/attendance/me', (req, res) => {
    const e = employeeOf(req.user);
    if (!e) return res.json({ employee: null });
    const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', e.id, today());
    const month = today().slice(0, 7);
    res.json({
      employee: { id: e.id, name: e.name, job_title: e.job_title, work_start: e.work_start, work_end: e.work_end },
      today: rec || null,
      summary: monthSummary(e, month),
      history: all('SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? ORDER BY date DESC', e.id, `${month}-%`),
    });
  });

  r.post('/attendance/check-in', (req, res) => {
    const e = employeeOf(req.user);
    if (!e) throw bad('حسابك غير مرتبط بملف موظف، راجع المدير');
    const t = today();
    const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', e.id, t);
    if (rec?.check_in) throw bad('سجّلت حضورك اليوم بالفعل');
    const now = nowStamp();
    const late = lateMinutes(e, now);
    if (rec) run("UPDATE attendance SET check_in = ?, status = 'present', late_minutes = ?, source = 'self' WHERE id = ?", now, late, rec.id);
    else run("INSERT INTO attendance(employee_id, date, check_in, late_minutes, source, created_by) VALUES(?,?,?,?, 'self', ?)", e.id, t, now, late, req.user.id);
    changed('attendance');
    res.json({ check_in: now, late_minutes: late });
  });

  r.post('/attendance/check-out', (req, res) => {
    const e = employeeOf(req.user);
    if (!e) throw bad('حسابك غير مرتبط بملف موظف، راجع المدير');
    // آخر حضور مفتوح (يدعم الوردية الممتدة بعد منتصف الليل)
    const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND check_in IS NOT NULL AND check_out IS NULL ORDER BY date DESC LIMIT 1', e.id);
    if (!rec) throw bad('لا يوجد تسجيل حضور مفتوح');
    const now = nowStamp();
    run('UPDATE attendance SET check_out = ?, worked_minutes = ? WHERE id = ?', now, workedMinutes(rec.check_in, now), rec.id);
    changed('attendance');
    res.json({ check_out: now, worked_minutes: workedMinutes(rec.check_in, now) });
  });

  // كشف يومي لكل الموظفين
  r.get('/attendance', allow('manager'), (req, res) => {
    const date = isDate(req.query.date) ? req.query.date : today();
    const dow = parseDate(date).getDay();
    const rows = all(`SELECT e.id AS employee_id, e.name, e.job_title, e.department, e.work_start, e.work_end, e.weekly_off,
        a.id, a.check_in, a.check_out, a.status, a.late_minutes, a.worked_minutes, a.note, a.source,
        (SELECT l.type FROM leaves l WHERE l.employee_id = e.id AND l.status = 'approved' AND l.start_date <= ? AND l.end_date >= ? LIMIT 1) AS leave_type
      FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = ?
      WHERE e.status = 'active' AND (e.hire_date IS NULL OR e.hire_date <= ?)
      ORDER BY e.name`, date, date, date, date);
    for (const r0 of rows) {
      const off = offDays(r0).includes(dow);
      r0.day_status = r0.status === 'present' ? (r0.check_out ? 'done' : 'in')
        : r0.status === 'leave' || r0.leave_type ? 'leave'
        : r0.status === 'absent' ? 'absent'
        : off ? 'off'
        : date < today() ? 'absent' : 'pending';
    }
    const count = (s) => rows.filter((x) => x.day_status === s).length;
    res.json({ date, rows, totals: { in: count('in') + count('done'), absent: count('absent'), leave: count('leave'), off: count('off'), pending: count('pending'), late: rows.filter((x) => x.late_minutes > 0).length } });
  });

  // تسجيل أو تعديل يدوي من المدير
  r.post('/attendance', allow('manager'), (req, res) => {
    const b = req.body || {};
    const e = requireEmployee(Number(b.employee_id));
    const date = isDate(b.date) ? b.date : today();
    const status = ['present', 'absent', 'leave'].includes(b.status) ? b.status : 'present';
    const tm = (v) => (v && /^\d{2}:\d{2}$/.test(v) ? `${date} ${v}:00` : null);
    let ci = status === 'present' ? tm(b.check_in) : null;
    let co = status === 'present' ? tm(b.check_out) : null;
    if (status === 'present' && !ci) throw bad('أدخل وقت الحضور');
    if (ci && co && co < ci) co = `${fmtDate(new Date(parseDate(date).getTime() + 864e5))} ${b.check_out}:00`;
    const late = ci ? lateMinutes(e, ci) : 0;
    const worked = workedMinutes(ci, co);
    run(`INSERT INTO attendance(employee_id, date, check_in, check_out, status, late_minutes, worked_minutes, note, source, created_by)
      VALUES(?,?,?,?,?,?,?,?, 'manager', ?)
      ON CONFLICT(employee_id, date) DO UPDATE SET check_in = excluded.check_in, check_out = excluded.check_out, status = excluded.status,
        late_minutes = excluded.late_minutes, worked_minutes = excluded.worked_minutes, note = excluded.note, source = 'manager', created_by = excluded.created_by`,
      e.id, date, ci, co, status, late, worked, b.note || null, req.user.id);
    audit(req.user.id, 'attendance.manual', 'employee', e.id, { date, status });
    changed('attendance');
    res.json({ ok: true });
  });

  r.delete('/attendance/:id', allow('manager'), (req, res) => {
    run('DELETE FROM attendance WHERE id = ?', Number(req.params.id));
    changed('attendance');
    res.json({ ok: true });
  });

  r.get('/attendance/summary', allow('manager'), (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : today().slice(0, 7);
    const emps = all("SELECT * FROM employees WHERE status = 'active' ORDER BY name");
    res.json({ month, rows: emps.map((e) => ({ employee_id: e.id, name: e.name, job_title: e.job_title, ...monthSummary(e, month) })) });
  });

  // ───── الإجازات ─────
  r.get('/leaves', (req, res) => {
    const isMgr = ['admin', 'manager'].includes(req.user.role);
    const me = employeeOf(req.user);
    if (!isMgr && !me) return res.json({ rows: [], employee: null });
    const where = [];
    const params = [];
    if (!isMgr) { where.push('l.employee_id = ?'); params.push(me.id); }
    if (req.query.status) { where.push('l.status = ?'); params.push(req.query.status); }
    const rows = all(`SELECT l.*, e.name, e.job_title, u.name AS decided_by_name FROM leaves l
      JOIN employees e ON e.id = l.employee_id LEFT JOIN users u ON u.id = l.decided_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.status = 'pending' DESC, l.start_date DESC LIMIT 200`, ...params);
    let balance = null;
    if (me) {
      const used = get("SELECT COALESCE(SUM(days),0) AS d FROM leaves WHERE employee_id = ? AND type = 'annual' AND status = 'approved' AND start_date LIKE ?", me.id, `${today().slice(0, 4)}-%`).d;
      balance = { total: me.annual_leave_days, used, remaining: me.annual_leave_days - used };
    }
    res.json({ rows, employee: me ? { id: me.id, name: me.name } : null, balance });
  });

  r.post('/leaves', (req, res) => {
    const b = req.body || {};
    const isMgr = ['admin', 'manager'].includes(req.user.role);
    const emp = isMgr && b.employee_id ? requireEmployee(Number(b.employee_id)) : employeeOf(req.user);
    if (!emp) throw bad('حسابك غير مرتبط بملف موظف');
    if (!LEAVE_TYPES.includes(b.type)) throw bad('نوع الإجازة غير صحيح');
    if (!isDate(b.start_date) || !isDate(b.end_date) || b.end_date < b.start_date) throw bad('تواريخ الإجازة غير صحيحة');
    const overlap = get("SELECT id FROM leaves WHERE employee_id = ? AND status != 'rejected' AND start_date <= ? AND end_date >= ?", emp.id, b.end_date, b.start_date);
    if (overlap) throw bad('توجد إجازة أخرى في نفس الفترة');
    const days = Math.round((parseDate(b.end_date) - parseDate(b.start_date)) / 864e5) + 1;
    const autoApprove = isMgr && b.approve;
    const info = run(`INSERT INTO leaves(employee_id, type, start_date, end_date, days, reason, status, decided_by, decided_at, created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, emp.id, b.type, b.start_date, b.end_date, days, b.reason || null,
    autoApprove ? 'approved' : 'pending', autoApprove ? req.user.id : null, autoApprove ? nowStamp() : null, req.user.id);
    audit(req.user.id, 'leave.request', 'employee', emp.id, { type: b.type, days });
    changed('hr', 'attendance');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/leaves/:id', allow('manager'), (req, res) => {
    const l = get('SELECT * FROM leaves WHERE id = ?', Number(req.params.id));
    if (!l) throw notFound();
    const status = req.body?.status;
    if (!['approved', 'rejected', 'pending'].includes(status)) throw bad('الحالة غير صحيحة');
    run('UPDATE leaves SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?', status, req.user.id, nowStamp(), l.id);
    audit(req.user.id, `leave.${status}`, 'employee', l.employee_id, { leave: l.id });
    changed('hr', 'attendance');
    res.json({ ok: true });
  });

  r.delete('/leaves/:id', (req, res) => {
    const l = get('SELECT * FROM leaves WHERE id = ?', Number(req.params.id));
    if (!l) throw notFound();
    const isMgr = ['admin', 'manager'].includes(req.user.role);
    const me = employeeOf(req.user);
    if (!isMgr && (!me || me.id !== l.employee_id || l.status !== 'pending')) throw bad('يمكنك إلغاء طلباتك المعلّقة فقط');
    run('DELETE FROM leaves WHERE id = ?', l.id);
    changed('hr', 'attendance');
    res.json({ ok: true });
  });

  // ───── الرواتب ─────
  r.get('/payroll', allow('manager'), (req, res) => {
    const month = isMonth(req.query.month) ? req.query.month : today().slice(0, 7);
    const emps = all("SELECT * FROM employees WHERE status = 'active' OR (terminated_at >= ?) ORDER BY name", `${month}-01`);
    const rows = emps.map((e) => payslip(e, month));
    const total = (k) => round2(rows.reduce((a, x) => a + x[k], 0));
    res.json({ month, rows, totals: { gross: total('gross'), deductions: round2(total('absence_deduction') + total('late_deduction') + total('deduction') + total('advance')), bonus: total('bonus'), net: total('net') } });
  });

  r.post('/payroll/adjustments', allow('manager'), (req, res) => {
    const b = req.body || {};
    requireEmployee(Number(b.employee_id));
    if (!['bonus', 'deduction', 'advance'].includes(b.type)) throw bad('النوع غير صحيح');
    if (!isMonth(b.month)) throw bad('الشهر غير صحيح');
    const amount = round2(b.amount);
    if (!(amount > 0)) throw bad('المبلغ غير صحيح');
    run('INSERT INTO payroll_adjustments(employee_id, month, type, amount, note, created_by) VALUES(?,?,?,?,?,?)',
      Number(b.employee_id), b.month, b.type, amount, b.note || null, req.user.id);
    audit(req.user.id, `payroll.${b.type}`, 'employee', Number(b.employee_id), { amount, month: b.month });
    changed('hr');
    res.status(201).json({ ok: true });
  });
  r.delete('/payroll/adjustments/:id', allow('manager'), (req, res) => {
    run('DELETE FROM payroll_adjustments WHERE id = ?', Number(req.params.id));
    changed('hr');
    res.json({ ok: true });
  });
}

