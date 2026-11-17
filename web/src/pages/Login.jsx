import { useState } from 'react';
import { UtensilsCrossed, LogIn, UserRound, Lock, Eye, EyeOff, ShieldCheck, Banknote, Armchair, ChefHat } from 'lucide-react';
import { api, isNative, isDemo, getServerUrl, resetDemoData } from '../api.js';
import AuthLayout from '../components/AuthLayout.jsx';
import ApkDownload from '../components/ApkDownload.jsx';

export default function Login({ onLogin, onChangeServer }) {
  const [username, setUsername] = useState(() => { try { return localStorage.getItem('ph-last-user') || ''; } catch { return ''; } });
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { username: username.trim(), password } });
      try { localStorage.setItem('ph-last-user', username.trim()); } catch { /* */ }
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
          <span className="brand-mark" aria-hidden><UtensilsCrossed size={26} strokeWidth={2.2} /></span>
          <h1>أهلاً بعودتك <span className="wave" aria-hidden>👋</span></h1>
          <p className="muted">سجّل الدخول للمتابعة إلى نظام إدارة المطعم</p>
        </div>
        <label className="field">
          <span className="field-label">اسم المستخدم</span>
          <span className="input-ico"><UserRound size={18} aria-hidden />
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required autoFocus={!username} placeholder="مثال: admin" />
          </span>
        </label>
        <label className="field">
          <span className="field-label">كلمة المرور</span>
          <span className="input-ico"><Lock size={18} aria-hidden />
            <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={(e) => setCaps(e.getModifierState?.('CapsLock') || false)} autoComplete="current-password" required autoFocus={!!username} />
            <button type="button" className="eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </span>
          {caps && <span className="field-hint caps">زر الحروف الكبيرة (Caps Lock) مفعّل</span>}
        </label>
        {isDemo && (
          <div className="demo-box">
            <strong>نسخة تجريبية</strong>
            <span className="muted">تعمل داخل المتصفح، والبيانات محفوظة على هذا الجهاز فقط. اختر دوراً لتعبئة بيانات الدخول:</span>
            <div className="demo-users">
              {[['admin', 'admin123', 'المدير', ShieldCheck], ['cashier', '1234', 'الكاشير', Banknote], ['waiter', '1234', 'النادل', Armchair], ['kitchen', '1234', 'المطبخ', ChefHat]].map(([u, p, l, I]) => (
                <button type="button" key={u} className={`chip role-chip ${username === u ? 'on' : ''}`} onClick={() => { setUsername(u); setPassword(p); }}><I size={15} aria-hidden /> {l}</button>
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
