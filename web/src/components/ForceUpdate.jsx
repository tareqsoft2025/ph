import { useEffect, useState } from 'react';
import { Download, RefreshCw, ShieldAlert } from 'lucide-react';
import { isNative, isDemo, getServerUrl } from '../api.js';

/* eslint-disable no-undef */
const CURRENT = typeof __APP_CODE__ === 'number' ? __APP_CODE__ : 0;

/**
 * تحديث إجباري: يقارن إصدار التطبيق المثبّت بآخر إصدار على الخادم (apk/version.json)
 * وإن كان الخادم أحدث تظهر شاشة تمنع استخدام التطبيق حتى يُنزَّل التحديث.
 * يعمل داخل تطبيق الأندرويد فقط.
 */
export default function ForceUpdate() {
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    const base = getServerUrl();
    if (!isNative || isDemo || !base || !CURRENT) return;
    setChecking(true);
    try {
      const r = await fetch(`${base}/apk/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) {
        const v = await r.json();
        setInfo(Number(v.code) > CURRENT ? v : null);
      }
    } catch { /* بلا اتصال: لا نمنع المستخدم */ } finally { setChecking(false); }
  };

  useEffect(() => {
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    const vis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []); // eslint-disable-line

  if (!info) return null;
  const url = `${getServerUrl()}/apk/${info.file || 'restaurant-app.apk'}`;
  return (
    <div className="force-update" role="alertdialog" aria-modal="true" aria-labelledby="fu-title">
      <div className="force-card">
        <span className="force-icon"><ShieldAlert size={34} aria-hidden /></span>
        <h1 id="fu-title">تحديث مطلوب</h1>
        <p>يتوفر إصدار جديد من التطبيق ({info.version}). يجب التحديث لمتابعة الاستخدام.</p>
        <a className="btn btn-primary btn-lg btn-block" href={url} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); window.open(url, '_system'); }}>
          <Download size={19} /> تنزيل التحديث وتثبيته
        </a>
        <button className="btn btn-ghost btn-block" onClick={check} disabled={checking}><RefreshCw size={16} /> تحقّق مرة أخرى</button>
        <small className="muted">بعد التنزيل افتح الملف واختر «تثبيت»، ثم افتح التطبيق من جديد.</small>
      </div>
    </div>
  );
}
