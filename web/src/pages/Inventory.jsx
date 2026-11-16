import { useState } from 'react';
import { api } from '../api.js';
import { useData, useMoney, useAction, useApp, can, Modal, Field, Loading, Empty, PageHead } from '../lib.jsx';
import { Pencil, Plus } from 'lucide-react';

const MOVE_TYPES = { purchase: 'شراء / استلام', waste: 'تالف / هدر', adjust: 'تسوية جرد', sale: 'بيع' };

export default function Inventory() {
  const money = useMoney();
  const { user } = useApp();
  const isManager = can(user, 'manager');
  const { data, loading, reload } = useData('/ingredients', ['inventory']);
  const [tab, setTab] = useState('stock');
  const [edit, setEdit] = useState(null);
  const [move, setMove] = useState(null);
  const [onlyLow, setOnlyLow] = useState(false);

  if (loading) return <Loading />;
  const rows = (data || []).filter((i) => !onlyLow || i.low);
  const lowCount = (data || []).filter((i) => i.low).length;
  const value = (data || []).reduce((a, i) => a + Math.max(0, i.stock) * i.cost_per_unit, 0);

  return (
    <div>
      <PageHead title="المخزون" sub={`قيمة المخزون: ${money(value)}`}>
        {isManager && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={18} /> مادة خام</button>}
      </PageHead>
      <div className="filters">
        <div className="seg">
          <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>الأرصدة</button>
          {isManager && <button className={tab === 'moves' ? 'active' : ''} onClick={() => setTab('moves')}>الحركات</button>}
        </div>
        {tab === 'stock' && (
          <label className="switch"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> المنخفض فقط ({lowCount})</label>
        )}
      </div>
      {tab === 'stock' ? (
        !rows.length ? <Empty text="لا توجد مواد" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>المادة</th><th>الرصيد</th><th>الحد الأدنى</th><th>تكلفة الوحدة</th><th /></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={i.low ? 'row-warn' : ''}>
                    <td><strong>{i.name}</strong>{i.low ? <span className="badge badge-err">منخفض</span> : null}</td>
                    <td>{+i.stock.toFixed(3)} {i.unit}</td>
                    <td>{i.min_stock} {i.unit}</td>
                    <td>{money(i.cost_per_unit)}</td>
                    <td className="row gap-s">
                      <button className="btn btn-sm" onClick={() => setMove({ ing: i, type: 'purchase' })}>+ استلام</button>
                      <button className="btn btn-sm" onClick={() => setMove({ ing: i, type: 'waste' })}>تالف</button>
                      {isManager && <button className="btn btn-sm" onClick={() => setMove({ ing: i, type: 'adjust' })}>جرد</button>}
                      {isManager && <button className="btn btn-sm btn-ghost" onClick={() => setEdit(i)} aria-label="تعديل"><Pencil size={15} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : <Movements />}
      {edit && <IngredientForm ing={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {move && <MoveForm {...move} onClose={() => setMove(null)} onSaved={() => { setMove(null); reload(); }} />}
    </div>
  );
}

function Movements() {
  const { data, loading } = useData('/stock-movements', ['inventory']);
  const money = useMoney();
  if (loading) return <Loading />;
  if (!data?.length) return <Empty text="لا توجد حركات" />;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>التاريخ</th><th>المادة</th><th>النوع</th><th>الكمية</th><th>التكلفة</th><th>بواسطة</th><th>ملاحظة</th></tr></thead>
        <tbody>
          {data.map((m) => (
            <tr key={m.id}>
              <td dir="ltr" className="small">{m.created_at}</td>
              <td>{m.ingredient_name}</td>
              <td>{MOVE_TYPES[m.type]}{m.order_id ? ` (طلب)` : ''}</td>
              <td className={m.qty < 0 ? 'text-err' : 'text-ok'} dir="ltr">{m.qty > 0 ? '+' : ''}{+m.qty.toFixed(3)} {m.unit}</td>
              <td>{m.unit_cost ? money(m.unit_cost) : '—'}</td>
              <td>{m.user_name}</td>
              <td className="small">{m.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IngredientForm({ ing, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ name: ing.name || '', unit: ing.unit || 'كغ', stock: ing.stock ?? 0, min_stock: ing.min_stock ?? 0, cost_per_unit: ing.cost_per_unit ?? 0 });
  const save = async () => {
    const ok = await run(() => (ing.id ? api(`/ingredients/${ing.id}`, { method: 'PUT', body: f }) : api('/ingredients', { method: 'POST', body: f })), 'تم الحفظ');
    if (ok) onSaved();
  };
  const del = async () => {
    if (!window.confirm('حذف المادة؟')) return;
    const ok = await run(() => api(`/ingredients/${ing.id}`, { method: 'DELETE' }), 'تم الحذف');
    if (ok) onSaved();
  };
  return (
    <Modal title={ing.id ? 'تعديل مادة' : 'مادة خام جديدة'} onClose={onClose} footer={
      <>{ing.id && <button className="btn btn-danger-ghost" onClick={del}>حذف</button>}<button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button></>
    }>
      <div className="grid-2">
        <Field label="الاسم"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="الوحدة">
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            {['كغ', 'غرام', 'لتر', 'مل', 'حبة', 'علبة', 'كرتون'].map((u) => <option key={u}>{u}</option>)}
          </select>
        </Field>
        {!ing.id && <Field label="الرصيد الافتتاحي"><input type="number" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></Field>}
        <Field label="الحد الأدنى للتنبيه"><input type="number" value={f.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} /></Field>
        <Field label="تكلفة الوحدة"><input type="number" step="0.01" value={f.cost_per_unit} onChange={(e) => setF({ ...f, cost_per_unit: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function MoveForm({ ing, type, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [qty, setQty] = useState(type === 'adjust' ? ing.stock : '');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const save = async () => {
    const ok = await run(() => api('/stock-movements', { method: 'POST', body: { ingredient_id: ing.id, type, qty: Number(qty), unit_cost: Number(cost) || undefined, note } }), 'تم تسجيل الحركة');
    if (ok) onSaved();
  };
  return (
    <Modal title={`${MOVE_TYPES[type]} — ${ing.name}`} onClose={onClose} footer={<button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button>}>
      <p className="muted">الرصيد الحالي: {+ing.stock.toFixed(3)} {ing.unit}</p>
      <Field label={type === 'adjust' ? `الكمية الفعلية بعد الجرد (${ing.unit})` : `الكمية (${ing.unit})`}>
        <input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      </Field>
      {type === 'purchase' && <Field label="سعر شراء الوحدة (اختياري)"><input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>}
      <Field label="ملاحظة"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'purchase' ? 'المورد / رقم الفاتورة' : ''} /></Field>
    </Modal>
  );
}
