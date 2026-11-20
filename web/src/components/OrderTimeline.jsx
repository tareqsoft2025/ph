import {
  FilePlus2, ListPlus, Send, Flame, CircleCheckBig, HandPlatter, Ban, Percent, ArrowRightLeft, Banknote, BadgeCheck, CircleX,
  Copy, Phone, UserRound, Users, MapPin, Armchair, Check, QrCode, ReceiptText,
} from 'lucide-react';
import { useState } from 'react';
import { useData, useMoney, Modal, Loading, ORDER_TYPES, PAY_METHODS, ROLE_LABELS, timeOf, clockOf, spanOf, ITEM_STATUS } from '../lib.jsx';

export const EVENT = {
  created: [FilePlus2, 'إنشاء الطلب'],
  online: [QrCode, 'طلب من رمز QR'],
  bill_requested: [ReceiptText, 'طلب الحساب'],
  bill_cancelled: [CircleX, 'إلغاء طلب الحساب'],
  confirmed: [BadgeCheck, 'تأكيد الموظف'],
  items_added: [ListPlus, 'إضافة أصناف'],
  sent: [Send, 'إرسال للمطبخ'],
  preparing: [Flame, 'بدء التحضير'],
  ready: [CircleCheckBig, 'الطلب جاهز'],
  served: [HandPlatter, 'تم التقديم'],
  item_cancelled: [Ban, 'إلغاء صنف'],
  discount: [Percent, 'خصم'],
  moved: [ArrowRightLeft, 'نقل طاولة'],
  payment: [Banknote, 'دفعة'],
  paid: [BadgeCheck, 'السداد والإغلاق'],
  cancelled: [CircleX, 'إلغاء الطلب'],
  claimed: [UserRound, 'استلام الطلب'],
  table_released: [Armchair, 'تحرير الطاولة'],
  transfer_verified: [BadgeCheck, 'تدقيق التحويل'],
  transfer_rejected: [CircleX, 'تحويل لم يصل'],
  qr_open: [QrCode, 'فتح الطاولة للـ QR'],
  item_status: [Flame, 'حركة صنف'],
};

/** مراحل الطلب الرئيسية لشريط التقدم */
const STAGES = [
  ['created', 'الإنشاء'],
  ['sent', 'المطبخ'],
  ['preparing', 'التحضير'],
  ['ready', 'جاهز'],
  ['served', 'التقديم'],
  ['paid', 'الدفع'],
];

export function stagesOf(order) {
  const types = new Set(order.events.map((e) => e.type));
  const at = (t) => order.events.find((e) => e.type === t);
  // التقديم يُعتبر مكتملاً عند الدفع إن لم يُسجَّل صراحة (تيك وي مثلاً)
  return STAGES.map(([k, label]) => {
    let done = types.has(k);
    if (!done && k === 'served' && types.has('paid')) done = true;
    if (!done && k === 'preparing' && (types.has('ready') || types.has('served'))) done = true;
    return { k, label, done, time: at(k)?.created_at };
  });
}

