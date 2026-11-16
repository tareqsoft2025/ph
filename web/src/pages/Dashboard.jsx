import { Link } from 'react-router-dom';
import { useApp, useData, useMoney, has, Loading, PageHead, Empty, todayStr } from '../lib.jsx';
import { Stat, Bars } from './Reports.jsx';
import { TriangleAlert, CircleCheck, Plus, Fingerprint, CalendarOff, FileWarning } from 'lucide-react';

export default function Dashboard() {
  const money = useMoney();
  const today = todayStr();
  const rep = useData(`/reports/summary?from=${today}&to=${today}`, ['orders']);
  const tables = useData('/tables', ['tables']);
  const open = useData('/orders?status=open', ['orders']);
  const shift = useData('/shifts/current', ['shift']);
  const { user } = useApp();
  const att = useData(has(user, 'hr.attendance') ? '/attendance' : null, ['attendance', 'hr']);
  const hr = useData(has(user, 'hr.employees') ? '/hr/alerts' : null, ['hr']);

  if (rep.loading) return <Loading />;
  const t = rep.data?.totals || {};
  const occupied = (tables.data || []).filter((x) => x.status === 'occupied').length;

  return (
    <div>
      <PageHead title="لوحة التحكم" sub={`ملخص اليوم ${today}`}>
        <Link className="btn btn-primary" to="/pos"><Plus size={18} /> طلب جديد</Link>
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
          <h3>الفريق اليوم</h3>
          {att.data ? (
            <ul className="simple-list">
              <li><span className="meta-line"><Fingerprint size={15} aria-hidden /> حاضرون</span><strong>{att.data.totals.in} / {att.data.rows.length}</strong></li>
              <li><span className="meta-line"><TriangleAlert size={15} aria-hidden /> متأخرون</span><strong className={att.data.totals.late ? 'text-warn' : ''}>{att.data.totals.late}</strong></li>
              <li><span className="meta-line"><CalendarOff size={15} aria-hidden /> في إجازة</span><strong>{att.data.totals.leave}</strong></li>
              {hr.data?.pending_leaves > 0 && <li><Link to="/leaves">طلبات إجازة بانتظار الاعتماد</Link><span className="badge badge-warn">{hr.data.pending_leaves}</span></li>}
              {hr.data && hr.data.docs.length + hr.data.contracts.length > 0 && (
                <li><Link to="/employees" className="meta-line"><FileWarning size={15} aria-hidden /> مستندات وعقود تحتاج تجديد</Link><span className="badge badge-err">{hr.data.docs.length + hr.data.contracts.length}</span></li>
              )}
            </ul>
          ) : att.loading ? <Loading /> : <Empty text="غير متاح لصلاحياتك" />}
        </section>
        <section className="card">
          <h3>تنبيهات المخزون</h3>
          {rep.data?.lowStock.length ? (
            <ul className="simple-list">{rep.data.lowStock.map((i) => <li key={i.id}><span className="meta-line"><TriangleAlert size={15} className="text-warn" aria-hidden /> {i.name}</span><span className="text-err">{+i.stock.toFixed(2)} {i.unit}</span></li>)}</ul>
          ) : <Empty icon={CircleCheck} text="لا توجد نواقص" />}
        </section>
      </div>
    </div>
  );
}
