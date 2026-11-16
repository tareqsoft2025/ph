import { Link } from 'react-router-dom';
import { useData, useMoney, Loading, PageHead, Empty, todayStr } from '../lib.jsx';
import { Stat, Bars } from './Reports.jsx';

export default function Dashboard() {
  const money = useMoney();
  const today = todayStr();
  const rep = useData(`/reports/summary?from=${today}&to=${today}`, ['orders']);
  const tables = useData('/tables', ['tables']);
  const open = useData('/orders?status=open', ['orders']);
  const shift = useData('/shifts/current', ['shift']);

  if (rep.loading) return <Loading />;
  const t = rep.data?.totals || {};
  const occupied = (tables.data || []).filter((x) => x.status === 'occupied').length;

  return (
    <div>
      <PageHead title="لوحة التحكم" sub={`ملخص اليوم ${today}`}>
        <Link className="btn btn-primary" to="/pos">+ طلب جديد</Link>
      </PageHead>
      {!shift.loading && !shift.data && (
        <div className="alert alert-warn">لا توجد وردية مفتوحة — <Link to="/shifts">افتح وردية</Link> لتسجيل حركة الصندوق.</div>
      )}
      <div className="stats">
        <Stat label="مبيعات اليوم" value={money(t.sales)} tone="primary" />
        <Stat label="طلبات مدفوعة" value={t.orders || 0} />
        <Stat label="طلبات مفتوحة" value={open.data?.length ?? '…'} />
        <Stat label="الطاولات المشغولة" value={`${occupied} / ${tables.data?.length ?? 0}`} />
        <Stat label="متوسط الفاتورة" value={money(t.avg_ticket)} />
        <Stat label="مجمل الربح" value={money(t.gross_profit)} tone="ok" />
      </div>
      <div className="report-grid">
        <section className="card">
          <h3>الأكثر مبيعاً اليوم</h3>
          {rep.data?.topItems.length ? <Bars rows={rep.data.topItems.slice(0, 6)} label="name" value="qty" /> : <Empty text="لا مبيعات بعد" />}
        </section>
        <section className="card">
          <h3>تنبيهات المخزون</h3>
          {rep.data?.lowStock.length ? (
            <ul className="simple-list">{rep.data.lowStock.map((i) => <li key={i.id}><span>⚠️ {i.name}</span><span className="text-err">{+i.stock.toFixed(2)} {i.unit}</span></li>)}</ul>
          ) : <Empty icon="✅" text="لا توجد نواقص" />}
        </section>
      </div>
    </div>
  );
}
