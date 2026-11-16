import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData, useMoney, useApp, Loading, Empty, PageHead, ORDER_TYPES, todayStr, timeOf, minutesSince, useNow } from '../lib.jsx';
import { Plus } from 'lucide-react';

const STATUS = { open: 'مفتوح', paid: 'مدفوع', cancelled: 'ملغى' };

export default function Orders() {
  const navigate = useNavigate();
  const money = useMoney();
  const { user } = useApp();
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [date, setDate] = useState(todayStr());
  useNow();

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (type) qs.set('type', type);
  if (status !== 'open' && date) qs.set('date', date);
  const { data, loading } = useData(`/orders?${qs}`, ['orders'], []);

  return (
    <div>
      <PageHead title="الطلبات">
        <button className="btn btn-primary" onClick={() => navigate('/pos')}><Plus size={18} /> طلب جديد</button>
      </PageHead>
      <div className="filters">
        <div className="seg">
          {[['open', 'المفتوحة'], ['paid', 'المدفوعة'], ['cancelled', 'الملغاة']].map(([k, v]) => (
            (user.role !== 'waiter' || k === 'open') &&
            <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{v}</button>
          ))}
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="نوع الطلب">
          <option value="">كل الأنواع</option>
          {Object.entries(ORDER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {status !== 'open' && <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="التاريخ" />}
      </div>
      {loading ? <Loading /> : !data?.length ? <Empty text="لا توجد طلبات" /> : (
        <div className="order-list">
          {data.map((o) => (
            <button key={o.id} className="order-row" onClick={() => navigate(`/pos/${o.id}`)}>
              <span className="o-num">#{o.number}</span>
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
