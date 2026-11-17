import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAction, Modal, Field, PAY_METHODS } from '../lib.jsx';

// طريقة الدفع المقترحة من اختيار الزبون عند طلب الحساب
export const BILL_LABEL = { cash: 'نقداً', wallet: 'محفظة', bank: 'بنك', jawwalpay: 'جوال بي' };
const SUGGEST = { cash: 'cash', wallet: 'wallet', jawwalpay: 'wallet', bank: 'card' };

export function PayModal({ order, money, onClose, onPaid }) {
  const [run, busy] = useAction();
  const remaining = Math.round((order.total - order.paid) * 100) / 100;
  const [lines, setLines] = useState([]);
  const [method, setMethod] = useState(SUGGEST[order.bill_method] || 'cash');
  const [amount, setAmount] = useState(String(remaining));
  useEffect(() => { setLines([]); setAmount(String(remaining)); }, [remaining]);
  const entered = lines.reduce((a, l) => a + l.amount, 0);
  const left = Math.round((remaining - entered) * 100) / 100;
  const pendingAmt = Number(amount) || 0;
  const change = Math.max(0, Math.round((entered + pendingAmt - remaining) * 100) / 100);
  const quick = [...new Set([left, Math.ceil(left / 10) * 10, Math.ceil(left / 50) * 50, Math.ceil(left / 100) * 100].filter((x) => x > 0))];

  function addLine() {
    if (!(pendingAmt > 0)) return;
    setLines([...lines, { method, amount: pendingAmt }]);
    const newLeft = Math.max(0, Math.round((left - pendingAmt) * 100) / 100);
    setAmount(String(newLeft));
  }

  async function confirm() {
    const payments = [...lines];
    if (pendingAmt > 0) payments.push({ method, amount: pendingAmt });
    if (!payments.length) return;
    const r = await run(() => api(`/orders/${order.id}/pay`, { method: 'POST', body: { payments } }));
    if (r) onPaid(r);
  }

  return (
    <Modal title={`دفع طلب #${order.number}`} onClose={onClose} footer={
      <button className="btn btn-ok btn-lg btn-block" onClick={confirm} disabled={busy}>
        تأكيد الدفع {change > 0 ? `· الباقي للعميل ${money(change)}` : ''}
      </button>
    }>
      {order.bill_method && (
        <p className="pay-hint">الزبون اختار: <strong>{BILL_LABEL[order.bill_method]}</strong>{order.bill_name ? ` · ${order.bill_name}` : ''}{order.bill_phone ? <> · <bdi dir="ltr">{order.bill_phone}</bdi></> : null}</p>
      )}
      <div className="pay-total">
        <span>المطلوب</span>
        <strong>{money(remaining)}</strong>
      </div>
      <div className="seg seg-lg" role="radiogroup" aria-label="طريقة الدفع">
        {Object.entries(PAY_METHODS).map(([k, v]) => (
          <button key={k} role="radio" aria-checked={method === k} className={method === k ? 'active' : ''} onClick={() => setMethod(k)}>{v}</button>
        ))}
      </div>
      <Field label="المبلغ">
        <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-lg" />
      </Field>
      {method === 'cash' && (
        <div className="quick-amounts">
          {quick.map((v) => <button key={v} className="btn" onClick={() => setAmount(String(v))}>{v}</button>)}
        </div>
      )}
      <button className="btn btn-ghost btn-block" onClick={addLine} disabled={!(pendingAmt > 0) || pendingAmt >= left}>+ تقسيم الدفع (إضافة طريقة أخرى)</button>
      {lines.length > 0 && (
        <ul className="pay-lines">
          {lines.map((l, i) => (
            <li key={i}><span>{PAY_METHODS[l.method]}</span><span>{money(l.amount)}</span>
              <button className="btn btn-xs btn-danger-ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>حذف</button></li>
          ))}
          <li className="muted"><span>المتبقي</span><span>{money(Math.max(0, left))}</span><span /></li>
        </ul>
      )}
    </Modal>
  );
}

export function DiscountModal({ order, onClose, onDone }) {
  const [run, busy] = useAction();
  const [type, setType] = useState(order.discount_type || 'percent');
  const [value, setValue] = useState(order.discount_value || '');
  async function save(v) {
    const r = await run(() => api(`/orders/${order.id}/discount`, { method: 'POST', body: { type, value: v } }), 'تم تطبيق الخصم');
    if (r) onDone(r);
  }
  return (
    <Modal title="خصم على الطلب" onClose={onClose} footer={
      <>
        {order.discount > 0 && <button className="btn btn-danger-ghost" onClick={() => save(0)} disabled={busy}>إزالة الخصم</button>}
        <button className="btn btn-primary" onClick={() => save(Number(value) || 0)} disabled={busy}>تطبيق</button>
      </>
    }>
      <div className="seg" role="radiogroup">
        <button className={type === 'percent' ? 'active' : ''} onClick={() => setType('percent')}>نسبة %</button>
        <button className={type === 'amount' ? 'active' : ''} onClick={() => setType('amount')}>مبلغ</button>
      </div>
      <Field label={type === 'percent' ? 'النسبة' : 'المبلغ'}>
        <input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </Field>
      {type === 'percent' && (
        <div className="quick-amounts">{[5, 10, 15, 20, 25, 50].map((p) => <button key={p} className="btn" onClick={() => setValue(p)}>{p}%</button>)}</div>
      )}
    </Modal>
  );
}
