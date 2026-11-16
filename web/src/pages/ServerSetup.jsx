import { useState } from 'react';
import { getServerUrl, setServerUrl, testServer } from '../api.js';

export default function ServerSetup({ onDone }) {
  const [url, setUrl] = useState(getServerUrl() || 'http://192.168.1.10:3000');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    let u = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(u)) u = 'http://' + u;
    try {
      await testServer(u);
      setServerUrl(u);
      onDone();
    } catch {
      setError('تعذّر الوصول إلى الخادم. تأكد أن الجهاز على نفس شبكة الـ Wi-Fi وأن الخادم يعمل.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <img src="./icon.svg" alt="" width="64" height="64" />
        <h1>ربط التطبيق بالخادم</h1>
        <p className="muted">أدخل عنوان خادم المطعم كما يظهر عند تشغيله على جهاز الكاشير.</p>
        <label className="field">
          <span className="field-label">عنوان الخادم</span>
          <input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="none" required />
          <span className="field-hint">مثال: http://192.168.1.10:3000</span>
        </label>
        {error && <div className="alert alert-err">{error}</div>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'جارِ الاختبار…' : 'اتصال'}</button>
      </form>
    </div>
  );
}
