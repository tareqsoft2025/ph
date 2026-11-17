import { useMemo, useState } from 'react';
import { Search, Banknote, CreditCard, Smartphone, Receipt as ReceiptIcon, UserRound, Armchair, ShoppingBag, Bike, Printer, History, Users, Clock, Inbox } from 'lucide-react';
import { useApp, useData, useMoney, Modal, Empty, Loading, ORDER_TYPES, PAY_METHODS, ITEM_STATUS, todayStr } from '../lib.jsx';
import Receipt from './Receipt.jsx';
import OrderTimeline from './OrderTimeline.jsx';

const TYPE_ICON = { dine_in: Armchair, takeaway: ShoppingBag, delivery: Bike };
const M_ICON = { cash: Banknote, card: CreditCard, wallet: Smartphone };
const ymd = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const RANGES = [['today', 'اليوم'], ['yesterday', 'أمس'], ['7', '7 أيام'], ['30', '30 يوم'], ['custom', 'فترة محددة']];

/** سجل التحصيلات: الكاشير يرى تحصيلاته فقط، والمدير يرى الجميع مع اسم المحصّل */
export default function CollectionsHistory() {
  const money = useMoney();
  const { user } = useApp();
  const [range, setRange] = useState('today');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [method, setMethod] = useState('');
  const [cashier, setCashier] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  const [f, t] = useMemo(() => {
    if (range === 'today') return [todayStr(), todayStr()];
    if (range === 'yesterday') return [daysAgo(1), daysAgo(1)];
    if (range === '7') return [daysAgo(6), todayStr()];
    if (range === '30') return [daysAgo(29), todayStr()];
    return [from, to];
  }, [range, from, to]);

  const qs = new URLSearchParams({ from: f, to: t });
  if (method) qs.set('method', method);
  if (cashier) qs.set('user_id', cashier);
  if (q.trim()) qs.set('q', q.trim());
  const { data, loading } = useData(`/payments/history?${qs}`, ['orders'], [qs.toString()]);

  const all = !!data?.all;
  const byMethod = Object.fromEntries((data?.summary.byMethod || []).map((m) => [m.method, m]));

  return (
    <div className="chist">
      <div className="chist-filters">
        <div className="seg" role="tablist" aria-label="الفترة">
          {RANGES.map(([k, v]) => <button key={k} role="tab" aria-selected={range === k} className={range === k ? 'active' : ''} onClick={() => setRange(k)}>{v}</button>)}
        </div>
        {range === 'custom' && (
          <span className="chist-dates">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="من" />
            <span className="muted">إلى</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="إلى" />
          </span>
        )}
        <label className="search-field">
          <Search size={17} aria-hidden />
          <input type="search" placeholder="كود الطلب، عميل، جوال، طاولة" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث في التحصيلات" />
        </label>
        <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="طريقة الدفع">
          <option value="">كل طرق الدفع</option>
          {Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {all && (
          <select value={cashier} onChange={(e) => setCashier(e.target.value)} aria-label="الموظف المحصّل">
            <option value="">كل الموظفين</option>
            {data.cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {!all && data && <p className="muted small chist-note"><UserRound size={14} aria-hidden /> تظهر هنا تحصيلاتك أنت فقط ({user.name}).</p>}

      <div className="chist-stats">
        <div className="cstat ok"><ReceiptIcon size={18} aria-hidden /><div><span>إجمالي التحصيل</span><strong>{money(data?.summary.total || 0)}</strong></div></div>
        <div className="cstat"><Users size={18} aria-hidden /><div><span>عدد العمليات</span><strong>{data?.summary.count ?? '…'}</strong></div></div>
        {Object.entries(PAY_METHODS).map(([k, v]) => { const I = M_ICON[k]; return <div key={k} className="cstat"><I size={18} aria-hidden /><div><span>{v}</span><strong>{money(byMethod[k]?.total || 0)}</strong></div></div>; })}
      </div>

      {all && data?.summary.byCashier.length > 0 && (
        <div className="chist-by">
          <h3>التحصيل حسب الموظف</h3>
          <div className="chip-list">
            {data.summary.byCashier.map((c) => (
              <button key={c.user_id} className={`chip ${String(c.user_id) === cashier ? 'chip-on' : ''}`} onClick={() => setCashier(String(c.user_id) === cashier ? '' : String(c.user_id))}>
                <UserRound size={13} aria-hidden /> {c.user_name || '—'} · {money(c.total)} <span className="chip-badge">{c.n}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && !data ? <Loading /> : !data?.rows.length ? <Empty icon={Inbox} text="لا توجد تحصيلات في هذه الفترة" /> : (
        <ul className="chist-list">
          {data.rows.map((r) => {
            const I = TYPE_ICON[r.type] || ReceiptIcon;
            return (
              <li key={`${r.order_id}-${r.user_id}`}>
                <button className="chist-row" onClick={() => setOpen(r)}>
                  <span className="cq-icon" aria-hidden><I size={18} /></span>
                  <span className="chist-main">
                    <strong>{r.type === 'dine_in' ? r.table_name || 'صالة' : ORDER_TYPES[r.type]}{r.customer_name ? ` · ${r.customer_name}` : ''}</strong>
                    <small><bdi dir="ltr">{r.code}</bdi> · <Clock size={11} aria-hidden /> {r.paid_at.slice(0, 10) === todayStr() ? '' : `${r.paid_at.slice(0, 10)} `}{r.paid_at.slice(11, 16)}</small>
                  </span>
                  {all && <span className="chist-who"><UserRound size={13} aria-hidden /> {r.user_name || '—'}</span>}
                  <span className="chist-methods">{r.methods.split(',').map((m) => <span key={m} className="badge">{PAY_METHODS[m]}</span>)}</span>
                  <strong className="chist-amt">{money(r.amount)}</strong>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && <CollectionDetail row={open} all={all} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CollectionDetail({ row, all, onClose }) {
  const money = useMoney();
  const { data: o, loading } = useData(`/orders/${row.order_id}`, [], [row.order_id]);
  const [receipt, setReceipt] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const items = (o?.items || []).filter((i) => i.status !== 'cancelled');
  return (
    <Modal title={`تحصيل ${row.code}`} onClose={onClose} wide footer={o && (
      <>
        <button className="btn" onClick={() => setTimeline(true)}><History size={16} /> التسلسل</button>
        <button className="btn btn-primary" onClick={() => setReceipt(true)}><Printer size={16} /> الفاتورة</button>
      </>
    )}>
      {loading && !o ? <Loading /> : !o ? <Empty text="الطلب غير موجود" /> : (
        <div className="chd">
          <div className="cpanel-meta">
            <span><UserRound size={14} aria-hidden /> {o.customer_name || '—'}</span>
            {o.customer_phone && <span><bdi dir="ltr">{o.customer_phone}</bdi></span>}
            <span>{o.type === 'dine_in' ? o.table_name : ORDER_TYPES[o.type]}</span>
            {o.waiter_name && <span>النادل: {o.waiter_name}</span>}
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
            <div className="tot-row big"><span>الإجمالي</span><span>{money(o.total)}</span></div>
          </div>
          <h4 className="chd-h">الدفعات</h4>
          <ul className="pay-lines">
            {o.payments.map((p) => (
              <li key={p.id}>
                <span>{PAY_METHODS[p.method]}</span>
                <span>{p.created_at.slice(0, 16).replace('T', ' ')}</span>
                <span className="muted"><UserRound size={12} aria-hidden /> {p.user_name || '—'}</span>
                <strong>{money(p.amount)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {receipt && o && <Receipt order={o} onClose={() => setReceipt(false)} />}
      {timeline && o && <OrderTimeline orderId={o.id} onClose={() => setTimeline(false)} />}
    </Modal>
  );
}
