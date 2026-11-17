import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData, useMoney, useApp, has, Loading, Empty, PageHead, ORDER_TYPES, todayStr, timeOf, minutesSince, useNow } from '../lib.jsx';
import { Plus, History, Search } from 'lucide-react';
import OrderTimeline from '../components/OrderTimeline.jsx';

const STATUS = { open: 'مفتوح', paid: 'مدفوع', cancelled: 'ملغى' };

export default function Orders() {
  const navigate = useNavigate();
  const money = useMoney();
  const { user } = useApp();
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [date, setDate] = useState(todayStr());
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState('');
  useNow();

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (type) qs.set('type', type);
  if (status !== 'open' && date) qs.set('date', date);
  const { data, loading } = useData(`/orders?${qs}`, ['orders'], []);
  const term = q.trim();
  const rows = (data || []).filter((o) => !term || [o.code, o.customer_name, o.customer_phone, o.table_name].some((v) => v && String(v).includes(term)));

  return (
    <div>
      <PageHead title="الطلبات">
        <button className="btn btn-primary" onClick={() => navigate('/pos')}><Plus size={18} /> طلب جديد</button>
      </PageHead>
      <div className="filters">
        <div className="seg">
          {[['open', 'المفتوحة'], ['paid', 'المدفوعة'], ['cancelled', 'الملغاة']].map(([k, v]) => (
            (has(user, 'orders.view', 'payments.collect') || k === 'open') &&
            <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{v}</button>
          ))}
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="نوع الطلب">
          <option value="">كل الأنواع</option>
          {Object.entries(ORDER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {status !== 'open' && <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="التاريخ" />}
        <label className="search-field">
          <Search size={17} aria-hidden />
          <input type="search" placeholder="بحث بالكود أو العميل أو الجوال" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
        </label>
      </div>
      {loading ? <Loading /> : !rows.length ? <Empty text="لا توجد طلبات" /> : (
        <div className="order-list">
          {rows.map((o) => (
            <div key={o.id} className="order-row" role="button" tabIndex={0} onClick={() => navigate(`/pos/${o.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/pos/${o.id}`)}>
              <span className="o-num"><span className="order-code" dir="ltr">{o.code}</span>{o.source === 'online' && <span className="badge badge-warn src-online">رابط</span>}</span>
              <span className="o-info">
                <strong>{ORDER_TYPES[o.type]}{o.table_name ? ` · ${o.table_name}` : ''}{o.customer_name ? ` · ${o.customer_name}` : ''}</strong>
                <small className="muted">{timeOf(o.created_at)} · {o.items_count} صنف{o.waiter_name ? ` · ${o.waiter_name}` : ''}{o.status === 'open' ? ` · منذ ${minutesSince(o.created_at)} د` : ''}</small>
              </span>
              <span className="o-badges">
                {o.pending_items > 0 && <span className="badge badge-warn">لم يُرسل {o.pending_items}</span>}
                {o.ready_items > 0 && <span className="badge badge-ok">جاهز {o.ready_items}</span>}
                {o.status !== 'open' && <span className={`badge ${o.status === 'paid' ? 'badge-ok' : 'badge-err'}`}>{STATUS[o.status]}</span>}
              </span>
              <span className="o-total">{money(o.total)}</span>
              <button className="btn btn-sm btn-ghost o-detail" onClick={(e) => { e.stopPropagation(); setDetail(o.id); }} aria-label={`تفاصيل ${o.code}`}><History size={16} /> التفاصيل</button>
            </div>
          ))}
        </div>
      )}
      {detail && <OrderTimeline orderId={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
