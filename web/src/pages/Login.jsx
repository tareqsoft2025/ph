import { useState } from 'react';
import { UtensilsCrossed, LogIn } from 'lucide-react';
import { api, isNative, isDemo, getServerUrl, resetDemoData } from '../api.js';
import AuthLayout from '../components/AuthLayout.jsx';
import ApkDownload from '../components/ApkDownload.jsx';

export default function Login({ onLogin, onChangeServer }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username, password } });
      await onLogin(r.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-head">
          <span className="brand-mark" aria-hidden><UtensilsCrossed size={22} strokeWidth={2.2} /></span>
          <h1>أهلاً بعودتك</h1>
          <p className="muted">سجّل الدخول للمتابعة إلى نظام إدارة المطعم</p>
        </div>
        <label className="field">
          <span className="field-label">اسم المستخدم</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">كلمة المرور</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {isDemo && (
          <div className="demo-box">
            <strong>نسخة تجريبية</strong>
            <span className="muted">تعمل داخل المتصفح، والبيانات محفوظة على هذا الجهاز فقط. اختر دوراً لتعبئة بيانات الدخول:</span>
            <div className="demo-users">
              {[['admin', 'admin123', 'المدير'], ['cashier', '1234', 'الكاشير'], ['waiter', '1234', 'النادل'], ['kitchen', '1234', 'المطبخ']].map(([u, p, l]) => (
                <button type="button" key={u} className="chip" onClick={() => { setUsername(u); setPassword(p); }}>{l}</button>
              ))}
            </div>
          </div>
        )}
        {error && <div className="alert alert-err">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}><LogIn size={19} /> {busy ? 'جارِ الدخول…' : 'دخول'}</button>
        {isDemo && (
          <button type="button" className="btn btn-link" onClick={async () => {
            if (!window.confirm('مسح كل البيانات التجريبية والبدء من جديد؟')) return;
            await resetDemoData();
            window.location.reload();
          }}>إعادة ضبط البيانات التجريبية</button>
        )}
        {isNative && (
          <button type="button" className="btn btn-link" onClick={onChangeServer}>
            الخادم: {getServerUrl()} — تغيير
          </button>
        )}
        <ApkDownload />
      </form>
    </AuthLayout>
  );
}
