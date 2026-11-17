import { useEffect, useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { isNative } from '../api.js';

/** زر تنزيل تطبيق الأندرويد (يختفي داخل التطبيق نفسه أو إذا لم يوجد الملف) */
export default function ApkDownload() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (isNative) return;
    fetch('./apk/version.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => {});
  }, []);
  if (isNative || !info) return null;
  const mb = (info.size / 1048576).toFixed(1);
  return (
    <a className="apk-btn" href={`./apk/${info.file}`} download title={`تحميل تطبيق الأندرويد · الإصدار ${info.version} · ${mb} ميجابايت`} aria-label={`تحميل تطبيق الأندرويد، الإصدار ${info.version}`}>
      <Smartphone size={17} aria-hidden />
      <span className="apk-text"><strong>تطبيق الأندرويد</strong><small>الإصدار {info.version} · {mb} MB</small></span>
      <Download size={16} aria-hidden className="apk-dl" />
    </a>
  );
}
