import { useEffect, useState } from 'react';
import { LogOut, Fingerprint } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, Loading } from '../lib.jsx';
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
        <button className="btn btn-ghost gate-out" onClick={logout}><LogOut size={16} /> تسجيل الخروج</button>
      </div>
    </div>
  );
}
