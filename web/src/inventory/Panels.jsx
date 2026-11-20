import { useMemo, useState } from 'react';
import { CalendarX2, ClipboardCheck, Phone, Plus, Pencil, Truck, Check, Trash } from 'lucide-react';
import { api } from '../api.js';
import { useData, useAction, useMoney, Loading, Empty, Modal, Field } from '../lib.jsx';
import { fmtQty, daysLeft, expiryTone, expiryText } from './inv.js';

const EXP = [['expired', 'منتهية'], ['3', 'خلال 3 أيام'], ['7', 'خلال 7 أيام'], ['30', 'خلال 30 يوماً'], ['dated', 'كل ذات الصلاحية']];

/** الصلاحية: كل الدفعات بتاريخ انتهائها مرتبة بالأقرب، مع شطب المنتهي */
export function Expiry({ canRecv }) {
  const money = useMoney();
  const [st, setSt] = useState('7');
  const { data, loading, reload } = useData(`/stock/batches?status=${st}`, ['inventory'], [st]);
  const [run] = useAction();
  const rows = data || [];
  const value = rows.reduce((a, b) => a + b.value, 0);
  const discard = async (b) => { if (!window.confirm(`شطب ${fmtQty(b.qty_left)} ${b.unit} من «${b.name}» كتالف؟`)) return; if (await run(() => api(`/stock/batches/${b.id}/discard`, { method: 'POST', body: { reason: b.days_left < 0 ? 'انتهاء الصلاحية' : 'تلف / فساد' } }), 'تم شطب الدفعة')) reload(); };
  return (
    <div className="inv-exp-tab">
      <header className="inv-fhead"><div><h2><CalendarX2 size={20} aria-hidden /> تواريخ الصلاحية</h2><p className="muted">الدفعات مرتبة بالأقرب انتهاءً. النظام يصرف الأقدم صلاحية أولاً (FEFO) تلقائياً.</p></div></header>
      <div className="inv-bar"><div className="seg" role="tablist">{EXP.map(([k, l]) => <button key={k} role="tab" aria-selected={st === k} className={st === k ? 'active' : ''} onClick={() => setSt(k)}>{l}</button>)}</div>
        <span className="inv-risk">القيمة المعرّضة <b>{money(value)}</b> · {rows.length} دفعة</span></div>
      {loading ? <Loading /> : !rows.length ? <Empty icon={Check} text="لا توجد دفعات ضمن هذا المعيار" /> : (
        <div className="inv-expgrid">
          {rows.map((b) => { const d = b.days_left; return (
            <article key={b.id} className={`inv-expcard exp-${expiryTone(d)}`}>
              <header><strong>{b.name}</strong><span className="exp-chip">{expiryText(d)}</span></header>
              <div className="meta"><span>{fmtQty(b.qty_left)} <small>{b.unit}</small></span><span>{money(b.value)}</span></div>
              <div className="dates"><span>تنتهي <b dir="ltr">{b.expiry_date}</b></span><span>استُلمت <b dir="ltr">{b.received_at}</b></span></div>
              {b.supplier_name && <small className="muted">المورد: {b.supplier_name}</small>}
              {canRecv && d <= 2 && <button className="btn btn-sm btn-danger-ghost" onClick={() => discard(b)}><Trash size={14} /> شطب كتالف</button>}
            </article>); })}
        </div>
      )}
    </div>
  );
}

