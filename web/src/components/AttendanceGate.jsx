import { useEffect, useState } from 'react';
import { LogOut, Fingerprint, ShieldQuestion, Send, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, useAction, Loading } from '../lib.jsx';
import { MyCard } from '../pages/Attendance.jsx';

/**
 * بوابة الحضور: من له ملف موظف لا يرى النظام قبل تسجيل حضوره في يوم عمله.
 * الخادم يفرض الشرط نفسه (403 attendance_required)، فلا يمكن تجاوزه بتعديل الواجهة.
 */
export default function AttendanceGate({ children }) {
  const { user, logout } = useApp();
  const me = useData('/attendance/me', ['attendance', 'hr']);
  const [blocked, setBlocked] = useState(false);

  // إن رفض الخادم أي طلب لاحق بسبب الحضور فنعيد الفحص فوراً
  useEffect(() => {
    const h = (e) => { if (e.detail?.reason === 'attendance_required') { setBlocked(true); me.reload(); } };
    window.addEventListener('ph:attendance-required', h);
    return () => window.removeEventListener('ph:attendance-required', h);
  }, [me]);

  if (me.loading && !me.data) return <div className="center-screen"><Loading /></div>;
  const required = me.data?.required;
  if (!required) return children;

  return (
    <div className="gate">
      <div className="gate-inner">
        <header className="gate-head">
          <span className="gate-mark" aria-hidden><Fingerprint size={28} /></span>
          <h1>أهلاً {user.name}</h1>
          <p className="muted">سجّل حضورك أولاً لتبدأ العمل. دوامك يبدأ {me.data.employee?.work_start}.</p>
          {blocked && <p className="alert alert-warn">لا يمكن استخدام النظام قبل تسجيل الحضور</p>}
        </header>
        <MyCard compact onDone={() => me.reload()} />
        <Activation act={me.data.activation} onSent={() => me.reload()} />
        <button className="btn btn-ghost gate-out" onClick={logout}><LogOut size={16} /> تسجيل الخروج</button>
      </div>
    </div>
  );
}

/** تعذّر تسجيل الحضور؟ اطلب من المدير العام تفعيل حسابك لهذا اليوم */
function Activation({ act, onSent }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [run, busy] = useAction();
  const send = async () => { if (await run(() => api('/attendance/activation-request', { method: 'POST', body: { reason } }), 'أُرسل الطلب إلى المدير العام')) { setOpen(false); setReason(''); onSent(); } };
  if (act?.status === 'pending') {
    return <div className="gate-act pending" role="status"><Clock size={20} aria-hidden /><div><strong>بانتظار تفعيل المدير العام</strong><p className="muted small">أُرسل طلبك: «{act.reason}». ستُفتح الشاشة تلقائياً عند الموافقة.</p></div></div>;
  }
  return (
    <section className="gate-act">
      {act?.status === 'denied' && <p className="alert alert-warn"><XCircle size={16} aria-hidden /> رفض المدير طلبك{act.note ? `: ${act.note}` : ''}. سجّل حضورك أو تواصل معه مباشرة.</p>}
      {!open ? (
        <button className="btn gate-ask" onClick={() => setOpen(true)}><ShieldQuestion size={18} /> أواجه مشكلة في تسجيل الحضور — تواصل مع المدير العام</button>
      ) : (
        <div className="gate-form">
          <label className="field"><span>ما المشكلة؟</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus placeholder="مثال: الجوال لا يحدد موقعي، أو التطبيق لا يعمل" /></label>
          <div className="gate-form-acts">
            <button className="btn btn-primary" onClick={send} disabled={busy || reason.trim().length < 3}><Send size={16} /> أرسل للمدير العام</button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>إلغاء</button>
          </div>
          <p className="muted small"><CheckCircle2 size={13} aria-hidden /> يصل المدير إشعار فوري، وعند موافقته يُفتح حسابك لهذا اليوم فقط.</p>
        </div>
      )}
    </section>
  );
}
