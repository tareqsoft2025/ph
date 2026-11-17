import { QrCode, Check, X } from 'lucide-react';
import { api } from '../api.js';
import { useApp, has, useAction } from '../lib.jsx';

/** طلب من رمز QR بانتظار تأكيد الموظف قبل وصوله للمطبخ */
export default function ConfirmBanner({ order, onChanged }) {
  const { user } = useApp();
  const [run, busy] = useAction();
  if (!order?.pending_confirm || order.status !== 'open' || !has(user, 'pos.create', 'payments.collect')) return null;
  const confirm = async () => { const r = await run(() => api(`/orders/${order.id}/confirm`, { method: 'POST' }), 'تم التأكيد وأُرسل للمطبخ'); if (r) onChanged?.(r); };
  const reject = async () => {
    const reason = window.prompt('سبب الرفض (يظهر للزبون)؟', '');
    if (reason === null) return;
    const r = await run(() => api(`/orders/${order.id}/reject`, { method: 'POST', body: { reason } }), 'تم رفض الطلب');
    if (r) onChanged?.(r);
  };
  return (
    <div className="confirm-banner" role="alert">
      <span className="cb-ico" aria-hidden><QrCode size={20} /></span>
      <div className="cb-text"><strong>طلب QR بانتظار تأكيدك</strong><small>لن يصل للمطبخ إلا بعد القبول{order.customer_name ? ` · ${order.customer_name}` : ''}</small></div>
      <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}><Check size={16} /> قبول وإرسال للمطبخ</button>
      <button className="btn btn-danger-ghost btn-sm" onClick={reject} disabled={busy}><X size={16} /> رفض</button>
    </div>
  );
}
