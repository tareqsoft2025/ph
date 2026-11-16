import { useState } from 'react';
import { api, isNative, isDemo, getServerUrl, resetDemoData } from '../api.js';

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
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <img src="./icon.svg" alt="" width="64" height="64" />
        <h1>تسجيل الدخول</h1>
        <p className="muted">نظام إدارة المطعم</p>
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
            <span>تعمل بالكامل داخل المتصفح، والبيانات محفوظة على هذا الجهاز فقط.</span>
            <div className="demo-users">
              {[['admin', 'admin123', 'المدير'], ['cashier', '1234', 'الكاشير'], ['waiter', '1234', 'النادل'], ['kitchen', '1234', 'المطبخ']].map(([u, p, l]) => (
                <button type="button" key={u} className="chip" onClick={() => { setUsername(u); setPassword(p); }}>{l}</button>
              ))}
            </div>
            <small className="muted">اضغط على دور لتعبئة بيانات الدخول</small>
          </div>
        )}
        {error && <div className="alert alert-err">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'جارِ الدخول…' : 'دخول'}</button>
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
      </form>
    </div>
  );
}
