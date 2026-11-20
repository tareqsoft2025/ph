import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LogIn, LogOut, Pencil, ChevronRight, ChevronLeft, Fingerprint, UserRoundX, CircleCheck, MapPin, ShieldCheck, Smartphone,
  LoaderCircle, TriangleAlert, Clock, Plus, Trash2, Crosshair, Download, ShieldAlert, Globe, Save, X,
} from 'lucide-react';
import { api, isNative } from '../api.js';
import { useApp, useData, useAction, useToast, has, Loading, Empty, PageHead, Field, hm, timeOf, todayStr, monthStr, WEEKDAYS } from '../lib.jsx';
import AttendanceForm from '../components/AttendanceForm.jsx';
import GeoMap from '../components/GeoMap.jsx';
import { punch, readPosition } from '../attendanceClient.js';

const DAY_STATUS = {
  in: ['badge-ok', 'داخل الدوام'], done: ['', 'انصرف'], absent: ['badge-err', 'غائب'],
  leave: ['badge-info', 'إجازة'], off: ['', 'راحة'], pending: ['badge-warn', 'لم يسجّل بعد'],
};
const REASON_LABEL = {
  bad_nonce: 'طلب منتهي / مكرر', web_blocked: 'من المتصفح (ممنوع)', no_device: 'جهاز غير معروف', device_mismatch: 'جهاز غير معتمد',
  no_location: 'بدون موقع', mock_location: 'موقع وهمي', emulator: 'محاكي', rooted: 'جهاز Root', low_accuracy: 'دقة ضعيفة',
  stale_location: 'موقع قديم', out_of_range: 'خارج الموقع', too_early: 'قبل الموعد', rate_limited: 'محاولات كثيرة',
};
const FLAG_LABEL = { web: 'متصفح', anywhere: 'أي مكان', device_changed: 'جهاز مختلف للانصراف' };

