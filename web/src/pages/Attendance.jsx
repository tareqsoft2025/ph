import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, LogOut, Pencil, ChevronRight, ChevronLeft, Fingerprint, UserRoundX, CircleCheck } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, useAction, has, Loading, Empty, PageHead, hm, timeOf, todayStr, monthStr, WEEKDAYS } from '../lib.jsx';
import AttendanceForm from '../components/AttendanceForm.jsx';

const DAY_STATUS = {
  in: ['badge-ok', 'داخل الدوام'], done: ['', 'انصرف'], absent: ['badge-err', 'غائب'],
  leave: ['badge-info', 'إجازة'], off: ['', 'راحة'], pending: ['badge-warn', 'لم يسجّل بعد'],
};

/** ساعة حية */
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

function shiftDate(d, n) {
  const x = new Date(`${d}T00:00`);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export default function Attendance() {
  const { user } = useApp();
  const isMgr = has(user, 'hr.attendance');
  return (
    <div>
      <PageHead title="الحضور والانصراف" sub={isMgr ? 'سجل حضورك، وتابع حضور الفريق' : 'سجّل حضورك وانصرافك وتابع سجلك الشهري'} />
      <MyCard />
      {isMgr && <TeamView />}
    </div>
  );
}

function MyCard() {
  const now = useClock();
  const me = useData('/attendance/me', ['attendance']);
  const [run, busy] = useAction();
  if (me.loading) return <Loading />;
  const d = me.data;

  if (!d?.employee) {
    return (
      <section className="card punch-card punch-none">
        <Fingerprint size={28} aria-hidden />
        <p className="muted">حسابك غير مرتبط بملف موظف. يمكن للمدير ربطه من صفحة الموظفين لتتمكن من تسجيل الحضور.</p>
      </section>
    );
  }

  const t = d.today;
  const inNow = t?.check_in && !t?.check_out;
  const done = t?.check_in && t?.check_out;
  const act = (path, msg) => run(() => api(path, { method: 'POST' }), msg).then((r) => r && me.reload());
  const s = d.summary;

  return (
    <>
      <section className="card punch-card">
        <div className="punch-clock">
          <span className="muted small">{WEEKDAYS[now.getDay()]} {todayStr()}</span>
          <strong dir="ltr">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong>
          <span className="muted small">دوامك: <bdi dir="ltr">{d.employee.work_start} – {d.employee.work_end}</bdi></span>
        </div>
        <div className="punch-status">
          {!t?.check_in && <p>لم تسجّل حضورك اليوم بعد.</p>}
          {inNow && <p>سجّلت حضورك الساعة <strong>{timeOf(t.check_in)}</strong>{t.late_minutes ? <span className="badge badge-warn">متأخر {t.late_minutes} د</span> : <span className="badge badge-ok">في الموعد</span>}</p>}
          {done && <p><CircleCheck size={18} className="text-ok" aria-hidden /> حضور {timeOf(t.check_in)} · انصراف {timeOf(t.check_out)} · {hm(t.worked_minutes)} ساعة</p>}
          {!t?.check_in && <button className="btn btn-primary btn-lg punch-btn" onClick={() => act('/attendance/check-in', 'تم تسجيل الحضور')} disabled={busy}><LogIn size={20} /> تسجيل الحضور</button>}
          {inNow && <button className="btn btn-lg punch-btn punch-out" onClick={() => act('/attendance/check-out', 'تم تسجيل الانصراف')} disabled={busy}><LogOut size={20} /> تسجيل الانصراف</button>}
        </div>
      </section>

      <div className="stats">
        <div className="stat"><span>أيام الحضور هذا الشهر</span><strong>{s.present}</strong></div>
        <div className="stat"><span>الغياب</span><strong className={s.absent ? 'text-err' : ''}>{s.absent}</strong></div>
        <div className="stat"><span>إجمالي التأخير</span><strong className={s.late_minutes ? 'text-warn' : ''}>{hm(s.late_minutes)}</strong></div>
        <div className="stat"><span>ساعات العمل</span><strong>{hm(s.worked_minutes)}</strong></div>
      </div>

      {d.history.length > 0 && (
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

function TeamView() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('day');
  const [date, setDate] = useState(todayStr());
  const [month, setMonth] = useState(monthStr());
  const day = useData(tab === 'day' ? `/attendance?date=${date}` : null, ['attendance', 'hr'], [date, tab]);
  const sum = useData(tab === 'month' ? `/attendance/summary?month=${month}` : null, ['attendance', 'hr'], [month, tab]);
  const [edit, setEdit] = useState(null);

  return (
    <section className="team">
      <div className="section-bar">
        <h2>حضور الفريق</h2>
        <div className="seg">
          <button className={tab === 'day' ? 'active' : ''} onClick={() => setTab('day')}>الكشف اليومي</button>
          <button className={tab === 'month' ? 'active' : ''} onClick={() => setTab('month')}>الملخص الشهري</button>
        </div>
      </div>

      {tab === 'day' && (
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
                <thead><tr><th>الموظف</th><th>الدوام</th><th>الحضور</th><th>الانصراف</th><th>التأخير</th><th>الساعات</th><th>الحالة</th><th /></tr></thead>
                <tbody>
                  {day.data.rows.map((r) => (
                    <tr key={r.employee_id}>
                      <td><button className="link-btn" onClick={() => navigate(`/employees/${r.employee_id}`)}>{r.name}</button><div className="muted small">{r.job_title}</div></td>
                      <td dir="ltr" className="cell-start small">{r.work_start}–{r.work_end}</td>
                      <td>{timeOf(r.check_in) || '—'}</td>
                      <td>{timeOf(r.check_out) || '—'}</td>
                      <td>{r.late_minutes ? <span className="text-warn">{r.late_minutes} د</span> : '—'}</td>
                      <td>{r.worked_minutes ? hm(r.worked_minutes) : '—'}</td>
                      <td><span className={`badge ${DAY_STATUS[r.day_status][0]}`}>{DAY_STATUS[r.day_status][1]}</span>{r.source === 'manager' && <span className="badge" title="سُجّل يدوياً">يدوي</span>}</td>
                      <td className="cell-end">
                        <button className="icon-btn" onClick={() => setEdit({ ...r, date, id: r.id })} aria-label={`تعديل حضور ${r.name}`}><Pencil size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'month' && (
        <>
          <div className="filters"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" /></div>
          {sum.loading ? <Loading /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>الموظف</th><th>أيام العمل</th><th>حضور</th><th>غياب</th><th>إجازات</th><th>أيام التأخير</th><th>إجمالي التأخير</th><th>ساعات العمل</th></tr></thead>
                <tbody>
                  {(sum.data?.rows || []).map((r) => (
                    <tr key={r.employee_id} className="clickable" onClick={() => navigate(`/employees/${r.employee_id}`)}>
                      <td><strong>{r.name}</strong><div className="muted small">{r.job_title}</div></td>
                      <td>{r.working_days}</td>
                      <td>{r.present}</td>
                      <td className={r.absent ? 'text-err' : ''}>{r.absent}</td>
                      <td>{r.leave}</td>
                      <td className={r.late_days ? 'text-warn' : ''}>{r.late_days}</td>
                      <td>{hm(r.late_minutes)}</td>
                      <td>{hm(r.worked_minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {edit && <AttendanceForm rec={edit} name={edit.name} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); day.reload(); }} />}
    </section>
  );
}

