import { useState } from 'react';
import { Plus, CalendarOff, Check, X, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, useAction, has, Loading, Empty, PageHead, LEAVE_TYPES, LEAVE_STATUS } from '../lib.jsx';
import LeaveForm from '../components/LeaveForm.jsx';

export default function Leaves() {
  const { user } = useApp();
  const isMgr = has(user, 'hr.leaves');
  const [status, setStatus] = useState(isMgr ? 'pending' : '');
  const { data, loading, reload } = useData(`/leaves${status ? `?status=${status}` : ''}`, ['hr'], [status]);
  const [open, setOpen] = useState(false);
  const [run, busy] = useAction();

  const decide = async (l, s) => { if (await run(() => api(`/leaves/${l.id}`, { method: 'PATCH', body: { status: s } }), s === 'approved' ? 'تم اعتماد الإجازة' : 'تم رفض الطلب')) reload(); };
  const cancel = async (l) => { if (window.confirm('إلغاء هذا الطلب؟') && await run(() => api(`/leaves/${l.id}`, { method: 'DELETE' }), 'تم الإلغاء')) reload(); };

  const canRequest = isMgr || data?.employee;
  const b = data?.balance;

  return (
    <div>
      <PageHead title="الإجازات" sub={isMgr ? 'طلبات الموظفين واعتمادها' : 'اطلب إجازة وتابع حالة طلباتك'}>
        {canRequest && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={18} /> {isMgr ? 'إضافة إجازة' : 'طلب إجازة'}</button>}
      </PageHead>

      {b && (
        <div className="stats">
          <div className="stat"><span>رصيد الإجازة السنوية</span><strong>{b.total} يوم</strong></div>
          <div className="stat"><span>المستخدم هذا العام</span><strong>{b.used} يوم</strong></div>
          <div className="stat primary"><span>المتبقي</span><strong>{b.remaining} يوم</strong></div>
        </div>
      )}

      {!loading && !isMgr && !data?.employee && (
        <div className="alert alert-warn">حسابك غير مرتبط بملف موظف. اطلب من المدير ربطه لتتمكن من طلب الإجازات.</div>
      )}

      <div className="filters">
        <div className="seg">
          {[['pending', 'قيد المراجعة'], ['approved', 'المعتمدة'], ['rejected', 'المرفوضة'], ['', 'الكل']].map(([k, v]) => (
            <button key={k || 'all'} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{v}</button>
          ))}
        </div>
      </div>

      {loading ? <Loading /> : !data?.rows.length ? <Empty icon={CalendarOff} text="لا توجد طلبات" /> : (
        <div className="leave-list">
          {data.rows.map((l) => (
            <article key={l.id} className={`card leave-card leave-${l.status}`}>
              <div className="leave-main">
                {isMgr && <strong className="leave-name">{l.name}</strong>}
                <span className="leave-type">إجازة {LEAVE_TYPES[l.type]} · {l.days} {l.days === 1 ? 'يوم' : 'أيام'}</span>
                <span className="muted small"><bdi>{l.start_date}</bdi> ← <bdi>{l.end_date}</bdi>{l.reason ? ` · ${l.reason}` : ''}</span>
                {l.decided_by_name && l.status !== 'pending' && <span className="muted small">بواسطة {l.decided_by_name}</span>}
              </div>
              <div className="leave-side">
                <span className={`badge ${l.status === 'approved' ? 'badge-ok' : l.status === 'rejected' ? 'badge-err' : 'badge-warn'}`}>{LEAVE_STATUS[l.status]}</span>
                {isMgr && l.status === 'pending' && (
                  <>
                    <button className="btn btn-sm btn-ok" onClick={() => decide(l, 'approved')} disabled={busy}><Check size={16} /> اعتماد</button>
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => decide(l, 'rejected')} disabled={busy}><X size={16} /> رفض</button>
                  </>
                )}
                {!isMgr && l.status === 'pending' && (
                  <button className="btn btn-sm btn-ghost" onClick={() => cancel(l)} disabled={busy}><Trash2 size={15} /> إلغاء</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {open && <LeaveForm manager={isMgr} chooseEmployee={isMgr} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); reload(); }} />}
    </div>
  );
}
