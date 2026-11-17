import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, ReceiptText, CreditCard, Percent, Printer, History, Armchair, ShoppingBag, Bike, Clock, BellRing,
  CircleCheckBig, Wallet, Banknote, Smartphone, UserRound, Phone, MapPin, Users, Inbox, LockOpen,
} from 'lucide-react';
import { api } from '../api.js';
import {
  useApp, useData, useMoney, useNow, has, Loading, Empty, ORDER_TYPES, ITEM_STATUS, minutesSince, timeOf, todayStr,
} from '../lib.jsx';
import { PayModal, DiscountModal } from '../components/PaymentModals.jsx';
import Receipt from '../components/Receipt.jsx';
import OrderTimeline from '../components/OrderTimeline.jsx';
import CollectionsHistory from '../components/CollectionsHistory.jsx';

const TYPE_ICON = { dine_in: Armchair, takeaway: ShoppingBag, delivery: Bike };
const FILTERS = [['all', 'الكل'], ['bill', 'طلبوا الحساب'], ['dine_in', 'الصالة'], ['takeaway', 'سفري'], ['delivery', 'توصيل']];

export default function Cashier() {
  const { user } = useApp();
  const money = useMoney();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState('queue');
  const selectedId = Number(params.get('order')) || null;
  const select = (id) => setParams(id ? { order: String(id) } : {}, { replace: true });
  useNow(30000);

  const open = useData('/orders?status=open', ['orders', 'kitchen', 'tables']);
  const shift = useData('/shifts/current', ['shift', 'orders']);
  const today = useData(`/orders?status=paid&date=${todayStr()}`, ['orders']);

  const rows = useMemo(() => {
    const list = (open.data || []).filter((o) => {
      if (filter === 'bill' && !o.bill_requested_at) return false;
      if (['dine_in', 'takeaway', 'delivery'].includes(filter) && o.type !== filter) return false;
      const t = q.trim();
      return !t || [o.code, o.table_name, o.customer_name, o.customer_phone].some((v) => v && String(v).includes(t));
    });
    // من طلب الحساب أولاً، ثم الأقدم
    return list.sort((a, b) => (b.bill_requested_at ? 1 : 0) - (a.bill_requested_at ? 1 : 0) || a.id - b.id);
  }, [open.data, filter, q]);

  const billCount = (open.data || []).filter((o) => o.bill_requested_at).length;
  const s = shift.data;
  const byMethod = Object.fromEntries((s?.payments || []).map((p) => [p.method, p.total]));

  // اختيار أول طلب تلقائياً على الشاشات الكبيرة
  useEffect(() => {
    if (!selectedId && rows.length && window.innerWidth > 960) select(rows[0].id);
  }, [rows.length]); // eslint-disable-line

  return (
    <div className="cashier">
      <header className="cashier-top">
        <div className={`cstat ${s ? 'ok' : 'warn'}`}>
          {s ? <LockOpen size={18} aria-hidden /> : <Wallet size={18} aria-hidden />}
          <div><span>الوردية</span><strong>{s ? `مفتوحة · ${timeOf(s.opened_at)}` : 'مغلقة'}</strong></div>
          {!s && has(user, 'shifts.manage') && <button className="btn btn-sm btn-primary" onClick={() => navigate('/shifts')}>فتح وردية</button>}
        </div>
        <div className="cstat"><Banknote size={18} aria-hidden /><div><span>نقدي</span><strong>{money(byMethod.cash)}</strong></div></div>
        <div className="cstat"><CreditCard size={18} aria-hidden /><div><span>بطاقة</span><strong>{money(byMethod.card)}</strong></div></div>
        <div className="cstat"><Smartphone size={18} aria-hidden /><div><span>محفظة</span><strong>{money(byMethod.wallet)}</strong></div></div>
        <div className="cstat"><CircleCheckBig size={18} aria-hidden /><div><span>طلبات مدفوعة اليوم</span><strong>{today.data?.length ?? '…'}</strong></div></div>
      </header>

      <div className="seg cashier-tabs" role="tablist" aria-label="أقسام الكاشير">
        <button role="tab" aria-selected={view === 'queue'} className={view === 'queue' ? 'active' : ''} onClick={() => setView('queue')}>بانتظار الدفع</button>
        <button role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>سجل التحصيلات</button>
      </div>

      {view === 'history' ? <CollectionsHistory /> : (
      <div className="cashier-body">
        <section className={`cq ${selectedId ? 'has-selection' : ''}`} aria-label="الطلبات بانتظار الدفع">
          <div className="cq-head">
            <h2>بانتظار الدفع <span className="lane-count">{(open.data || []).length}</span></h2>
            <label className="search-field">
              <Search size={17} aria-hidden />
              <input type="search" placeholder="كود، طاولة، عميل، جوال" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
            </label>
            <div className="chip-list" role="tablist">
              {FILTERS.map(([k, v]) => (
                <button key={k} role="tab" aria-selected={filter === k} className={`chip ${filter === k ? 'chip-on' : ''}`} onClick={() => setFilter(k)}>
                  {v}{k === 'bill' && billCount > 0 && <span className="chip-badge">{billCount}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="cq-list">
            {open.loading ? <Loading /> : !rows.length ? <Empty icon={Inbox} text="لا توجد طلبات بانتظار الدفع" /> : rows.map((o) => {
              const Icon = TYPE_ICON[o.type];
              return (
                <button key={o.id} className={`cq-item ${selectedId === o.id ? 'active' : ''} ${o.bill_requested_at ? 'bill' : ''}`} onClick={() => select(o.id)}>
                  <span className="cq-icon" aria-hidden><Icon size={18} /></span>
                  <span className="cq-main">
                    <strong>{o.type === 'dine_in' ? o.table_name : ORDER_TYPES[o.type]}{o.customer_name ? ` · ${o.customer_name}` : ''}</strong>
                    <small><bdi dir="ltr">{o.code}</bdi> · {o.items_count} صنف · <Clock size={11} aria-hidden /> {minutesSince(o.created_at)} د</small>
                  </span>
                  <span className="cq-side">
                    <strong>{money(o.total)}</strong>
                    {o.bill_requested_at ? <span className="badge badge-warn"><BellRing size={11} /> طلب الحساب</span>
                      : o.ready_items > 0 ? <span className="badge badge-ok">جاهز</span>
                        : o.pending_items > 0 ? <span className="badge">لم يُرسل</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="cdetail">
          {selectedId ? <OrderPanel key={selectedId} id={selectedId} onDone={() => { select(null); open.reload(); shift.reload(); today.reload(); }} onBack={() => select(null)} />
            : <Empty icon={ReceiptText} text="اختر طلباً من القائمة لعرض تفاصيله وتحصيل الدفع" />}
        </section>
      </div>
      )}
    </div>
  );
}

function OrderPanel({ id, onDone, onBack }) {
  const { user } = useApp();
  const money = useMoney();
  const { data: o, loading, setData, reload } = useData(`/orders/${id}`, ['orders', 'kitchen'], [id]);
  const [paying, setPaying] = useState(false);
  const [discount, setDiscount] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [timeline, setTimeline] = useState(false);
  const [paidResult, setPaidResult] = useState(null);

  if (loading && !o) return <Loading />;
  if (!o) return <Empty text="الطلب غير موجود" />;
  const Icon = TYPE_ICON[o.type];
  const items = o.items.filter((i) => i.status !== 'cancelled');
  const remaining = Math.round((o.total - o.paid) * 100) / 100;

  if (paidResult) {
    return (
      <div className="paid-state">
        <span className="paid-icon" aria-hidden><CircleCheckBig size={40} /></span>
        <h2>تم الدفع وإغلاق الطلب</h2>
        <p className="order-code" dir="ltr">{o.code}</p>
        {o.type === 'dine_in' && o.table_name && <p className="badge badge-ok">تم تحرير {o.table_name}</p>}
        {paidResult.change > 0 && <p className="paid-change">الباقي للعميل: <strong>{money(paidResult.change)}</strong></p>}
        <div className="btn-row">
          <button className="btn btn-lg" onClick={() => setReceipt(o)}><Printer size={18} /> طباعة الفاتورة</button>
          <button className="btn btn-lg btn-primary" onClick={onDone}>الطلب التالي</button>
        </div>
        {receipt && <Receipt order={receipt} onClose={() => setReceipt(null)} />}
      </div>
    );
  }

  return (
    <div className="cpanel">
      <header className="cpanel-head">
        <button className="btn btn-ghost btn-sm cpanel-back" onClick={onBack}>رجوع</button>
        <span className="cq-icon lg" aria-hidden><Icon size={22} /></span>
        <div className="cpanel-id">
          <h2>{o.type === 'dine_in' ? o.table_name : ORDER_TYPES[o.type]}</h2>
          <span className="order-code" dir="ltr">{o.code}</span>
        </div>
        <button className="btn btn-sm" onClick={() => setTimeline(true)}><History size={16} /> التسلسل</button>
      </header>

      {o.bill_requested_at && <div className="alert alert-warn"><BellRing size={16} /> طلب {o.waiter_name || 'النادل'} الحساب الساعة {timeOf(o.bill_requested_at)}</div>}

      <div className="cpanel-meta">
        <span><UserRound size={14} aria-hidden /> {o.customer_name || '—'}</span>
        <span><Phone size={14} aria-hidden /> <bdi dir="ltr">{o.customer_phone || '—'}</bdi></span>
        {o.guests ? <span><Users size={14} aria-hidden /> {o.guests} أشخاص</span> : null}
        {o.address && <span><MapPin size={14} aria-hidden /> {o.address}</span>}
        <span><Clock size={14} aria-hidden /> {timeOf(o.created_at)} · {o.waiter_name}</span>
      </div>

      <ul className="cpanel-items">
        {items.map((i) => (
          <li key={i.id}>
            <span className="ki-qty">{i.qty}</span>
            <span className="cpi-name">{i.name}{i.modifiers.length > 0 && <small>{i.modifiers.map((m) => m.name).join('، ')}</small>}</span>
            <span className={`status status-${i.status}`}>{ITEM_STATUS[i.status]}</span>
            <span className="cpi-price">{money(i.price * i.qty)}</span>
          </li>
        ))}
      </ul>

      <div className="cpanel-totals">
        <div className="tot-row"><span>المجموع</span><span>{money(o.subtotal)}</span></div>
        {o.discount > 0 && <div className="tot-row text-ok"><span>الخصم</span><span>− {money(o.discount)}</span></div>}
        {o.service > 0 && <div className="tot-row"><span>رسوم الخدمة</span><span>{money(o.service)}</span></div>}
        {o.delivery_fee > 0 && <div className="tot-row"><span>التوصيل</span><span>{money(o.delivery_fee)}</span></div>}
        <div className="tot-row"><span>الضريبة</span><span>{money(o.tax)}</span></div>
        {o.paid > 0 && <div className="tot-row"><span>مدفوع مسبقاً</span><span>{money(o.paid)}</span></div>}
        <div className="tot-row big"><span>المطلوب</span><span>{money(remaining)}</span></div>
      </div>

      <div className="cpanel-actions">
        {has(user, 'orders.discount') && <button className="btn" onClick={() => setDiscount(true)}><Percent size={17} /> خصم</button>}
        <button className="btn" onClick={() => setReceipt(o)}><Printer size={17} /> فاتورة مبدئية</button>
        <button className="btn btn-ok btn-lg cpanel-pay" onClick={() => setPaying(true)} disabled={!items.length}>
          <CreditCard size={20} /> تحصيل {money(remaining)}
        </button>
      </div>

      {paying && <PayModal key={o.id} order={o} money={money} onClose={() => setPaying(false)} onPaid={(r) => { setPaying(false); setData(r.order); if (r.order.status === 'paid') setPaidResult(r); else reload(); }} />}
      {discount && <DiscountModal order={o} onClose={() => setDiscount(false)} onDone={(x) => { setData(x); setDiscount(false); }} />}
      {receipt && <Receipt order={receipt} onClose={() => setReceipt(null)} />}
      {timeline && <OrderTimeline orderId={o.id} onClose={() => setTimeline(false)} />}
    </div>
  );
}