/** الجرد: ورقة جرد بكل المواد، فرق مباشر بالكمية والقيمة، واعتماد واحد */
export function Stocktake({ onDone }) {
  const money = useMoney();
  const { data, loading } = useData('/ingredients', ['inventory']);
  const hist = useData('/stocktakes', ['inventory']);
  const [counts, setCounts] = useState({});
  const [note, setNote] = useState('');
  const [res, setRes] = useState(null);
  const [run, busy] = useAction();
  const groups = useMemo(() => { const g = {}; (data || []).forEach((i) => { (g[i.category || 'غير مصنّف'] = g[i.category || 'غير مصنّف'] || []).push(i); }); return Object.entries(g); }, [data]);
  const touched = (data || []).filter((i) => counts[i.id] !== undefined && counts[i.id] !== '');
  const diffs = touched.map((i) => ({ i, diff: Number(counts[i.id]) - i.stock }));
  const shortage = diffs.filter((d) => d.diff < 0).reduce((a, d) => a - d.diff * d.i.cost_per_unit, 0);
  const surplus = diffs.filter((d) => d.diff > 0).reduce((a, d) => a + d.diff * d.i.cost_per_unit, 0);
  const submit = async () => {
    if (!window.confirm(`اعتماد جرد ${touched.length} مادة؟ ستُسجَّل فروقها وتُعدَّل الأرصدة.`)) return;
    const r = await run(() => api('/stocktake', { method: 'POST', body: { note, counts: touched.map((i) => ({ ingredient_id: i.id, qty: Number(counts[i.id]) })) } }), 'تم اعتماد الجرد');
    if (r) { setRes(r); setCounts({}); setNote(''); onDone?.(); }
  };
  if (loading) return <Loading />;
  return (
    <div className="inv-take">
      <header className="inv-fhead"><div><h2><ClipboardCheck size={20} aria-hidden /> الجرد الفعلي</h2><p className="muted">أدخل الكمية الموجودة فعلاً في المخزن لكل مادة تعدّها؛ المواد التي لا تُدخل لها رقماً تبقى كما هي.</p></div>
        <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy || !touched.length}><ClipboardCheck size={18} /> اعتماد الجرد ({touched.length})</button></header>
      {res && (
        <div className="inv-take-res"><strong>تم اعتماد الجرد #{res.id}</strong><span>{res.counted} مادة · عُدّلت {res.changed}</span><span className="text-err">عجز {money(res.shortage_value)}</span><span className="text-ok">زيادة {money(res.surplus_value)}</span></div>
      )}
      <div className="inv-take-sum"><div><span>مواد معدودة</span><b>{touched.length}</b></div><div><span>قيمة العجز</span><b className="text-err">{money(shortage)}</b></div><div><span>قيمة الزيادة</span><b className="text-ok">{money(surplus)}</b></div>
        <label className="inv-note"><span>ملاحظة الجرد</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="جرد نهاية الأسبوع…" maxLength={200} /></label></div>
      {groups.map(([g, list]) => (
        <section key={g} className="inv-card">
          <header><h3>{g}</h3><span className="muted small">{list.length} مادة</span></header>
          <table className="data inv-take-table"><thead><tr><th>المادة</th><th>رصيد النظام</th><th>الكمية الفعلية</th><th>الفرق</th><th>القيمة</th></tr></thead>
            <tbody>{list.map((i) => { const v = counts[i.id]; const diff = v === undefined || v === '' ? null : Number(v) - i.stock; return (
              <tr key={i.id} className={diff == null ? '' : Math.abs(diff) < 0.0005 ? 'row-ok' : diff < 0 ? 'row-neg' : 'row-pos'}>
                <td><strong>{i.name}</strong></td><td>{fmtQty(i.stock)} <small>{i.unit}</small></td>
                <td><label className="inv-unit"><input type="number" step="0.001" min="0" value={v ?? ''} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} aria-label={`الكمية الفعلية ${i.name}`} /><span>{i.unit}</span></label></td>
                <td dir="ltr" className={diff == null ? 'muted' : diff < 0 ? 'text-err' : diff > 0 ? 'text-ok' : ''}>{diff == null ? '—' : `${diff > 0 ? '+' : ''}${fmtQty(diff)}`}</td>
                <td className="num">{diff == null ? '—' : money(diff * i.cost_per_unit)}</td></tr>); })}</tbody></table>
        </section>
      ))}
      {(hist.data || []).length > 0 && (
        <section className="inv-card"><header><h3>سجل الجرد</h3></header>
          <table className="data"><thead><tr><th>التاريخ والوقت</th><th>بواسطة</th><th>مواد</th><th>عجز</th><th>زيادة</th><th>ملاحظة</th></tr></thead>
            <tbody>{hist.data.map((s) => <tr key={s.id}><td dir="ltr">{s.created_at}</td><td>{s.user_name || '—'}</td><td>{s.items}</td><td className="text-err">{money(s.shortage_value)}</td><td className="text-ok">{money(s.surplus_value)}</td><td className="small">{s.note || ''}</td></tr>)}</tbody></table></section>
      )}
    </div>
  );
}

/** الموردون */
export function Suppliers({ canManage }) {
  const money = useMoney();
  const { data, loading, reload } = useData('/suppliers', ['inventory']);
  const [edit, setEdit] = useState(null);
  if (loading) return <Loading />;
  return (
    <div className="inv-sup">
      <header className="inv-fhead"><div><h2><Truck size={20} aria-hidden /> الموردون</h2><p className="muted">من تشتري منهم، وكم اشتريت، وآخر توريد.</p></div>{canManage && <button className="btn btn-primary btn-lg" onClick={() => setEdit({})}><Plus size={18} /> مورد جديد</button>}</header>
      {!(data || []).length ? <Empty text="لا يوجد موردون بعد" /> : (
        <div className="inv-supgrid">{data.map((s) => (
          <article key={s.id} className="inv-supcard">
            <header><span className="av" aria-hidden><Truck size={18} /></span><div><strong>{s.name}</strong>{s.contact && <small className="muted">{s.contact}</small>}</div>{canManage && <button className="icon-btn" onClick={() => setEdit(s)} aria-label="تعديل"><Pencil size={15} /></button>}</header>
            {s.phone && <a className="tel" href={`tel:${s.phone}`} dir="ltr"><Phone size={14} aria-hidden /> {s.phone}</a>}
            <dl><div><dt>مشتريات</dt><dd>{money(s.total)}</dd></div><div><dt>مستندات</dt><dd>{s.receipts}</dd></div><div><dt>مواد</dt><dd>{s.items}</dd></div><div><dt>آخر توريد</dt><dd dir="ltr">{s.last_at || '—'}</dd></div></dl>
            {s.notes && <p className="muted small">{s.notes}</p>}
          </article>))}</div>
      )}
      {edit && <SupplierForm s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function SupplierForm({ s, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ name: s.name || '', phone: s.phone || '', contact: s.contact || '', notes: s.notes || '' });
  const save = async () => { if (await run(() => (s.id ? api(`/suppliers/${s.id}`, { method: 'PUT', body: f }) : api('/suppliers', { method: 'POST', body: f })), 'تم الحفظ')) onSaved(); };
  const del = async () => { if (!window.confirm('حذف المورد؟ تبقى مستنداته في السجل.')) return; if (await run(() => api(`/suppliers/${s.id}`, { method: 'DELETE' }), 'تم الحذف')) onSaved(); };
  return (
    <Modal title={s.id ? 'تعديل مورد' : 'مورد جديد'} onClose={onClose} footer={<>{s.id && <button className="btn btn-danger-ghost" onClick={del}>حذف</button>}<button className="btn btn-primary" onClick={save} disabled={busy || !f.name.trim()}>حفظ</button></>}>
      <div className="grid-2">
        <Field label="اسم المورد"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus maxLength={80} /></Field>
        <Field label="الجوال"><input dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={20} /></Field>
        <Field label="جهة الاتصال"><input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} maxLength={60} /></Field>
        <Field label="ملاحظات"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}
