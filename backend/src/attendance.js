// تسجيل الحضور والانصراف الآمن: التحقق من الموقع والجهاز ومنع التحايل
import bcrypt from 'bcryptjs';
import { get, all, run, getSettings, audit } from './db.js';
import { need, hasPerm } from './perms.js';
import { bad, notFound, today } from './util.js';
import { notify } from './notify.js';
import {
  nowStamp, fmtDate, parseDate, toMin, offDays, isDate, lateMinutes, leaveStats, workedMinutes, monthSummary, rangeSummary, graceOf,
} from './hr.js';

// ───── أدوات ─────
/** المسافة بالمتر بين نقطتين (Haversine) */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const REASONS = {
  no_employee: 'حسابك غير مرتبط بملف موظف، راجع المدير',
  bad_nonce: 'انتهت صلاحية طلب التسجيل، حاول مرة أخرى',
  web_blocked: 'التسجيل متاح من تطبيق الجوال فقط',
  no_device: 'تعذّر التعرّف على الجهاز',
  device_mismatch: 'هذا الجهاز غير معتمد لتسجيل حضورك. التسجيل مسموح من جهازك المعتمد فقط، ويمكن للمدير تغييره',
  no_location: 'يجب السماح بتحديد الموقع لتسجيل الحضور',
  mock_location: 'تم اكتشاف موقع وهمي (Fake GPS). أوقف تطبيقات تزييف الموقع ثم حاول مجدداً',
  emulator: 'لا يمكن التسجيل من محاكي',
  rooted: 'لا يمكن التسجيل من جهاز مكسور الحماية (Root)',
  low_accuracy: 'دقة الموقع ضعيفة، انتقل لمكان مفتوح أو فعّل GPS ثم حاول مجدداً',
  stale_location: 'الموقع قديم، أعد المحاولة',
  out_of_range: 'أنت خارج موقع العمل المحدد',
  too_early: 'لا يمكن تسجيل الحضور قبل موعد الدوام بهذا الوقت',
  already_in: 'سجّلت حضورك اليوم بالفعل',
  not_in: 'لا يوجد تسجيل حضور مفتوح',
  rate_limited: 'محاولات كثيرة، انتظر قليلاً',
};
const SUSPICIOUS = ['mock_location', 'emulator', 'rooted', 'device_mismatch', 'bad_nonce'];

class AttemptError extends Error {
  constructor(reason, extra = {}) {
    super(REASONS[reason] || reason);
    this.status = 400;
    this.reason = reason;
    this.extra = extra;
  }
}

