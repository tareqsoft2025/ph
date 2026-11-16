import { useState } from 'react';
import { Plus, Printer, Trash2, Banknote, Info } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, useMoney, useAction, Modal, Field, Loading, Empty, PageHead, monthStr, hm, ADJ_TYPES } from '../lib.jsx';

export default function Payroll() {
  const money = useMoney();
  const { settings } = useApp();
  const [month, setMonth] = useState(monthStr());
  const { data, loading, reload } = useData(`/payroll?month=${month}`, ['hr', 'attendance'], [month]);
  const [adj, setAdj] = useState(null);
  const [slip, setSlip] = useState(null);

  return (
    <div>
      <PageHead title="الرواتب" sub="مسير الرواتب الشهري مع خصومات الغياب والتأخير والمكافآت">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="الشهر" />
        <button className="btn" onClick={() => setAdj({ month })}><Plus size={18} /> مكافأة / خصم / سلفة</button>
        <button className="btn" onClick={() => window.print()} aria-label="طباعة"><Printer size={18} /></button>
      </PageHead>

      {loading || !data ? <Loading /> : !data.rows.length ? <Empty icon={Banknote} text="لا يوجد موظفون" /> : (
        <>
          <div className="stats">
            <div className="stat"><span>إجمالي الرواتب</span><strong>{money(data.totals.gross)}</strong></div>
            <div className="stat"><span>المكافآت</span><strong className="text-ok">{money(data.totals.bonus)}</strong></div>
            <div className="stat"><span>الخصومات والسلف</span><strong className="text-err">{money(data.totals.deductions)}</strong></div>
            <div className="stat primary"><span>صافي المستحق</span><strong>{money(data.totals.net)}</strong></div>
          </div>
          <p className="muted small hint-line"><Info size={14} aria-hidden /> خصم الغياب = (الراتب + البدلات) ÷ 30 لكل يوم غياب أو إجازة بدون راتب{settings?.late_deduction === '1' ? '، وخصم التأخير بالدقيقة حسب ساعات الدوام' : ''}.</p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>الموظف</th><th>الأساسي</th><th>البدلات</th><th>الغياب</th><th>خصم الغياب</th><th>التأخير</th><th>خصم التأخير</th><th>مكافآت</th><th>خصومات / سلف</th><th>الصافي</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employee_id} className="clickable" onClick={() => setSlip(r)}>
                    <td><strong>{r.name}</strong><div className="muted small">{r.job_title}</div></td>
                    <td>{money(r.basic_salary)}</td>
                    <td>{money(r.allowances)}</td>
                    <td>{r.absent_days + r.unpaid_leave_days ? `${r.absent_days + r.unpaid_leave_days} يوم` : '—'}</td>
                    <td className={r.absence_deduction ? 'text-err' : ''}>{r.absence_deduction ? money(r.absence_deduction) : '—'}</td>
                    <td>{r.late_minutes ? hm(r.late_minutes) : '—'}</td>
                    <td className={r.late_deduction ? 'text-err' : ''}>{r.late_deduction ? money(r.late_deduction) : '—'}</td>
                    <td className={r.bonus ? 'text-ok' : ''}>{r.bonus ? money(r.bonus) : '—'}</td>
                    <td className={r.deduction + r.advance ? 'text-err' : ''}>{r.deduction + r.advance ? money(r.deduction + r.advance) : '—'}</td>
                    <td><strong>{money(r.net)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>الإجمالي</td><td colSpan={8} /><td><strong>{money(data.totals.net)}</strong></td></tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {adj && <AdjForm init={adj} employees={data?.rows || []} onClose={() => setAdj(null)} onSaved={() => { setAdj(null); reload(); }} />}
      {slip && <Payslip r={slip} month={month} money={money} onClose={() => setSlip(null)} onAdd={() => { setAdj({ month, employee_id: slip.employee_id }); setSlip(null); }} onChanged={() => { setSlip(null); reload(); }} />}
    </div>
  );
}

function AdjForm({ init, employees, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ employee_id: init.employee_id || '', type: 'bonus', amount: '', note: '', month: init.month });
  const save = async () => { if (await run(() => api('/payroll/adjustments', { method: 'POST', body: { ...f, amount: Number(f.amount) } }), 'تم الحفظ')) onSaved(); };
  return (
    <Modal title="مكافأة / خصم / سلفة" onClose={onClose} footer={
      <><button className="btn" onClick={onClose}>إلغاء</button><button className="btn btn-primary" onClick={save} disabled={busy || !f.employee_id || !(Number(f.amount) > 0)}>حفظ</button></>
    }>
      <Field label="الموظف">
        <select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: Number(e.target.value) || '' })}>
          <option value="">— اختر —</option>
          {employees.map((e) => <option key={e.employee_id} value={e.employee_id}>{e.name}</option>)}
        </select>
      </Field>
      <Field label="النوع">
        <div className="seg seg-lg">
          {Object.entries(ADJ_TYPES).map(([k, v]) => <button type="button" key={k} className={f.type === k ? 'active' : ''} onClick={() => setF({ ...f, type: k })}>{v}</button>)}
        </div>
      </Field>
      <div className="grid-2">
        <Field label="المبلغ"><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="الشهر"><input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></Field>
      </div>
      <Field label="ملاحظة"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </Modal>
  );
}

