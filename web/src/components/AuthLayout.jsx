import { useEffect, useState } from 'react';
import { UtensilsCrossed, ChefHat, ReceiptText, ChartColumn, Fingerprint } from 'lucide-react';
import { TableArt } from './TableHero.jsx';

/** تخطيط صفحات الدخول: لوحة تعريفية حيّة + نموذج */
export default function AuthLayout({ children }) {
  const [g, setG] = useState(1);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setG(3); return undefined; }
    const t = setInterval(() => setG((x) => (x >= 4 ? 1 : x + 1)), 1300);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="auth-screen">
      <aside className="auth-side" aria-hidden>
        <div className="auth-glow" />
        <span className="brand-mark"><UtensilsCrossed size={24} strokeWidth={2.2} /></span>
        <div className="auth-hero">
          <div className="auth-art"><TableArt seats={4} guests={g} occupied /></div>
          <h2>إدارة مطعمك <em>بهدوء</em> وثقة</h2>
          <p>من استلام الطلب حتى إغلاق الوردية: نقطة بيع، شاشة مطبخ لحظية، حضور وموارد بشرية، مخزون وتقارير في مكان واحد.</p>
        </div>
        <ul className="auth-points">
          <li><ReceiptText size={18} /> نقطة بيع سريعة للصالة والسفري والتوصيل</li>
          <li><ChefHat size={18} /> الطلبات تصل المطبخ فوراً</li>
          <li><Fingerprint size={18} /> حضور آمن بالموقع الجغرافي</li>
          <li><ChartColumn size={18} /> تقارير المبيعات والأرباح يومياً</li>
        </ul>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}