const shiftDate = (d, n) => {
  const x = new Date(`${d}T00:00`);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const fmtDist = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} كم` : `${Math.round(m)} م`);

/** ساعة مبنية على وقت الخادم (تغيير ساعة الجوال لا يؤثر) */
function useServerClock(serverTime) {
  const offset = useRef(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (serverTime) offset.current = new Date(serverTime.replace(' ', 'T')).getTime() - Date.now();
  }, [serverTime]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return new Date(Date.now() + offset.current);
}

export default function Attendance() {
  const { user } = useApp();
  const isMgr = has(user, 'hr.attendance');
  return (
    <div>
      <PageHead title="الحضور والانصراف" sub={isMgr ? 'سجّل حضورك، وتابع حضور الفريق ومواقع التسجيل والتقارير' : 'سجّل حضورك وانصرافك من موقع العمل'} />
      <MyCard />
      {isMgr && <TeamView />}
    </div>
  );
}

// ═════════════ بطاقة تسجيلي ═════════════
export function MyCard({ onDone, compact }) {
  const me = useData('/attendance/me', ['attendance']);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(null);
  const [fail, setFail] = useState(null);
  const [lastPos, setLastPos] = useState(null);
  const now = useServerClock(me.data?.server_time);

  if (me.loading && !me.data) return <Loading />;
  const d = me.data;
  if (!d?.employee) {
    return (
      <section className="card punch-card punch-none">
        <Fingerprint size={28} aria-hidden />
        <p className="muted">حسابك غير مرتبط بملف موظف. يمكن للمدير ربطه أو إنشاء حساب لك من صفحة الموظفين.</p>
      </section>
    );
  }

  const t = d.today;
  const inNow = t?.check_in && !t?.check_out;
  const done = t?.check_in && t?.check_out;
  const rules = d.rules;
  const webBlocked = !isNative && !rules.allow_web;

  async function go(action) {
    setBusy(true);
    setFail(null);
    try {
      const r = await punch(action, { needLocation: rules.location }, setStep);
      toast(action === 'check-in' ? `تم تسجيل الحضور${r.location ? ` · ${r.location}` : ''}` : 'تم تسجيل الانصراف');
      me.reload();
      onDone?.();
    } catch (e) {
      setFail({ message: e.message, reason: e.data?.reason || e.reason, nearest: e.data?.nearest });
      if (e.data?.reason === 'out_of_range' || e.data?.reason === 'low_accuracy') readPosition().then(setLastPos).catch(() => {});
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  const STEPS = [['device', 'التحقق من الجهاز', Smartphone], ['location', 'تحديد موقعك', MapPin], ['verify', 'التحقق من الخادم', ShieldCheck]];
  const s = d.summary;

  return (
    <>
      <section className="card punch-card">
        <div className="punch-clock">
          <span className="muted small">{WEEKDAYS[now.getDay()]} · <bdi dir="ltr">{now.toLocaleDateString('en-CA')}</bdi></span>
          <strong dir="ltr">{now.toLocaleTimeString('en-GB')}</strong>
          <span className="muted small">دوامك <bdi dir="ltr">{d.employee.work_start} – {d.employee.work_end}</bdi> · سماحية {d.employee.grace} د</span>
          <span className="punch-server"><Clock size={12} aria-hidden /> الوقت من الخادم ولا يتأثر بساعة جهازك</span>
        </div>
        <div className="punch-status">
          {!t?.check_in && <p>لم تسجّل حضورك اليوم بعد.</p>}
          {inNow && <p>حضرت الساعة <strong>{timeOf(t.check_in)}</strong>{t.late_minutes ? <span className="badge badge-warn">متأخر {t.late_minutes} د</span> : <span className="badge badge-ok">في الموعد</span>}</p>}
          {done && <p><CircleCheck size={18} className="text-ok" aria-hidden /> حضور {timeOf(t.check_in)} · انصراف {timeOf(t.check_out)} · {hm(t.worked_minutes)} ساعة</p>}

          {busy ? (
            <ol className="punch-steps" aria-live="polite">
              {STEPS.map(([k, label, Icon], i) => {
                const idx = STEPS.findIndex((x) => x[0] === step);
                const state = i < idx ? 'done' : i === idx ? 'now' : '';
                return <li key={k} className={state}>{state === 'now' ? <LoaderCircle className="spin" size={16} /> : <Icon size={16} />} {label}</li>;
              })}
            </ol>
          ) : webBlocked ? (
            <p className="alert alert-warn"><Smartphone size={16} /> التسجيل متاح من تطبيق الجوال فقط</p>
          ) : (
            <>
              {!t?.check_in && <button className="btn btn-primary btn-lg punch-btn" onClick={() => go('check-in')}><LogIn size={20} /> تسجيل الحضور</button>}
              {inNow && <button className="btn btn-lg punch-btn punch-out" onClick={() => go('check-out')}><LogOut size={20} /> تسجيل الانصراف</button>}
            </>
          )}
          <div className="punch-rules">
            {rules.location ? <span><MapPin size={13} aria-hidden /> من: {rules.locations.map((l) => l.name).join('، ')}</span> : <span><Globe size={13} aria-hidden /> من أي مكان</span>}
            {rules.device_binding && <span><Smartphone size={13} aria-hidden /> {rules.device_bound ? 'مرتبط بجهازك المعتمد' : 'سيُعتمد هذا الجهاز عند أول تسجيل'}</span>}
          </div>
        </div>
      </section>

      {fail && (
        <section className="card punch-fail" role="alert">
          <div className="punch-fail-head">
            <ShieldAlert size={22} aria-hidden />
            <div>
              <strong>لم يتم التسجيل</strong>
              <p>{fail.message}</p>
              {fail.nearest && <p className="muted small">أقرب موقع: {fail.nearest.name} · تبعد عنه {fmtDist(fail.nearest.distance)} (المسموح {fmtDist(fail.nearest.radius)})</p>}
            </div>
            <button className="icon-btn" onClick={() => setFail(null)} aria-label="إغلاق"><X size={18} /></button>
          </div>
          {rules.location && (fail.reason === 'out_of_range' || fail.reason === 'low_accuracy') && (
            <GeoMap height={220} circles={rules.locations} point={lastPos} />
          )}
        </section>
      )}

      {!compact && <div className="stats">
        <div className="stat"><span>أيام الحضور هذا الشهر</span><strong>{s.present}</strong></div>
        <div className="stat"><span>الغياب</span><strong className={s.absent ? 'text-err' : ''}>{s.absent}</strong></div>
        <div className="stat"><span>إجمالي التأخير</span><strong className={s.late_minutes ? 'text-warn' : ''}>{hm(s.late_minutes)}</strong></div>
        <div className="stat"><span>ساعات العمل</span><strong>{hm(s.worked_minutes)}</strong></div>
      </div>}

      {!compact && d.history.length > 0 && (
        <details className="card history">
          <summary>سجلي هذا الشهر ({d.history.length} يوم)</summary>
          <div className="table-wrap flat">
            <table className="data">
              <thead><tr><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>التأخير</th><th>الساعات</th></tr></thead>
              <tbody>
                {d.history.map((a) => (
                  <tr key={a.id}>
                    <td>{a.date} <span className="muted small">{WEEKDAYS[new Date(`${a.date}T00:00`).getDay()]}</span></td>
                    <td>{a.status === 'present' ? timeOf(a.check_in) : a.status === 'absent' ? 'غياب' : 'إجازة'}</td>
                    <td>{timeOf(a.check_out) || '—'}</td>
                    <td>{a.late_minutes ? <span className="text-warn">{a.late_minutes} د</span> : '—'}</td>
                    <td>{a.worked_minutes ? hm(a.worked_minutes) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

// ═════════════ إدارة حضور الفريق ═════════════
function TeamView() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'day';
  const setTab = (t) => setParams(t === 'day' ? {} : { tab: t }, { replace: true });
  const TABS = [['day', 'الكشف اليومي'], ['month', 'الملخص الشهري'], ['activation', 'طلبات التفعيل'], ['reports', 'التقارير'], ['locations', 'مواقع الحضور']];
  return (
    <section className="team">
      <div className="tabs" role="tablist">
        {TABS.map(([k, v]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{v}</button>)}
      </div>
      {tab === 'day' && <DaySheet />}
      {tab === 'month' && <MonthSheet />}
      {tab === 'activation' && <Activation />}
      {tab === 'reports' && <Reports />}
      {tab === 'locations' && <Locations />}
    </section>
  );
}

function DaySheet() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayStr());
  const day = useData(`/attendance?date=${date}`, ['attendance', 'hr'], [date]);
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="filters">
        <div className="date-nav">
          <button className="icon-btn" onClick={() => setDate(shiftDate(date, -1))} aria-label="اليوم السابق"><ChevronRight size={18} /></button>
          <input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} aria-label="التاريخ" />
          <button className="icon-btn" onClick={() => setDate(shiftDate(date, 1))} disabled={date >= todayStr()} aria-label="اليوم التالي"><ChevronLeft size={18} /></button>
        </div>
        {day.data && (
          <div className="legend-row">
            <span className="legend"><i className="dot free" /> حاضر {day.data.totals.in}</span>
            <span className="legend"><i className="dot reserved" /> متأخر {day.data.totals.late}</span>
            <span className="legend"><i className="dot occupied" /> غائب {day.data.totals.absent}</span>
            <span className="legend"><i className="dot info" /> إجازة {day.data.totals.leave}</span>
          </div>
        )}
      </div>
      {day.loading ? <Loading /> : !day.data?.rows.length ? <Empty icon={UserRoundX} text="لا يوجد موظفون" /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>الموظف</th><th>الدوام</th><th>الحضور</th><th>الانصراف</th><th>التأخير</th><th>انصراف مبكر</th><th>الساعات</th><th>الموقع</th><th>الحالة</th><th /></tr></thead>
            <tbody>
              {day.data.rows.map((r) => {
                const flags = r.flags ? JSON.parse(r.flags) : [];
                return (
                  <tr key={r.employee_id}>
                    <td><button className="link-btn" onClick={() => navigate(`/employees/${r.employee_id}`)}>{r.name}</button><div className="muted small">{r.job_title}</div></td>
                    <td dir="ltr" className="cell-start small">{r.work_start}–{r.work_end}</td>
                    <td>{timeOf(r.check_in) || '—'}</td>
                    <td>{timeOf(r.check_out) || '—'}</td>
                    <td>{r.late_minutes ? <span className="text-warn">{r.late_minutes} د</span> : '—'}</td>
                    <td>{r.early_leave_minutes ? <span className="text-warn">{r.early_leave_minutes} د</span> : '—'}</td>
                    <td>{r.worked_minutes ? hm(r.worked_minutes) : '—'}</td>
                    <td className="small">
                      {r.location_name ? <span className="meta-line"><MapPin size={12} /> {r.location_name}{r.in_distance != null ? ` · ${fmtDist(r.in_distance)}` : ''}</span> : r.source === 'manager' ? 'يدوي' : '—'}
                      {flags.map((f) => <span key={f} className="badge">{FLAG_LABEL[f] || f}</span>)}
                    </td>
                    <td><span className={`badge ${DAY_STATUS[r.day_status][0]}`}>{DAY_STATUS[r.day_status][1]}</span></td>
                    <td className="cell-end"><button className="icon-btn" onClick={() => setEdit({ ...r, date, id: r.id })} aria-label={`تعديل حضور ${r.name}`}><Pencil size={15} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {edit && <AttendanceForm rec={edit} name={edit.name} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); day.reload(); }} />}
    </>
  );
}

function MonthSheet() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(monthStr());
  const sum = useData(`/attendance/summary?month=${month}`, ['attendance', 'hr'], [month]);
  return (
    <>
      <div className="filters"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" /></div>
      {sum.loading ? <Loading /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>الموظف</th><th>أيام العمل</th><th>حضور</th><th>غياب</th><th>إجازات</th><th>أيام التأخير</th><th>إجمالي التأخير</th><th>انصراف مبكر</th><th>إضافي</th><th>ساعات العمل</th></tr></thead>
            <tbody>
              {(sum.data?.rows || []).map((r) => (
                <tr key={r.employee_id} className="clickable" onClick={() => navigate(`/employees/${r.employee_id}`)}>
                  <td><strong>{r.name}</strong><div className="muted small">{r.job_title}</div></td>
                  <td>{r.working_days}</td><td>{r.present}</td>
                  <td className={r.absent ? 'text-err' : ''}>{r.absent}</td><td>{r.leave}</td>
                  <td className={r.late_days ? 'text-warn' : ''}>{r.late_days}</td><td>{hm(r.late_minutes)}</td>
                  <td>{hm(r.early_leave_minutes)}</td><td>{hm(r.overtime_minutes)}</td><td>{hm(r.worked_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ═════════════ تقارير الحضور ═════════════
const ACT_ST = { pending: ['بانتظار القرار', 'badge-warn'], approved: ['مفعّل', 'badge-ok'], denied: ['مرفوض', 'badge-err'] };
/** طلبات تفعيل الحساب: يوافق المدير العام لمن تعذّر عليه تسجيل الحضور */
function Activation() {
  const { data, loading, reload } = useData('/attendance/activation-requests', ['attendance']);
  const [run] = useAction();
  const decide = async (o, kind) => {
    const note = kind === 'deny' ? window.prompt('سبب الرفض (اختياري)') : '';
    if (note === null) return;
    if (await run(() => api(`/attendance/activation-requests/${o.id}/${kind}`, { method: 'POST', body: { note } }), kind === 'approve' ? 'فُعّل الحساب لهذا اليوم' : 'رُفض الطلب')) reload();
  };
  if (loading) return <Loading />;
  const rows = data || [];
  if (!rows.length) return <Empty text="لا توجد طلبات تفعيل. تظهر هنا حين يتعذّر على موظف تسجيل حضوره." />;
  return (
    <div className="act-list">
      {rows.map((o) => { const [label, cls] = ACT_ST[o.status] || ACT_ST.pending; return (
        <article key={o.id} className={`act-card s-${o.status}`}>
          <header><strong>{o.employee_name}</strong><span className={`badge ${cls}`}>{label}</span></header>
          <p>{o.reason}</p>
          <small className="muted">{o.job_title || ''} · طُلب {String(o.created_at).slice(5, 16)}{o.decided_name ? ` · قرار ${o.decided_name}` : ''}{o.note ? ` · ${o.note}` : ''}</small>
          {o.status === 'pending' && <div className="act-btns"><button className="btn btn-primary" onClick={() => decide(o, 'approve')}>تفعيل الحساب اليوم</button><button className="btn btn-danger-ghost" onClick={() => decide(o, 'deny')}>رفض</button></div>}
        </article>); })}
    </div>
  );
}

function Reports() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(`${monthStr()}-01`);
  const [to, setTo] = useState(todayStr());
  const [emp, setEmp] = useState('');
  const emps = useData('/employees');
  const q = new URLSearchParams({ from, to, ...(emp ? { employee_id: emp } : {}) });
  const { data, loading } = useData(`/attendance/report?${q}`, ['attendance'], [from, to, emp]);

  const preset = (days) => { setFrom(shiftDate(todayStr(), -days + 1)); setTo(todayStr()); };

  function exportCsv() {
    const head = ['الموظف', 'الوظيفة', 'أيام العمل', 'حضور', 'غياب', 'إجازات', 'نسبة الحضور %', 'أيام التأخير', 'دقائق التأخير', 'دقائق الانصراف المبكر', 'دقائق إضافية', 'ساعات العمل', 'سجلات مشبوهة'];
    const lines = data.rows.map((r) => [r.name, r.job_title || '', r.working_days, r.present, r.absent, r.leave, r.rate, r.late_days, r.late_minutes, r.early_leave_minutes, r.overtime_minutes, (r.worked_minutes / 60).toFixed(1), r.flagged]);
    const csv = '﻿' + [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `attendance-${from}-${to}.csv`;
    a.click();
  }

  const maxPresent = Math.max(1, ...(data?.daily || []).map((d) => d.present));

  return (
    <>
      <div className="filters">
        <div className="seg">
          <button onClick={() => preset(1)}>اليوم</button>
          <button onClick={() => preset(7)}>7 أيام</button>
          <button onClick={() => preset(30)}>30 يوم</button>
        </div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من" />
        <input type="date" value={to} max={todayStr()} onChange={(e) => setTo(e.target.value)} aria-label="إلى" />
        <select value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="الموظف">
          <option value="">كل الموظفين</option>
          {(emps.data || []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {data && <button className="btn" onClick={exportCsv}><Download size={16} /> تصدير Excel</button>}
      </div>

      {loading || !data ? <Loading /> : (
        <>
          <div className="stats">
            <div className="stat primary"><span>نسبة الحضور</span><strong>{data.totals.rate}%</strong></div>
            <div className="stat"><span>أيام الحضور</span><strong>{data.totals.present}</strong></div>
            <div className="stat"><span>أيام الغياب</span><strong className={data.totals.absent ? 'text-err' : ''}>{data.totals.absent}</strong></div>
            <div className="stat"><span>إجمالي التأخير</span><strong className="text-warn">{hm(data.totals.late_minutes)}</strong></div>
            <div className="stat"><span>انصراف مبكر</span><strong>{hm(data.totals.early_leave_minutes)}</strong></div>
            <div className="stat"><span>عمل إضافي</span><strong className="text-ok">{hm(data.totals.overtime_minutes)}</strong></div>
            <div className="stat"><span>محاولات مرفوضة</span><strong className={data.totals.rejected ? 'text-warn' : ''}>{data.totals.rejected}</strong></div>
            <div className="stat"><span>محاولات مشبوهة</span><strong className={data.totals.suspicious ? 'text-err' : ''}>{data.totals.suspicious}</strong></div>
          </div>

          {data.daily.length > 1 && (
            <section className="card att-chart">
              <h3>الحضور اليومي</h3>
              <div className="cols tall" role="img" aria-label="عدد الحاضرين يومياً">
                {data.daily.map((d) => (
                  <div key={d.date} className="col" title={`${d.date}: ${d.present} حاضر، ${d.late} متأخر`}>
                    <span className="col-fill stacked" style={{ height: `${(100 * d.present) / maxPresent}%` }}>
                      <span className="col-late" style={{ height: `${d.present ? (100 * d.late) / d.present : 0}%` }} />
                    </span>
                    <span className="col-label">{d.date.slice(8)}</span>
                  </div>
                ))}
              </div>
              <div className="legend-row"><span className="legend"><i className="dot" style={{ background: 'var(--primary)' }} /> حاضر</span><span className="legend"><i className="dot reserved" /> منهم متأخرون</span></div>
            </section>
          )}

          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>الموظف</th><th>نسبة الحضور</th><th>حضور / أيام العمل</th><th>غياب</th><th>تأخير</th><th>انصراف مبكر</th><th>إضافي</th><th>الساعات</th><th>تنبيهات</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employee_id} className="clickable" onClick={() => navigate(`/employees/${r.employee_id}`)}>
                    <td><strong>{r.name}</strong><div className="muted small">{r.job_title}</div></td>
                    <td className="rate-cell">
                      <span className="rate-bar"><span style={{ width: `${r.rate}%` }} className={r.rate < 80 ? 'low' : r.rate < 95 ? 'mid' : ''} /></span>
                      <b>{r.rate}%</b>
                    </td>
                    <td>{r.present} / {r.working_days}</td>
                    <td className={r.absent ? 'text-err' : ''}>{r.absent}</td>
                    <td className={r.late_days ? 'text-warn' : ''}>{r.late_days ? `${r.late_days} يوم · ${hm(r.late_minutes)}` : '—'}</td>
                    <td>{r.early_leave_minutes ? hm(r.early_leave_minutes) : '—'}</td>
                    <td>{r.overtime_minutes ? hm(r.overtime_minutes) : '—'}</td>
                    <td>{hm(r.worked_minutes)}</td>
                    <td>{r.flagged ? <span className="badge badge-warn">{r.flagged}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="section-title"><ShieldAlert size={16} /> محاولات التسجيل المرفوضة</h3>
          {!data.attempts.length ? <Empty icon={ShieldCheck} text="لا توجد محاولات مرفوضة في هذه الفترة" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>الوقت</th><th>الموظف</th><th>العملية</th><th>السبب</th><th>المسافة</th><th>الدقة</th><th>الجهاز</th></tr></thead>
                <tbody>
                  {data.attempts.map((a) => (
                    <tr key={a.id} className={a.suspicious ? 'row-warn' : ''}>
                      <td dir="ltr" className="cell-start small">{a.created_at.slice(5, 16)}</td>
                      <td>{a.name || '—'}</td>
                      <td>{a.action === 'check_in' ? 'حضور' : 'انصراف'}</td>
                      <td>{a.suspicious ? <span className="badge badge-err"><TriangleAlert size={11} /> {REASON_LABEL[a.reason] || a.reason}</span> : REASON_LABEL[a.reason] || a.reason}</td>
                      <td>{a.distance != null ? fmtDist(a.distance) : '—'}</td>
                      <td>{a.accuracy != null ? `±${Math.round(a.accuracy)} م` : '—'}</td>
                      <td className="small">{a.platform === 'web' ? 'متصفح' : a.platform === 'android' ? 'أندرويد' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ═════════════ مواقع الحضور ═════════════
function Locations() {
  const { data, loading, reload } = useData('/work-locations', ['attendance']);
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const { settings } = useApp();

  const del = async (l) => { if (window.confirm(`حذف موقع "${l.name}"؟`) && await run(() => api(`/work-locations/${l.id}`, { method: 'DELETE' }), 'تم الحذف')) reload(); };

  return (
    <div className="loc-layout">
      <div className="loc-side">
        <div className="section-bar">
          <p className="muted small">لا يُقبل الحضور إلا من داخل هذه المواقع (للموظفين المقيّدين بالموقع).</p>
          <button className="btn btn-primary" onClick={() => setEdit({ name: '', radius_m: 100 })}><Plus size={17} /> موقع جديد</button>
        </div>
        {settings?.att_require_location !== '1' && <div className="alert alert-warn"><TriangleAlert size={16} /> التحقق من الموقع متوقف من الإعدادات</div>}
        {loading ? <Loading /> : !data?.length ? (
          <Empty icon={MapPin} text="لم تُحدَّد مواقع بعد — الحضور مسموح من أي مكان حتى تضيف موقعاً" />
        ) : (
          <ul className="loc-list">
            {data.map((l) => (
              <li key={l.id} className={`loc-item ${edit?.id === l.id ? 'active' : ''}`}>
                <span className="loc-icon" aria-hidden><MapPin size={18} /></span>
                <button className="loc-main" onClick={() => setEdit(l)}>
                  <strong>{l.name}</strong>
                  <small className="muted">نصف القطر {l.radius_m} م · <bdi dir="ltr">{l.lat.toFixed(5)}, {l.lng.toFixed(5)}</bdi> · {l.today_count} حضور اليوم</small>
                </button>
                <button className="icon-btn text-err" onClick={() => del(l)} disabled={busy} aria-label={`حذف ${l.name}`}><Trash2 size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="loc-map card">
        {edit ? <LocationEditor key={edit.id || 'new'} loc={edit} others={(data || []).filter((l) => l.id !== edit.id)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
          : <GeoMap height={420} circles={(data || []).map((l) => ({ lat: l.lat, lng: l.lng, radius: l.radius_m, name: l.name }))} />}
      </div>
    </div>
  );
}

function LocationEditor({ loc, others, onClose, onSaved }) {
  const [run, busy] = useAction();
  const toast = useToast();
  const [f, setF] = useState({ name: loc.name || '', lat: loc.lat ?? null, lng: loc.lng ?? null, radius_m: loc.radius_m || 100 });
  const [locating, setLocating] = useState(false);
  const useMine = async () => {
    setLocating(true);
    try {
      const p = await readPosition();
      setF((x) => ({ ...x, lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }));
      toast(`تم تحديد موقعك (دقة ±${Math.round(p.accuracy)} م)`);
    } catch (e) { toast(e.message, 'err'); } finally { setLocating(false); }
  };
  const save = async () => {
    const body = { ...f, radius_m: Number(f.radius_m) };
    if (await run(() => (loc.id ? api(`/work-locations/${loc.id}`, { method: 'PUT', body }) : api('/work-locations', { method: 'POST', body })), 'تم حفظ الموقع')) onSaved();
  };
  const circles = useMemo(() => [
    ...others.map((l) => ({ lat: l.lat, lng: l.lng, radius: l.radius_m, name: l.name, active: false })),
    ...(f.lat != null ? [{ lat: f.lat, lng: f.lng, radius: Number(f.radius_m), name: f.name || 'الموقع الجديد' }] : []),
  ], [others, f]);
  return (
    <div className="loc-editor">
      <div className="loc-editor-head">
        <h3>{loc.id ? `تعديل: ${loc.name}` : 'موقع جديد'}</h3>
        <button className="icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
      </div>
      <p className="muted small">انقر على الخريطة لتحديد مركز الموقع، أو استخدم موقعك الحالي إن كنت في المطعم.</p>
      <GeoMap height={300} circles={circles} onPick={(p) => setF((x) => ({ ...x, ...p }))} />
      <div className="grid-2">
        <Field label="اسم الموقع"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="الفرع الرئيسي" /></Field>
        <Field label={`نصف القطر المسموح: ${f.radius_m} متر`}>
          <input type="range" min="20" max="500" step="10" value={f.radius_m} onChange={(e) => setF({ ...f, radius_m: Number(e.target.value) })} />
        </Field>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={useMine} disabled={locating}>{locating ? <LoaderCircle className="spin" size={16} /> : <Crosshair size={16} />} استخدام موقعي الحالي</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || f.lat == null || !f.name.trim()}><Save size={16} /> حفظ الموقع</button>
      </div>
      {f.lat != null && <p className="muted small" dir="ltr">{f.lat}, {f.lng}</p>}
    </div>
  );
}