/** نافذة تفاصيل العملية وتسلسلها من البداية حتى النهاية */
export default function OrderTimeline({ orderId, onClose }) {
  const money = useMoney();
  const { data: o, loading } = useData(`/orders/${orderId}`, ['orders', 'kitchen'], [orderId]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try { await navigator.clipboard.writeText(o.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <Modal wide title="تفاصيل العملية" onClose={onClose}>
      {loading || !o ? <Loading /> : (
        <div className="otl">
          <div className="otl-head">
            <button className="otl-code" onClick={copy} title="نسخ الكود">
              <span dir="ltr">{o.code}</span><Copy size={15} aria-hidden />
              {copied && <span className="otl-copied">تم النسخ</span>}
            </button>
            <span className={`badge ${o.status === 'paid' ? 'badge-ok' : o.status === 'cancelled' ? 'badge-err' : 'badge-warn'}`}>
              {o.status === 'paid' ? 'مكتمل' : o.status === 'cancelled' ? 'ملغى' : 'قيد التنفيذ'}
            </span>
          </div>

          {o.status !== 'cancelled' && (
            <ol className="stepper" aria-label="مراحل الطلب">
              {stagesOf(o).map((s, i, arr) => {
                const current = !s.done && (i === 0 || arr[i - 1].done);
                return (
                  <li key={s.k} className={`step ${s.done ? 'done' : ''} ${current ? 'current' : ''}`}>
                    <span className="step-dot" aria-hidden>{s.done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
                    <span className="step-label">{s.label}</span>
                    <span className="step-time">{s.time ? timeOf(s.time) : ''}</span>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="otl-grid">
            <section>
              <h4 className="section-title first">بيانات الطلب</h4>
              <dl className="info-list">
                <div className="info-row"><dt><Armchair size={15} /> النوع</dt><dd>{ORDER_TYPES[o.type]}{o.table_name ? ` · ${o.table_name}` : ''}</dd></div>
                {o.guests ? <div className="info-row"><dt><Users size={15} /> الأشخاص</dt><dd>{o.guests}</dd></div> : null}
                <div className="info-row"><dt><UserRound size={15} /> العميل</dt><dd>{o.customer_name || '—'}</dd></div>
                <div className="info-row"><dt><Phone size={15} /> الجوال</dt><dd dir="ltr" className="cell-start">{o.customer_phone || '—'}</dd></div>
                {o.address && <div className="info-row"><dt><MapPin size={15} /> العنوان</dt><dd>{o.address}</dd></div>}
                <div className="info-row"><dt><UserRound size={15} /> أنشأه</dt><dd>{o.waiter_name || '—'}</dd></div>
                {o.cashier_name && <div className="info-row"><dt><Banknote size={15} /> الكاشير</dt><dd>{o.cashier_name}</dd></div>}
              </dl>

              <h4 className="section-title">الأصناف</h4>
              <ul className="otl-items">
                {o.items.map((i) => (
                  <li key={i.id} className={i.status === 'cancelled' ? 'line-cancelled' : ''}>
                    <span>{i.qty}× {i.name}{i.modifiers.length ? <small className="muted"> ({i.modifiers.map((m) => m.name).join('، ')})</small> : null}</span>
                    <span className={`status status-${i.status}`}>{ITEM_STATUS[i.status]}</span>
                    <span>{money(i.price * i.qty)}</span>
                  </li>
                ))}
              </ul>
              <div className="otl-total"><span>الإجمالي</span><strong>{money(o.total)}</strong></div>
              {o.payments.length > 0 && (
                <div className="muted small">{o.payments.map((p) => `${PAY_METHODS[p.method]} ${money(p.amount)}`).join(' · ')}</div>
              )}
            </section>

            <section>
              <h4 className="section-title first">التسلسل الكامل</h4>
              <ol className="timeline">
                {o.events.map((e, idx) => {
                  const [Icon, label] = EVENT[e.type] || [FilePlus2, e.type];
                  return (
                    <li key={e.id} className={`tl-item tl-${e.type}`}>
                      <span className="tl-icon" aria-hidden><Icon size={16} /></span>
                      <div className="tl-body">
                        <div className="tl-top">
                          <strong>{label}</strong>
                          <time dir="ltr" title={e.created_at}>{clockOf(e.created_at)}</time>
                        </div>
                        {e.type === 'payment' && e.data
                          ? <span>{PAY_METHODS[e.data.method]} · {money(e.data.amount)}</span>
                          : e.message && <span>{e.message}</span>}
                        {e.type === 'sent' && e.data?.items && (
                          <span className="muted small">{e.data.items.map((x) => `${x.qty}× ${x.name}`).join('، ')}</span>
                        )}
                        {idx > 0 && <small className="muted">+{spanOf(o.events[0].created_at, e.created_at)} من البداية · بعد {spanOf(o.events[idx - 1].created_at, e.created_at)}</small>}
                        {(e.user_name || ['online', 'created', 'items_added', 'sent', 'bill_requested', 'bill_cancelled'].includes(e.type) && o.source === 'online') && <small className="muted">بواسطة {e.user_name || 'الزبون (QR)'}{e.user_role ? ` (${ROLE_LABELS[e.user_role]})` : ''}</small>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
