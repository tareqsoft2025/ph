import { UtensilsCrossed, ChefHat, ReceiptText, ChartColumn } from 'lucide-react';

/** تخطيط صفحات الدخول: لوحة تعريفية + نموذج */
export default function AuthLayout({ children }) {
  return (
    <div className="auth-screen">
      <aside className="auth-side" aria-hidden>
        <span className="brand-mark"><UtensilsCrossed size={24} strokeWidth={2.2} /></span>
        <div>
          <h2>إدارة مطعمك <em>بهدوء</em> وثقة</h2>
          <p>من استلام الطلب حتى إغلاق الوردية: نقطة بيع، شاشة مطبخ لحظية، مخزون وتقارير في مكان واحد.</p>
        </div>
        <ul className="auth-points">
          <li><ReceiptText size={18} /> نقطة بيع سريعة للصالة والسفري والتوصيل</li>
          <li><ChefHat size={18} /> الطلبات تصل المطبخ فوراً</li>
          <li><ChartColumn size={18} /> تقارير المبيعات والأرباح يومياً</li>
        </ul>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}
