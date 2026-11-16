import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, FileWarning, TriangleAlert, ChevronLeft, IdCard } from 'lucide-react';
import { useData, useMoney, Loading, Empty, PageHead, timeOf, daysUntil } from '../lib.jsx';
import EmployeeForm from '../components/EmployeeForm.jsx';

const TODAY = {
  in: ['badge-ok', 'حاضر'], done: ['badge-ok', 'انصرف'], late: ['badge-warn', 'متأخر'],
  leave: ['', 'في إجازة'], none: ['', 'لم يسجّل'],
};

export default function Employees() {
  const navigate = useNavigate();
  const money = useMoney();
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useData(`/employees?status=${status}`, ['hr', 'attendance'], [status]);
  const alerts = useData('/hr/alerts', ['hr']);

  const depts = useMemo(() => [...new Set((list.data || []).map((e) => e.department).filter(Boolean))], [list.data]);
  const rows = (list.data || []).filter((e) => (!dept || e.department === dept) && (!q || e.name.includes(q) || (e.job_title || '').includes(q) || (e.phone || '').includes(q)));

  const todayState = (e) => {
    if (e.on_leave) return 'leave';
    if (!e.today_in) return 'none';
    if (e.today_late > 0 && !e.today_out) return 'late';
    return e.today_out ? 'done' : 'in';
  };

  const a = alerts.data;
  const alertCount = a ? a.docs.length + a.contracts.length : 0;

  return (
    <div>
      <PageHead title="الموظفون" sub={list.data ? `${list.data.length} موظف ${status === 'active' ? 'على رأس العمل' : ''}` : ''}>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={18} /> موظف جديد</button>
      </PageHead>

      {alertCount > 0 && (
        <section className="card alert-card">
          <div className="alert-card-head">
            <FileWarning size={20} aria-hidden />
            <strong>تنبيهات المستندات والعقود ({alertCount})</strong>
          </div>
          <ul className="alert-list">
            {a.docs.map((d) => {
              const left = daysUntil(d.expiry_date);
              return (
                <li key={`d${d.id}`}>
                  <button className="link-row" onClick={() => navigate(`/employees/${d.employee_id}`)}>
                    <span><strong>{d.name}</strong> · {d.title}</span>
                    <span className={`badge ${left < 0 ? 'badge-err' : 'badge-warn'}`}>{left < 0 ? `منتهية منذ ${-left} يوم` : left === 0 ? 'تنتهي اليوم' : `تنتهي خلال ${left} يوم`}</span>
                  </button>
                </li>
              );
            })}
            {a.contracts.map((c) => {
              const left = daysUntil(c.contract_end);
              return (
                <li key={`c${c.employee_id}`}>
                  <button className="link-row" onClick={() => navigate(`/employees/${c.employee_id}`)}>
                    <span><strong>{c.name}</strong> · عقد العمل</span>
                    <span className={`badge ${left < 0 ? 'badge-err' : 'badge-warn'}`}>{left < 0 ? `انتهى منذ ${-left} يوم` : `ينتهي خلال ${left} يوم`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="filters">
        <label className="search-field">
          <Search size={17} aria-hidden />
          <input type="search" placeholder="بحث بالاسم أو الوظيفة أو الجوال" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
        </label>
        {depts.length > 1 && (
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="القسم">
            <option value="">كل الأقسام</option>
            {depts.map((d) => <option key={d}>{d}</option>)}
          </select>
        )}
        <div className="seg">
          <button className={status === 'active' ? 'active' : ''} onClick={() => setStatus('active')}>على رأس العمل</button>
          <button className={status === 'terminated' ? 'active' : ''} onClick={() => setStatus('terminated')}>منتهية خدماتهم</button>
        </div>
      </div>

      {list.loading ? <Loading /> : !rows.length ? <Empty icon={IdCard} text="لا يوجد موظفون" /> : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>الموظف</th><th>القسم</th><th>الجوال</th><th>الراتب</th><th>اليوم</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const st = todayState(e);
                return (
                  <tr key={e.id} className="clickable" onClick={() => navigate(`/employees/${e.id}`)}>
                    <td>
                      <div className="person">
                        <span className="avatar avatar-light" aria-hidden>{e.name.slice(0, 1)}</span>
                        <div>
                          <strong>{e.name}</strong>
                          <div className="muted small">{e.job_title || '—'}{e.username ? ` · @${e.username}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>{e.department || '—'}</td>
                    <td dir="ltr" className="cell-start">{e.phone || '—'}</td>
                    <td>{money(e.basic_salary + e.allowances)}</td>
                    <td>
                      {status === 'active' ? (
                        <span className={`badge ${TODAY[st][0]}`}>{TODAY[st][1]}{e.today_in && st !== 'leave' ? ` ${timeOf(e.today_in)}` : ''}</span>
                      ) : <span className="badge badge-err">منتهية</span>}
                      {e.doc_alerts > 0 && <span className="badge badge-warn" title="مستندات تنتهي قريباً"><TriangleAlert size={12} /> {e.doc_alerts}</span>}
                    </td>
                    <td className="cell-end"><ChevronLeft size={18} className="muted" aria-hidden /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && <EmployeeForm onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); navigate(`/employees/${id}`); }} />}
    </div>
  );
}