function Payslip({ r, month, money, onClose, onAdd, onChanged }) {
  const [run, busy] = useAction();
  const del = async (a) => { if (window.confirm('حذف هذا البند؟') && await run(() => api(`/payroll/adjustments/${a.id}`, { method: 'DELETE' }), 'تم الحذف')) onChanged(); };
  const Row = ({ k, v, cls }) => <div className={`kv ${cls || ''}`}><span>{k}</span><strong>{v}</strong></div>;
  return (
    <Modal title={`قسيمة راتب ${month}`} onClose={onClose} footer={
      <><button className="btn" onClick={onAdd}><Plus size={16} /> إضافة بند</button><button className="btn btn-primary" onClick={() => window.print()}><Printer size={16} /> طباعة</button></>
    }>
      <div className="payslip receipt-like">
        <h3>{r.name}</h3>
        <p className="muted small">{r.job_title}{r.department ? ` · ${r.department}` : ''}{r.bank_iban ? ` · ${r.bank_iban}` : ''}</p>
        <Row k="الراتب الأساسي" v={money(r.basic_salary)} />
        <Row k="البدلات" v={money(r.allowances)} />
        {r.bonus > 0 && <Row k="مكافآت" v={`+ ${money(r.bonus)}`} cls="text-ok" />}
        {r.absence_deduction > 0 && <Row k={`خصم غياب (${r.absent_days + r.unpaid_leave_days} يوم)`} v={`− ${money(r.absence_deduction)}`} cls="text-err" />}
        {r.late_deduction > 0 && <Row k={`خصم تأخير (${hm(r.late_minutes)})`} v={`− ${money(r.late_deduction)}`} cls="text-err" />}
        {r.deduction > 0 && <Row k="خصومات" v={`− ${money(r.deduction)}`} cls="text-err" />}
        {r.advance > 0 && <Row k="سلف" v={`− ${money(r.advance)}`} cls="text-err" />}
        <Row k="صافي الراتب" v={money(r.net)} cls="highlight" />
        <p className="muted small">حضور {r.summary.present} من {r.summary.working_days} يوم عمل · إجازات {r.summary.leave}</p>
      </div>
      {r.adjustments.length > 0 && (
        <>
          <h4 className="section-title">البنود الإضافية</h4>
          <ul className="simple-list">
            {r.adjustments.map((a) => (
              <li key={a.id}>
                <span>{ADJ_TYPES[a.type]}{a.note ? ` · ${a.note}` : ''}</span>
                <span className="row gap-s">{money(a.amount)}<button className="icon-btn" onClick={() => del(a)} disabled={busy} aria-label="حذف"><Trash2 size={15} /></button></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
