import { useState } from 'react';
import { useData, useMoney, Loading, PageHead, Empty } from '../lib.jsx';

export default function Customers() {
  const money = useMoney();
  const [q, setQ] = useState('');
  const { data, loading } = useData(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`, [], [q]);
  return (
    <div>
      <PageHead title="العملاء">
        <input type="search" placeholder="بحث بالاسم أو الجوال" value={q} onChange={(e) => setQ(e.target.value)} />
      </PageHead>
      {loading ? <Loading /> : !data?.length ? <Empty icon="👥" text="لا يوجد عملاء بعد — يُضاف العميل تلقائياً عند إدخال رقم جواله في الطلب" /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>الاسم</th><th>الجوال</th><th>العنوان</th><th>الطلبات</th><th>إجمالي المشتريات</th><th>النقاط</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>{c.name || '—'}</td><td dir="ltr">{c.phone}</td><td className="small">{c.address}</td>
                  <td>{c.orders_count}</td><td>{money(c.total_spent)}</td><td><span className="badge badge-ok">⭐ {c.points}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
