import { useState } from 'react';
import { useData, useMoney, Loading, PageHead, Empty, ORDER_TYPES, PAY_METHODS, todayStr } from '../lib.jsx';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function Stat({ label, value, tone }) {
  return <div className={`stat ${tone || ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

/** أشرطة أفقية بسيطة */
export function Bars({ rows, label, value, fmt }) {
  const max = Math.max(...rows.map((r) => r[value] || 0), 1);
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div key={i} className="bar-row">
          <span className="bar-label">{r[label]}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${(100 * (r[value] || 0)) / max}%` }} /></span>
          <span className="bar-val">{fmt ? fmt(r[value]) : r[value]}</span>
        </div>
      ))}
    </div>
  );
}

/** أعمدة عمودية لساعات اليوم */
export function HourChart({ rows, money }) {
  const byHour = Object.fromEntries(rows.map((r) => [r.hour, r]));
  const hours = rows.length ? Array.from({ length: Math.max(...rows.map((r) => r.hour)) - Math.min(...rows.map((r) => r.hour)) + 1 }, (_, i) => Math.min(...rows.map((r) => r.hour)) + i) : [];
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="cols" role="img" aria-label="المبيعات حسب الساعة">
      {hours.map((h) => (
        <div key={h} className="col" title={`${h}:00 — ${money(byHour[h]?.total || 0)} (${byHour[h]?.orders || 0} طلب)`}>
          <span className="col-fill" style={{ height: `${(100 * (byHour[h]?.total || 0)) / max}%` }} />
          <span className="col-label">{h}</span>
        </div>
      ))}
    </div>
  );
}

export default function Reports() {
  const money = useMoney();
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const { data, loading } = useData(`/reports/summary?from=${from}&to=${to}`, ['orders'], [from, to]);
  const preset = (a, b = 0) => { setFrom(daysAgo(a)); setTo(daysAgo(b)); };

  return (
    <div>
      <PageHead title="التقارير">
        <div className="seg">
          <button onClick={() => preset(0)}>اليوم</button>
          <button onClick={() => preset(1, 1)}>أمس</button>
          <button onClick={() => preset(6)}>7 أيام</button>
          <button onClick={() => preset(29)}>30 يوم</button>
        </div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى" />
        <button className="btn" onClick={() => window.print()}>🖨️</button>
      </PageHead>
      {loading || !data ? <Loading /> : (
        <>
          <div className="stats">
            <Stat label="إجمالي المبيعات" value={money(data.totals.sales)} tone="primary" />
            <Stat label="عدد الطلبات" value={data.totals.orders} />
            <Stat label="متوسط الفاتورة" value={money(data.totals.avg_ticket)} />
            <Stat label="صافي المبيعات (بدون ضريبة)" value={money(data.totals.net_sales)} />
            <Stat label="الضريبة" value={money(data.totals.tax)} />
            <Stat label="الخصومات" value={money(data.totals.discounts)} />
            <Stat label="تكلفة المبيعات" value={money(data.totals.cogs)} />
            <Stat label="مجمل الربح" value={money(data.totals.gross_profit)} tone="ok" />
            <Stat label="الهدر" value={money(data.totals.waste)} tone={data.totals.waste > 0 ? 'warn' : ''} />
            <Stat label="طلبات ملغاة" value={data.totals.cancelled} tone={data.totals.cancelled ? 'warn' : ''} />
          </div>
          <div className="report-grid">
            <section className="card">
              <h3>الأصناف الأكثر مبيعاً</h3>
              {data.topItems.length ? <Bars rows={data.topItems} label="name" value="qty" /> : <Empty text="لا بيانات" />}
            </section>
            <section className="card">
              <h3>المبيعات حسب الفئة</h3>
              {data.byCategory.length ? <Bars rows={data.byCategory} label="name" value="total" fmt={money} /> : <Empty text="لا بيانات" />}
            </section>
            <section className="card">
              <h3>ساعات الذروة</h3>
              {data.byHour.length ? <HourChart rows={data.byHour} money={money} /> : <Empty text="لا بيانات" />}
            </section>
            <section className="card">
              <h3>طرق الدفع</h3>
              {data.byPayment.length ? <Bars rows={data.byPayment.map((p) => ({ ...p, name: PAY_METHODS[p.method] }))} label="name" value="total" fmt={money} /> : <Empty text="لا بيانات" />}
              <h3>نوع الطلب</h3>
              {data.byType.length ? <Bars rows={data.byType.map((p) => ({ ...p, name: `${ORDER_TYPES[p.type]} (${p.orders})` }))} label="name" value="total" fmt={money} /> : <Empty text="لا بيانات" />}
            </section>
            <section className="card">
              <h3>أداء الموظفين</h3>
              {data.byStaff.length ? <Bars rows={data.byStaff.map((s) => ({ ...s, name: `${s.name} (${s.orders})` }))} label="name" value="total" fmt={money} /> : <Empty text="لا بيانات" />}
            </section>
            {data.byDay.length > 1 && (
              <section className="card">
                <h3>المبيعات اليومية</h3>
                <Bars rows={data.byDay} label="day" value="total" fmt={money} />
              </section>
            )}
            <section className="card">
              <h3>مواد تحت الحد الأدنى</h3>
              {data.lowStock.length ? (
                <ul className="simple-list">{data.lowStock.map((i) => <li key={i.id}><span>{i.name}</span><span className="text-err">{+i.stock.toFixed(2)} / {i.min_stock} {i.unit}</span></li>)}</ul>
              ) : <Empty icon="✅" text="المخزون جيد" />}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
