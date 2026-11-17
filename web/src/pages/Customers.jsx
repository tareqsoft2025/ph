import { useState } from 'react';
import { useData, useMoney, Loading, PageHead, Empty } from '../lib.jsx';
import { Users as UsersIcon, Star } from 'lucide-react';

const BILL = { cash: 'نقداً', wallet: 'محفظة', bank: 'بنك', jawwalpay: 'جوال بي' };

export default function Customers() {
  const money = useMoney();
  const [q, setQ] = useState('');
  const { data, loading } = useData(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`, [], [q]);
  return (
    <div>
      <PageHead title="العملاء">
        <input type="search" placeholder="بحث بالاسم أو الجوال" value={q} onChange={(e) => setQ(e.target.value)} />
      </PageHead>
      {loading ? <Loading /> : !data?.length ? <Empty icon={UsersIcon} text="لا يوجد عملاء بعد — يُضاف العميل تلقائياً عند إدخال رقم جواله في الطلب" /> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>الاسم</th><th>الجوال</th><th>العنوان</th><th>الدفع الإلكتروني</th><th>الطلبات</th><th>إجمالي المشتريات</th><th>النقاط</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>{c.name || '—'}</td><td dir="ltr">{c.phone}</td><td className="small">{c.address}</td>
                  <td className="small">{c.pay_method ? <>{BILL[c.pay_method] || c.pay_method}{c.pay_phone ? <> · <bdi dir="ltr">{c.pay_phone}</bdi></> : null}{c.pay_name && c.pay_name !== c.name ? <><br /><span className="muted">{c.pay_name}</span></> : null}</> : '—'}</td>
                  <td>{c.orders_count}</td><td>{money(c.total_spent)}</td><td><span className="badge badge-ok"><Star size={12} aria-hidden /> {c.points}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
