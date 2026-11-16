import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight, Pencil, UserX, UserCheck, FileText, Upload, Download, Trash2, Plus, Phone, IdCard, CalendarDays,
  Clock, Wallet, Briefcase, MapPin, Mail, Siren, Landmark, FilePlus2, Smartphone, RotateCcw, KeyRound, ShieldCheck, Globe,
} from 'lucide-react';
import { api, isDemo } from '../api.js';
import {
  useData, useMoney, useAction, Modal, Field, Loading, Empty, DOC_TYPES, LEAVE_TYPES, LEAVE_STATUS, WEEKDAYS,
  hm, timeOf, daysUntil, monthStr,
} from '../lib.jsx';
import EmployeeForm from '../components/EmployeeForm.jsx';
import LeaveForm from '../components/LeaveForm.jsx';
import AttendanceForm from '../components/AttendanceForm.jsx';

export default function EmployeeProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const money = useMoney();
  const [month, setMonth] = useState(monthStr());
  const { data: e, loading, error, reload } = useData(`/employees/${id}?month=${month}`, ['hr', 'attendance'], [id, month]);
  const [tab, setTab] = useState('info');
  const [editing, setEditing] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [attEdit, setAttEdit] = useState(null);
  const [accOpen, setAccOpen] = useState(false);
  const [run, busy] = useAction();

  if (loading && !e) return <Loading />;
  if (error) return <Empty text={error} />;
  if (!e) return null;

  const active = e.status === 'active';
  const off = String(e.weekly_off || '').split(',').filter(Boolean).map((d) => WEEKDAYS[Number(d)]).join('، ');

  async function toggleStatus() {
    const next = active ? 'terminated' : 'active';
    if (!window.confirm(active ? `إنهاء خدمات ${e.name}؟` : `إعادة ${e.name} للعمل؟`)) return;
    if (await run(() => api(`/employees/${e.id}/status`, { method: 'POST', body: { status: next } }), 'تم التحديث')) reload();
  }
  async function openFile(doc) {
    const f = await run(() => api(`/documents/${doc.id}/file`));
    if (!f) return;
    const a = document.createElement('a');
    a.href = f.file_data;
    a.download = f.file_name || doc.title;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }
  async function delDoc(doc) {
    if (!window.confirm(`حذف "${doc.title}"؟`)) return;
    if (await run(() => api(`/documents/${doc.id}`, { method: 'DELETE' }), 'تم الحذف')) reload();
  }
  async function resetDevice() {
    if (!window.confirm('إلغاء ربط الجهاز الحالي؟ سيُعتمد أول جهاز يسجّل منه الموظف بعد ذلك.')) return;
    if (await run(() => api(`/employees/${e.id}/reset-device`, { method: 'POST' }), 'تم إلغاء ربط الجهاز')) reload();
  }

  async function decide(l, status) {
    if (await run(() => api(`/leaves/${l.id}`, { method: 'PATCH', body: { status } }), 'تم')) reload();
  }

  const s = e.summary;
  const docAlerts = e.documents.filter((d) => d.expiry_date && daysUntil(d.expiry_date) <= 30).length;

  return (
    <div>
      <button className="btn btn-ghost btn-sm back-link" onClick={() => navigate('/employees')}><ArrowRight size={16} /> الموظفون</button>

      <header className="profile-head card">
        <span className="avatar avatar-lg" aria-hidden>{e.name.slice(0, 1)}</span>
        <div className="profile-id">
          <h1>{e.name}</h1>
          <p className="muted">{e.job_title || 'بدون مسمى'}{e.department ? ` · ${e.department}` : ''}</p>
          <div className="profile-tags">
            <span className={`badge ${active ? 'badge-ok' : 'badge-err'}`}>{active ? 'على رأس العمل' : `منتهية الخدمة ${e.terminated_at || ''}`}</span>
            {e.username && <span className="badge">@{e.username}</span>}
            {docAlerts > 0 && <span className="badge badge-warn">{docAlerts} مستند يحتاج تجديد</span>}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setEditing(true)}><Pencil size={16} /> تعديل</button>
          <button className={`btn ${active ? 'btn-danger-ghost' : ''}`} onClick={toggleStatus} disabled={busy}>
            {active ? <><UserX size={16} /> إنهاء الخدمة</> : <><UserCheck size={16} /> إعادة للعمل</>}
          </button>
        </div>
      </header>

      <div className="stats">
        <div className="stat"><span>حضور هذا الشهر</span><strong>{s.present} <small className="muted">من {s.working_days}</small></strong></div>
        <div className="stat"><span>أيام الغياب</span><strong className={s.absent ? 'text-err' : ''}>{s.absent}</strong></div>
        <div className="stat"><span>إجمالي التأخير</span><strong className={s.late_minutes ? 'text-warn' : ''}>{hm(s.late_minutes)}</strong></div>
        <div className="stat"><span>رصيد الإجازة السنوية</span><strong>{e.annual_leave_days - e.annual_leave_used} يوم</strong></div>
      </div>

      <div className="tabs" role="tablist">
        {[['info', 'البيانات'], ['docs', `المستندات (${e.documents.length})`], ['att', 'الحضور'], ['leaves', `الإجازات (${e.leaves.length})`]].map(([k, v]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{v}</button>
        ))}
      </div>

      {tab === 'info' && (
        <div className="report-grid">
          <section className="card">
            <h3>البيانات الشخصية</h3>
            <dl className="info-list">
              <Info icon={Phone} k="الجوال" v={e.phone} ltr />
              <Info icon={Mail} k="البريد" v={e.email} ltr />
              <Info icon={IdCard} k="الهوية / الإقامة" v={e.national_id} ltr />
              <Info icon={MapPin} k="الجنسية" v={e.nationality} />
              <Info icon={CalendarDays} k="تاريخ الميلاد" v={e.birth_date} />
              <Info icon={MapPin} k="العنوان" v={e.address} />
              <Info icon={Siren} k="الطوارئ" v={e.emergency_contact} />
            </dl>
          </section>
          <section className="card">
            <h3>حساب الدخول والحضور</h3>
            <dl className="info-list">
              <div className="info-row"><dt><KeyRound size={16} /> حساب الدخول</dt><dd>{e.username ? <bdi dir="ltr">@{e.username}</bdi> : <button className="btn btn-sm btn-primary" onClick={() => setAccOpen(true)}><Plus size={15} /> إنشاء حساب</button>}</dd></div>
              <div className="info-row"><dt>{e.location_mode === 'anywhere' ? <Globe size={16} /> : <MapPin size={16} />} مكان التسجيل</dt><dd>{e.location_mode === 'anywhere' ? 'من أي مكان' : (() => { const ids = e.location_ids ? JSON.parse(e.location_ids) : []; return ids.length ? e.work_locations.filter((l) => ids.includes(l.id)).map((l) => l.name).join('، ') : 'كل مواقع العمل'; })()}</dd></div>
              <div className="info-row"><dt><Clock size={16} /> السماحية / الحضور المبكر</dt><dd>{e.grace_minutes ?? 'عام'} د · حتى {e.early_checkin_minutes} د قبل الدوام</dd></div>
              <div className="info-row"><dt><Smartphone size={16} /> الجهاز المعتمد</dt>
                <dd>{!e.device_binding ? 'غير مقيّد' : e.bound_device
                  ? <span className="row gap-s"><span className="badge badge-ok"><ShieldCheck size={12} /> {e.bound_device.startsWith('android') ? 'جوال أندرويد' : 'متصفح'} · منذ {e.bound_device_at?.slice(0, 10)}</span><button className="btn btn-xs" onClick={resetDevice} title="إلغاء الربط"><RotateCcw size={13} /></button></span>
                  : <span className="muted">يُعتمد أول جهاز يسجّل منه</span>}</dd></div>
            </dl>
          </section>
          <section className="card">
            <h3>العمل والراتب</h3>
            <dl className="info-list">
              <Info icon={Briefcase} k="تاريخ التعيين" v={e.hire_date} />
              <Info icon={FileText} k="نهاية العقد" v={e.contract_end && `${e.contract_end}${daysUntil(e.contract_end) <= 30 ? ` (${daysUntil(e.contract_end) < 0 ? 'منتهي' : `بعد ${daysUntil(e.contract_end)} يوم`})` : ''}`} />
              <Info icon={Clock} k="الدوام" v={`${e.work_start} – ${e.work_end}`} ltr />
              <Info icon={CalendarDays} k="أيام الراحة" v={off} />
              <Info icon={Wallet} k="الراتب الأساسي" v={money(e.basic_salary)} />
              <Info icon={Wallet} k="البدلات" v={money(e.allowances)} />
              <Info icon={Landmark} k="الآيبان" v={e.bank_iban} ltr />
            </dl>
            {e.notes && <p className="muted small notes-box">{e.notes}</p>}
          </section>
        </div>
      )}

      {tab === 'docs' && (
        <section>
          <div className="section-bar">
            <p className="muted small">الهوية والإقامة والشهادة الصحية والعقود. ستظهر تنبيهات قبل انتهائها.</p>
            <button className="btn btn-primary" onClick={() => setDocOpen(true)}><FilePlus2 size={17} /> إضافة مستند</button>
          </div>
          {!e.documents.length ? <Empty icon={FileText} text="لا توجد مستندات" /> : (
            <div className="doc-grid">
              {e.documents.map((d) => {
                const left = daysUntil(d.expiry_date);
                const state = left === null ? '' : left < 0 ? 'expired' : left <= 30 ? 'soon' : 'valid';
                return (
                  <article key={d.id} className={`doc-card doc-${state}`}>
                    <span className="doc-icon" aria-hidden><FileText size={22} /></span>
                    <div className="doc-body">
                      <strong>{d.title}</strong>
                      <span className="muted small">{DOC_TYPES[d.doc_type]}{d.number ? ` · ${d.number}` : ''}</span>
                      {d.expiry_date && (
                        <span className={`badge ${state === 'expired' ? 'badge-err' : state === 'soon' ? 'badge-warn' : 'badge-ok'}`}>
                          {state === 'expired' ? `منتهي منذ ${-left} يوم` : state === 'soon' ? `ينتهي خلال ${left} يوم` : `ساري حتى ${d.expiry_date}`}
                        </span>
                      )}
                    </div>
                    <div className="doc-actions">
                      {d.file_name && <button className="icon-btn" onClick={() => openFile(d)} aria-label={`تنزيل ${d.title}`} title={d.file_name}><Download size={18} /></button>}
                      <button className="icon-btn text-err" onClick={() => delDoc(d)} aria-label={`حذف ${d.title}`}><Trash2 size={18} /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === 'att' && (
        <section>
          <div className="section-bar">
            <input type="month" value={month} onChange={(ev) => setMonth(ev.target.value)} aria-label="الشهر" />
            <span className="muted small">ساعات العمل: {hm(s.worked_minutes)} · أيام التأخير: {s.late_days} · إجازات: {s.leave}</span>
            <button className="btn" onClick={() => setAttEdit({ employee_id: e.id })}><Plus size={17} /> تسجيل يدوي</button>
          </div>
          {!e.attendance.length ? <Empty icon={Clock} text="لا يوجد سجل حضور في هذا الشهر" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>التأخير</th><th>ساعات العمل</th><th>ملاحظة</th><th /></tr></thead>
                <tbody>
                  {e.attendance.map((a) => (
                    <tr key={a.id}>
                      <td>{a.date} <span className="muted small">{WEEKDAYS[new Date(`${a.date}T00:00`).getDay()]}</span></td>
                      {a.status === 'present' ? (
                        <>
                          <td>{timeOf(a.check_in)}</td>
                          <td>{a.check_out ? timeOf(a.check_out) : <span className="badge badge-ok">داخل الدوام</span>}</td>
                          <td>{a.late_minutes ? <span className="text-warn">{a.late_minutes} د</span> : '—'}</td>
                          <td>{a.worked_minutes ? hm(a.worked_minutes) : '—'}</td>
                        </>
                      ) : <td colSpan={4}><span className={`badge ${a.status === 'absent' ? 'badge-err' : ''}`}>{a.status === 'absent' ? 'غياب' : 'إجازة'}</span></td>}
                      <td className="small muted">{a.note}</td>
                      <td className="cell-end"><button className="icon-btn" onClick={() => setAttEdit({ ...a, employee_id: e.id })} aria-label="تعديل"><Pencil size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'leaves' && (
        <section>
          <div className="section-bar">
            <p className="muted small">المستخدم من الإجازة السنوية هذا العام: {e.annual_leave_used} من {e.annual_leave_days} يوم</p>
            <button className="btn btn-primary" onClick={() => setLeaveOpen(true)}><Plus size={17} /> إضافة إجازة</button>
          </div>
          {!e.leaves.length ? <Empty icon={CalendarDays} text="لا توجد إجازات" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>السبب</th><th>الحالة</th><th /></tr></thead>
                <tbody>
                  {e.leaves.map((l) => (
                    <tr key={l.id}>
                      <td>{LEAVE_TYPES[l.type]}</td><td>{l.start_date}</td><td>{l.end_date}</td><td>{l.days}</td>
                      <td className="small muted">{l.reason}</td>
                      <td><span className={`badge ${l.status === 'approved' ? 'badge-ok' : l.status === 'rejected' ? 'badge-err' : 'badge-warn'}`}>{LEAVE_STATUS[l.status]}</span></td>
                      <td className="cell-end">
                        {l.status === 'pending' && (
                          <span className="row gap-s">
                            <button className="btn btn-sm btn-ok" onClick={() => decide(l, 'approved')} disabled={busy}>اعتماد</button>
                            <button className="btn btn-sm btn-danger-ghost" onClick={() => decide(l, 'rejected')} disabled={busy}>رفض</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {editing && <EmployeeForm emp={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {docOpen && <DocForm empId={e.id} onClose={() => setDocOpen(false)} onSaved={() => { setDocOpen(false); reload(); }} />}
      {leaveOpen && <LeaveForm employeeId={e.id} manager onClose={() => setLeaveOpen(false)} onSaved={() => { setLeaveOpen(false); reload(); }} />}
      {accOpen && <AccountForm emp={e} onClose={() => setAccOpen(false)} onSaved={() => { setAccOpen(false); reload(); }} />}
      {attEdit && <AttendanceForm rec={attEdit} name={e.name} onClose={() => setAttEdit(null)} onSaved={() => { setAttEdit(null); reload(); }} />}
    </div>
  );
}

function Info({ icon: Icon, k, v, ltr }) {
  return (
    <div className="info-row">
      <dt><Icon size={16} aria-hidden /> {k}</dt>
      <dd dir={ltr && v ? 'ltr' : undefined}>{v || <span className="muted">—</span>}</dd>
    </div>
  );
}

const MAX = isDemo ? 400 * 1024 : 2.5 * 1024 * 1024;

function DocForm({ empId, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ title: '', doc_type: 'id', number: '', expiry_date: '' });
  const [file, setFile] = useState(null);
  const [err, setErr] = useState('');

  function pickFile(ev) {
    const fl = ev.target.files?.[0];
    setErr('');
    if (!fl) return setFile(null);
    if (fl.size > MAX) { setErr(`حجم الملف أكبر من ${isDemo ? '400 كيلوبايت (النسخة التجريبية)' : '2.5 ميجابايت'}`); ev.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => setFile({ name: fl.name, type: fl.type, data: reader.result });
    reader.readAsDataURL(fl);
    if (!f.title) setF((x) => ({ ...x, title: fl.name.replace(/\.[^.]+$/, '') }));
  }

  async function save() {
    const body = { ...f, expiry_date: f.expiry_date || null, ...(file ? { file_name: file.name, file_type: file.type, file_data: file.data } : {}) };
    if (await run(() => api(`/employees/${empId}/documents`, { method: 'POST', body }), 'تمت إضافة المستند')) onSaved();
  }

  return (
    <Modal title="إضافة مستند" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !f.title.trim()}>حفظ</button>
      </>
    }>
      <div className="grid-2">
        <Field label="نوع المستند">
          <select value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value, title: f.title || DOC_TYPES[e.target.value] })}>
            {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="اسم المستند"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="رقم المستند"><input dir="ltr" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
        <Field label="تاريخ الانتهاء"><input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></Field>
      </div>
      <label className={`dropzone ${file ? 'has-file' : ''}`}>
        <input type="file" accept="image/*,application/pdf" onChange={pickFile} />
        <Upload size={22} aria-hidden />
        <span>{file ? file.name : 'اختر صورة أو ملف PDF'}</span>
        <small className="muted">{isDemo ? 'حتى 400 كيلوبايت في النسخة التجريبية' : 'حتى 2.5 ميجابايت'}</small>
      </label>
      {err && <div className="alert alert-err">{err}</div>}
    </Modal>
  );
}

function AccountForm({ emp, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ username: '', password: '' });
  const save = async () => { if (await run(() => api(`/employees/${emp.id}/account`, { method: 'POST', body: f }), 'تم إنشاء الحساب')) onSaved(); };
  return (
    <Modal title={`حساب دخول لـ ${emp.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>إلغاء</button><button className="btn btn-primary" onClick={save} disabled={busy}>إنشاء</button></>}>
      <p className="muted small">حساب بدور "موظف": يسجّل حضوره وانصرافه ويطلب الإجازات من التطبيق أو المتصفح.</p>
      <Field label="اسم المستخدم" hint="أحرف إنجليزية أو أرقام"><input dir="ltr" autoCapitalize="none" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoFocus /></Field>
      <Field label="كلمة المرور"><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
    </Modal>
  );
}