// رموز تحدٍّ لمرة واحدة: تمنع إعادة إرسال طلب قديم وتجبر على قراءة موقع جديد
const nonces = new Map(); // nonce -> { userId, exp }
const attemptsWindow = new Map(); // userId -> [timestamps]
function issueNonce(userId) {
  const now = Date.now();
  for (const [k, v] of nonces) if (v.exp < now) nonces.delete(k);
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes); // متاح في Node 22 والمتصفح
  const n = [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
  nonces.set(n, { userId, exp: now + 120_000 });
  return n;
}
function consumeNonce(n, userId) {
  const v = nonces.get(String(n || ''));
  nonces.delete(String(n || ''));
  return !!v && v.userId === userId && v.exp >= Date.now();
}
function rateLimit(userId) {
  const now = Date.now();
  const arr = (attemptsWindow.get(userId) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  attemptsWindow.set(userId, arr);
  return arr.length > (Number(process.env.ATT_RATE_LIMIT) || 10);
}

const employeeOf = (user) => get("SELECT * FROM employees WHERE user_id = ? AND status = 'active'", user.id);
const locationsFor = (emp) => {
  const locs = all('SELECT * FROM work_locations WHERE active = 1 ORDER BY id');
  let ids = null;
  try { ids = emp.location_ids ? JSON.parse(emp.location_ids) : null; } catch { ids = null; }
  return ids?.length ? locs.filter((l) => ids.includes(l.id)) : locs;
};

/** يتحقق من محاولة التسجيل ويعيد بيانات الموقع المعتمدة أو يرمي AttemptError */
function verify(req, emp, action) {
  const st = getSettings();
  const b = req.body || {};
  const platform = ['android', 'ios', 'web'].includes(b.platform) ? b.platform : 'web';
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const ctx = { platform, device_id: b.device_id ? String(b.device_id).slice(0, 100) : null, lat: num(b.lat), lng: num(b.lng), accuracy: num(b.accuracy) };
  if (ctx.lat === 0 && ctx.lng === 0) { ctx.lat = NaN; ctx.lng = NaN; } // إحداثيات (0،0) = لا موقع

  if (rateLimit(req.user.id)) throw new AttemptError('rate_limited', ctx);
  if (!consumeNonce(b.nonce, req.user.id)) throw new AttemptError('bad_nonce', ctx);
  if (platform === 'web' && st.att_allow_web !== '1') throw new AttemptError('web_blocked', ctx);

  // ربط الجهاز: يمنع تسجيل موظف لزميله من جواله
  if (emp.device_binding) {
    if (!ctx.device_id || ctx.device_id.length < 16) throw new AttemptError('no_device', ctx);
    if (emp.bound_device && emp.bound_device !== ctx.device_id) throw new AttemptError('device_mismatch', ctx);
  }

  // سلامة الجهاز (تُقرأ من التطبيق الأصلي)
  if (st.att_block_mock === '1') {
    if (b.mock === true) throw new AttemptError('mock_location', ctx);
    if (b.emulator === true) throw new AttemptError('emulator', ctx);
    if (b.rooted === true) throw new AttemptError('rooted', ctx);
  }

  const locs = locationsFor(emp);
  const needLocation = emp.location_mode !== 'anywhere' && st.att_require_location === '1' && locs.length > 0;
  let match = null;
  const flags = [];
  if (platform === 'web') flags.push('web');
  if (Number.isFinite(ctx.lat) && Number.isFinite(ctx.lng)) {
    if (Math.abs(ctx.lat) > 90 || Math.abs(ctx.lng) > 180) throw new AttemptError('no_location', ctx);
    // أقرب موقع مسموح
    for (const l of locs) {
      const d = distanceM(ctx.lat, ctx.lng, l.lat, l.lng);
      if (!match || d < match.distance) match = { id: l.id, name: l.name, radius: l.radius_m, distance: Math.round(d) };
    }
    if (match) ctx.distance = match.distance;
  }
  if (needLocation) {
    if (!Number.isFinite(ctx.lat) || !Number.isFinite(ctx.lng)) throw new AttemptError('no_location', ctx);
    const maxAcc = Number(st.att_max_accuracy) || 100;
    if (!Number.isFinite(ctx.accuracy) || ctx.accuracy <= 0 || ctx.accuracy > maxAcc) throw new AttemptError('low_accuracy', ctx);
    // عمر قراءة الموقع (من ساعة الجهاز نفسه، لكشف المواقع المخزّنة)
    if (Number(b.age_ms) > 120_000) throw new AttemptError('stale_location', ctx);
    if (match.distance > match.radius) throw new AttemptError('out_of_range', { ...ctx, nearest: match });
  } else if (emp.location_mode === 'anywhere') flags.push('anywhere');

  // لا يُسمح بالحضور قبل الدوام بأكثر من المدة المحددة (الوقت من الخادم دائماً)
  if (action === 'check_in') {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const start = toMin(emp.work_start);
    const early = Number(emp.early_checkin_minutes ?? 60);
    const before = start - nowMin;
    if (before > early && before < 12 * 60) throw new AttemptError('too_early', { ...ctx, minutes: before });
  }

  return { ...ctx, match: needLocation ? match : null, flags };
}

function recordFailure(req, emp, action, err) {
  const c = err.extra || {};
  const suspicious = SUSPICIOUS.includes(err.reason) ? 1 : 0;
  run(`INSERT INTO attendance_attempts(employee_id, user_id, action, reason, message, lat, lng, accuracy, distance, device_id, platform, suspicious)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, emp?.id ?? null, req.user.id, action, err.reason, err.message,
  Number.isFinite(c.lat) ? c.lat : null, Number.isFinite(c.lng) ? c.lng : null, Number.isFinite(c.accuracy) ? c.accuracy : null,
  c.nearest?.distance ?? c.distance ?? null, c.device_id ?? null, c.platform ?? null, suspicious);
  audit(req.user.id, 'attendance.rejected', 'employee', emp?.id ?? null, { action, reason: err.reason, distance: c.nearest?.distance });
  if (suspicious && emp) {
    notify({
      perms: ['hr.attendance'], roles: ['admin'], type: 'attendance_alert', level: 'warning', link: '/attendance?tab=reports',
      title: `محاولة حضور مشبوهة: ${emp.name}`, body: err.message,
    });
  }
}

/**
 * هل يجب على هذا المستخدم تسجيل الحضور قبل استخدام النظام الآن؟
 * يُطبَّق على من له ملف موظف فقط، في يوم عمل، خارج الإجازة، وضمن وقت الدوام
 * (من قبل الدوام بمدة السماح المبكر حتى نهايته) ولم يسجّل حضوره بعد.
 */
export function attendanceStatus(user) {
  const none = { required: false };
  if (getSettings().att_required_before_work !== '1') return none;
  const emp = employeeOf(user);
  if (!emp) return none;
  const t = today();
  const rec = get('SELECT status, check_in FROM attendance WHERE employee_id = ? AND date = ?', emp.id, t);
  if (rec?.check_in || rec?.status === 'leave' || rec?.status === 'absent') return none;
  // وردية ممتدة بدأت أمس وما زالت مفتوحة
  if (get("SELECT id FROM attendance WHERE employee_id = ? AND check_in IS NOT NULL AND check_out IS NULL AND date = date(?, '-1 day')", emp.id, t)) return none;
  if (offDays(emp).includes(parseDate(t).getDay())) return none;
  if (get("SELECT id FROM leaves WHERE employee_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?", emp.id, t, t)) return none;
  const d = new Date();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const start = toMin(emp.work_start);
  const end = toMin(emp.work_end);
  const early = Number(emp.early_checkin_minutes ?? 60);
  const inWindow = end > start ? nowMin >= start - early && nowMin <= end : nowMin >= start - early;
  return inWindow ? { required: true, employee: emp.name, work_start: emp.work_start } : none;
}

// مسارات مسموحة قبل تسجيل الحضور: الدخول، والحضور نفسه، والإعدادات والإشعارات
const GATE_OPEN = [/^\/auth\//, /^\/attendance\/(me|challenge|check-in|check-out)$/, /^\/settings$/, /^\/notifications/, /^\/push\//, /^\/health$/];

/** يمنع استخدام باقي النظام قبل تسجيل الحضور (حماية من جهة الخادم لا الواجهة فقط) */
export function attendanceGate(req, res, next) {
  if (req.user.role === 'admin' || GATE_OPEN.some((re) => re.test(req.path))) return next();
  if (attendanceStatus(req.user).required) {
    return res.status(403).json({ error: 'سجّل حضورك أولاً قبل البدء بالعمل', reason: 'attendance_required' });
  }
  return next();
}

export function attendanceRoutes(r, changed) {
  // بيانات حضوري + متطلبات التسجيل
  r.get('/attendance/me', (req, res) => {
    const e = employeeOf(req.user);
    if (!e) return res.json({ employee: null });
    const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', e.id, today())
      || get("SELECT * FROM attendance WHERE employee_id = ? AND check_in IS NOT NULL AND check_out IS NULL AND date >= date('now','localtime','-1 day') ORDER BY date DESC LIMIT 1", e.id);
    const month = today().slice(0, 7);
    const st = getSettings();
    const locs = locationsFor(e);
    res.json({
      employee: { id: e.id, name: e.name, job_title: e.job_title, work_start: e.work_start, work_end: e.work_end, grace: graceOf(e) },
      today: rec || null,
      summary: monthSummary(e, month),
      history: all('SELECT * FROM attendance WHERE employee_id = ? AND date LIKE ? ORDER BY date DESC', e.id, `${month}-%`),
      rules: {
        location: e.location_mode !== 'anywhere' && st.att_require_location === '1' && locs.length > 0,
        locations: locs.map((l) => ({ id: l.id, name: l.name, lat: l.lat, lng: l.lng, radius: l.radius_m })),
        device_binding: !!e.device_binding,
        device_bound: !!e.bound_device,
        allow_web: st.att_allow_web === '1',
        max_accuracy: Number(st.att_max_accuracy) || 100,
      },
      server_time: nowStamp(),
      required: attendanceStatus(req.user).required,
    });
  });

  // رمز لمرة واحدة صالح دقيقتين
  r.post('/attendance/challenge', (req, res) => {
    res.json({ nonce: issueNonce(req.user.id), expires_in: 120, server_time: nowStamp() });
  });

  const act = (action) => (req, res) => {
    const e = employeeOf(req.user);
    try {
      if (!e) throw new AttemptError('no_employee');
      const t = today();
      if (action === 'check_in') {
        const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', e.id, t);
        if (rec?.check_in) throw new AttemptError('already_in');
      } else if (!get('SELECT id FROM attendance WHERE employee_id = ? AND check_in IS NOT NULL AND check_out IS NULL ORDER BY date DESC LIMIT 1', e.id)) {
        throw new AttemptError('not_in');
      }
      const v = verify(req, e, action);

      // أول تسجيل يربط الجهاز بالموظف
      if (e.device_binding && !e.bound_device && v.device_id) {
        run("UPDATE employees SET bound_device = ?, bound_device_at = datetime('now','localtime') WHERE id = ?", v.device_id, e.id);
        audit(req.user.id, 'attendance.device_bound', 'employee', e.id, { platform: v.platform });
      }

      const now = nowStamp(); // الوقت من الخادم فقط — تغيير ساعة الجوال لا يؤثر
      const loc = v.match;
      if (action === 'check_in') {
        const late = lateMinutes(e, now);
        const vals = [now, late, Number.isFinite(v.lat) ? v.lat : null, Number.isFinite(v.lng) ? v.lng : null, Number.isFinite(v.accuracy) ? v.accuracy : null,
          v.distance ?? null, loc?.id ?? null, v.device_id, v.platform, JSON.stringify(v.flags)];
        const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', e.id, t);
        if (rec) {
          run(`UPDATE attendance SET check_in = ?, status = 'present', late_minutes = ?, in_lat = ?, in_lng = ?, in_accuracy = ?, in_distance = ?, in_location_id = ?,
            device_id = ?, platform = ?, flags = ?, source = 'self' WHERE id = ?`, ...vals, rec.id);
        } else {
          run(`INSERT INTO attendance(check_in, late_minutes, in_lat, in_lng, in_accuracy, in_distance, in_location_id, device_id, platform, flags, employee_id, date, source, created_by)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'self', ?)`, ...vals, e.id, t, req.user.id);
        }
        audit(req.user.id, 'attendance.check_in', 'employee', e.id, { late, location: loc?.name, distance: v.distance, platform: v.platform });
        changed('attendance');
        return res.json({ check_in: now, late_minutes: late, location: loc?.name || null, distance: v.distance ?? null });
      }

      const rec = get('SELECT * FROM attendance WHERE employee_id = ? AND check_in IS NOT NULL AND check_out IS NULL ORDER BY date DESC LIMIT 1', e.id);
      const worked = workedMinutes(rec.check_in, now);
      const ls = leaveStats(e, rec.date, now);
      const flags = [...new Set([...(rec.flags ? JSON.parse(rec.flags) : []), ...v.flags])];
      if (rec.device_id && v.device_id && rec.device_id !== v.device_id) flags.push('device_changed');
      run(`UPDATE attendance SET check_out = ?, worked_minutes = ?, early_leave_minutes = ?, overtime_minutes = ?,
        out_lat = ?, out_lng = ?, out_accuracy = ?, out_distance = ?, out_location_id = ?, flags = ? WHERE id = ?`,
      now, worked, ls.early, ls.overtime, Number.isFinite(v.lat) ? v.lat : null, Number.isFinite(v.lng) ? v.lng : null,
      Number.isFinite(v.accuracy) ? v.accuracy : null, v.distance ?? null, loc?.id ?? null, JSON.stringify(flags), rec.id);
      audit(req.user.id, 'attendance.check_out', 'employee', e.id, { worked, early: ls.early, overtime: ls.overtime });
      changed('attendance');
      return res.json({ check_out: now, worked_minutes: worked, early_leave_minutes: ls.early, overtime_minutes: ls.overtime });
    } catch (err) {
      if (err instanceof AttemptError) {
        if (!['already_in', 'not_in', 'no_employee'].includes(err.reason)) recordFailure(req, e, action, err);
        return res.status(400).json({ error: err.message, reason: err.reason, nearest: err.extra?.nearest || null });
      }
      throw err;
    }
  };
  r.post('/attendance/check-in', act('check_in'));
  r.post('/attendance/check-out', act('check_out'));

  // ───── مواقع العمل ─────
  r.get('/work-locations', need('hr.attendance', 'hr.employees'), (req, res) => {
    res.json(all(`SELECT l.*, (SELECT COUNT(*) FROM attendance a WHERE a.in_location_id = l.id AND a.date = date('now','localtime')) AS today_count
      FROM work_locations l WHERE l.active = 1 ORDER BY l.id`));
  });
  const cleanLoc = (b) => {
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    const radius = Math.round(Number(b.radius_m));
    if (!String(b.name || '').trim()) throw bad('أدخل اسم الموقع');
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw bad('حدد الموقع على الخريطة');
    if (!(radius >= 20 && radius <= 2000)) throw bad('نصف القطر بين 20 و 2000 متر');
    return { name: String(b.name).trim(), lat, lng, radius };
  };
  r.post('/work-locations', need('hr.attendance'), (req, res) => {
    const l = cleanLoc(req.body || {});
    const info = run('INSERT INTO work_locations(name, lat, lng, radius_m) VALUES(?,?,?,?)', l.name, l.lat, l.lng, l.radius);
    audit(req.user.id, 'attendance.location_create', 'location', Number(info.lastInsertRowid), { name: l.name, radius: l.radius });
    changed('attendance');
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/work-locations/:id', need('hr.attendance'), (req, res) => {
    const l = cleanLoc(req.body || {});
    run('UPDATE work_locations SET name = ?, lat = ?, lng = ?, radius_m = ? WHERE id = ?', l.name, l.lat, l.lng, l.radius, Number(req.params.id));
    audit(req.user.id, 'attendance.location_update', 'location', Number(req.params.id), { name: l.name, radius: l.radius });
    changed('attendance');
    res.json({ ok: true });
  });
  r.delete('/work-locations/:id', need('hr.attendance'), (req, res) => {
    run('UPDATE work_locations SET active = 0 WHERE id = ?', Number(req.params.id));
    audit(req.user.id, 'attendance.location_delete', 'location', Number(req.params.id));
    changed('attendance');
    res.json({ ok: true });
  });

  // ───── إدارة أجهزة وحسابات الموظفين ─────
  r.post('/employees/:id/reset-device', need('hr.attendance', 'hr.employees'), (req, res) => {
    const e = get('SELECT id, name FROM employees WHERE id = ?', Number(req.params.id));
    if (!e) throw notFound();
    run('UPDATE employees SET bound_device = NULL, bound_device_at = NULL WHERE id = ?', e.id);
    audit(req.user.id, 'attendance.device_reset', 'employee', e.id);
    changed('hr');
    res.json({ ok: true });
  });
  // إنشاء حساب دخول للموظف (دور "موظف": حضور وإجازات فقط)
  r.post('/employees/:id/account', need('hr.employees'), (req, res) => {
    const e = get('SELECT * FROM employees WHERE id = ?', Number(req.params.id));
    if (!e) throw notFound();
    if (e.user_id) throw bad('للموظف حساب بالفعل');
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) throw bad('اسم المستخدم: 3 أحرف إنجليزية أو أرقام على الأقل');
    if (password.length < 4) throw bad('كلمة المرور قصيرة (4 أحرف على الأقل)');
    if (get('SELECT id FROM users WHERE username = ?', username)) throw bad('اسم المستخدم مستخدم مسبقاً');
    const role = hasPerm(req.user, 'users.manage') && ['cashier', 'waiter', 'kitchen', 'staff'].includes(req.body?.role) ? req.body.role : 'staff';
    const info = run('INSERT INTO users(name, username, password_hash, role) VALUES(?,?,?,?)', e.name, username, bcrypt.hashSync(password, 10), role);
    run('UPDATE employees SET user_id = ? WHERE id = ?', Number(info.lastInsertRowid), e.id);
    audit(req.user.id, 'user.create', 'user', Number(info.lastInsertRowid), { name: e.name, for_employee: e.id, role });
    changed('hr');
    res.status(201).json({ user_id: Number(info.lastInsertRowid), username, role });
  });

  // ───── تقارير الحضور ─────
  r.get('/attendance/report', need('hr.attendance'), (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : `${today().slice(0, 7)}-01`;
    const to = isDate(req.query.to) ? req.query.to : today();
    if (to < from) throw bad('نطاق التاريخ غير صحيح');
    const emps = all(`SELECT * FROM employees WHERE status = 'active' ${req.query.employee_id ? 'AND id = ?' : ''} ORDER BY name`, ...(req.query.employee_id ? [Number(req.query.employee_id)] : []));
    const rows = emps.map((e) => ({ employee_id: e.id, name: e.name, job_title: e.job_title, department: e.department, ...rangeSummary(e, from, to) }));
    // نسبة الحضور اليومية
    const days = [];
    for (let d = parseDate(from); fmtDate(d) <= to && fmtDate(d) <= today(); d.setDate(d.getDate() + 1)) days.push(fmtDate(d));
    const daily = days.map((d) => {
      const c = get(`SELECT COUNT(*) AS present, COALESCE(SUM(late_minutes > 0), 0) AS late FROM attendance a JOIN employees e ON e.id = a.employee_id
        WHERE a.date = ? AND a.status = 'present' AND e.status = 'active'`, d);
      return { date: d, present: c.present, late: c.late };
    });
    const attempts = all(`SELECT t.*, e.name FROM attendance_attempts t LEFT JOIN employees e ON e.id = t.employee_id
      WHERE date(t.created_at) BETWEEN ? AND ? ${req.query.employee_id ? 'AND t.employee_id = ?' : ''} ORDER BY t.id DESC LIMIT 200`, from, to, ...(req.query.employee_id ? [Number(req.query.employee_id)] : []));
    const flagged = all(`SELECT a.id, a.date, a.check_in, a.check_out, a.flags, a.platform, a.in_distance, e.name FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN ? AND ? AND a.flags IS NOT NULL AND a.flags != '[]' ORDER BY a.date DESC LIMIT 200`, from, to);
    const sum = (k) => rows.reduce((a, x) => a + x[k], 0);
    const wd = sum('working_days');
    res.json({
      from, to, rows, daily, attempts, flagged,
      totals: {
        employees: rows.length, present: sum('present'), absent: sum('absent'), late_days: sum('late_days'), late_minutes: sum('late_minutes'),
        early_leave_minutes: sum('early_leave_minutes'), overtime_minutes: sum('overtime_minutes'), worked_minutes: sum('worked_minutes'),
        rate: wd ? Math.round((sum('present') / wd) * 100) : 100,
        rejected: attempts.length, suspicious: attempts.filter((a) => a.suspicious).length,
      },
    });
  });
}

