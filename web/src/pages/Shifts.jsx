import { useState } from 'react';
import { api } from '../api.js';
import { useData, useMoney, useAction, useApp, has, Field, Loading, PageHead, PAY_METHODS, Empty } from '../lib.jsx';

export default function Shifts() {
  const money = useMoney();
  const { user } = useApp();
  const current = useData('/shifts/current', ['shift', 'orders']);
  const history = useData(has(user, 'reports.view') ? '/shifts' : null, ['shift']);
  const [run, busy] = useAction();
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [notes, setNotes] = useState('');
  const [result, setResult] = useState(null);

  if (current.loading) return <Loading />;
  const s = current.data;

  async function open() {
    if (await run(() => api('/shifts/open', { method: 'POST', body: { opening_cash: Number(opening) || 0 } }), 'تم فتح الوردية')) current.reload();
  }
  async function close() {
    if (!window.confirm('إغلاق الوردية الحالية؟')) return;
    const r = await run(() => api('/shifts/close', { method: 'POST', body: { closing_cash: Number(closing) || 0, notes } }), 'تم إغلاق الوردية');
    if (r) { setResult(r); current.reload(); history.reload(); }
  }

  return (
    <div>
      <PageHead title="الورديات وجرد الصندوق" />
      {result && (
        <div className="card shift-result">
          <h3>ملخص الوردية المغلقة</h3>
          <div className="kv"><span>عدد الطلبات</span><strong>{result.orders_count}</strong></div>
          <div className="kv"><span>المبيعات</span><strong>{money(result.sales)}</strong></div>
          {result.expenses_cash > 0 && <div className="kv"><span>مصروفات من الدرج</span><strong>− {money(result.expenses_cash)}</strong></div>}
          <div className="kv"><span>النقد المتوقع</span><strong>{money(result.expected_cash)}</strong></div>
          <div className="kv"><span>النقد الفعلي</span><strong>{money(result.closing_cash)}</strong></div>
          <div className="kv"><span>الفرق</span><strong className={result.difference < 0 ? 'text-err' : 'text-ok'}>{money(result.difference)}</strong></div>
        </div>
      )}
      {!s ? (
        <div className="card narrow">
          <h3>لا توجد وردية مفتوحة</h3>
          <Field label="النقد الافتتاحي في الصندوق"><input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
          <button className="btn btn-primary btn-lg btn-block" onClick={open} disabled={busy}>فتح وردية</button>
        </div>
      ) : (
        <div className="card narrow">
          <h3>الوردية الحالية</h3>
          <div className="kv"><span>فتحها</span><strong>{s.user_name}</strong></div>
          <div className="kv"><span>وقت الفتح</span><strong dir="ltr">{s.opened_at}</strong></div>
          <div className="kv"><span>النقد الافتتاحي</span><strong>{money(s.opening_cash)}</strong></div>
          <div className="kv"><span>الطلبات المدفوعة</span><strong>{s.orders_count}</strong></div>
          <div className="kv"><span>المبيعات</span><strong>{money(s.sales)}</strong></div>
          {s.payments.map((p) => <div className="kv" key={p.method}><span>{PAY_METHODS[p.method]}</span><strong>{money(p.total)}</strong></div>)}
          {s.expenses_cash > 0 && <div className="kv"><span>مصروفات دُفعت من الدرج ({s.expenses_count})</span><strong className="text-err">− {money(s.expenses_cash)}</strong></div>}
          <div className="kv highlight"><span>النقد المتوقع في الصندوق</span><strong>{money(s.expected_cash)}</strong></div>
          <hr />
          <Field label="النقد الفعلي عند الإغلاق"><input type="number" value={closing} onChange={(e) => setClosing(e.target.value)} /></Field>
          <Field label="ملاحظات"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <button className="btn btn-danger btn-lg btn-block" onClick={close} disabled={busy}>إغلاق الوردية</button>
        </div>
      )}
      {history.data && (
        <>
          <h2 className="area-title">سجل الورديات</h2>
          {!history.data.length ? <Empty text="لا يوجد سجل" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>#</th><th>المستخدم</th><th>الفتح</th><th>الإغلاق</th><th>المتوقع</th><th>الفعلي</th><th>الفرق</th></tr></thead>
                <tbody>
                  {history.data.map((h) => (
                    <tr key={h.id}>
                      <td>{h.id}</td><td>{h.user_name}</td>
                      <td dir="ltr" className="small">{h.opened_at}</td>
                      <td dir="ltr" className="small">{h.closed_at || 'مفتوحة'}</td>
                      <td>{h.expected_cash != null ? money(h.expected_cash) : '—'}</td>
                      <td>{h.closing_cash != null ? money(h.closing_cash) : '—'}</td>
                      <td className={h.closing_cash - h.expected_cash < 0 ? 'text-err' : ''}>{h.closed_at ? money(h.closing_cash - h.expected_cash) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
