import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, PackagePlus, PackageMinus, Trash, Undo2, ClipboardCheck, Pencil } from 'lucide-react';
import { api } from '../api.js';
import { useData, useAction, useMoney, Modal, Field } from '../lib.jsx';
import { fmtQty, WASTE_REASONS, ISSUE_REASONS, STORAGE, daysLeft, expiryTone, expiryText, addDaysStr, dstr } from './inv.js';

const today = () => dstr(new Date());

/** استلام بضاعة: مستند بأسطر (مادة، كمية، سعر، تاريخ صلاحية) من مورد */
export function ReceiveForm({ ingredients, suppliers, preset, onClose, onSaved }) {
  const money = useMoney();
  const [run, busy] = useAction();
  const [head, setHead] = useState({ supplier_id: preset?.supplier_id || '', invoice_no: '', received_at: today(), note: '' });
  const blank = (ing) => ({ ingredient_id: ing?.id || '', qty: ing?.need ? String(ing.need) : '', unit_cost: ing ? String(ing.cost_per_unit ?? '') : '', expiry_date: ing?.shelf_life_days ? addDaysStr(today(), ing.shelf_life_days) : '' });
  const [lines, setLines] = useState(() => (preset?.lines?.length ? preset.lines.map((l) => blank({ ...ingredients.find((i) => i.id === l.ingredient_id), need: l.need })) : [blank(preset?.ing)]));
  const byId = useMemo(() => Object.fromEntries(ingredients.map((i) => [i.id, i])), [ingredients]);
  const set = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const pick = (i, id) => {
    const ing = byId[Number(id)];
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ingredient_id: id, unit_cost: ing ? String(ing.cost_per_unit) : '', expiry_date: ing?.shelf_life_days ? addDaysStr(head.received_at || today(), ing.shelf_life_days) : '' } : l)));
  };
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  const valid = lines.length && lines.every((l) => l.ingredient_id && Number(l.qty) > 0);
  const save = async () => {
    const r = await run(() => api('/stock/receipts', { method: 'POST', body: { ...head, supplier_id: Number(head.supplier_id) || null, lines: lines.map((l) => ({ ingredient_id: Number(l.ingredient_id), qty: Number(l.qty), unit_cost: l.unit_cost === '' ? undefined : Number(l.unit_cost), expiry_date: l.expiry_date || undefined })) } }), 'تم تسجيل الاستلام وإضافة الدفعات للمخزن');
    if (r) onSaved(r);
  };
  return (
    <Modal wide title="استلام بضاعة" onClose={onClose} footer={<><span className="inv-total">إجمالي المستند <b>{money(total)}</b></span><button className="btn btn-primary btn-lg" onClick={save} disabled={busy || !valid}><PackagePlus size={18} /> اعتماد الاستلام</button></>}>
      <div className="grid-3">
        <Field label="المورد"><select value={head.supplier_id} onChange={(e) => setHead({ ...head, supplier_id: e.target.value })}><option value="">— بدون مورد —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="رقم فاتورة المورد"><input dir="ltr" value={head.invoice_no} onChange={(e) => setHead({ ...head, invoice_no: e.target.value })} placeholder="INV-1234" maxLength={40} /></Field>
        <Field label="تاريخ الاستلام"><input type="date" value={head.received_at} max={today()} onChange={(e) => setHead({ ...head, received_at: e.target.value })} /></Field>
      </div>
      <div className="inv-lines">
        <div className="inv-line head"><span>المادة</span><span>الكمية</span><span>سعر الوحدة</span><span>تاريخ الصلاحية</span><span>الإجمالي</span><span /></div>
        {lines.map((l, i) => {
          const ing = byId[Number(l.ingredient_id)];
          const dl = l.expiry_date ? daysLeft(l.expiry_date) : null;
          return (
            <div key={i} className="inv-line">
              <select value={l.ingredient_id} onChange={(e) => pick(i, e.target.value)} aria-label="المادة"><option value="">اختر المادة…</option>{ingredients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <label className="inv-unit"><input type="number" step="0.001" min="0" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} aria-label="الكمية" /><span>{ing?.unit || ''}</span></label>
              <input type="number" step="0.01" min="0" value={l.unit_cost} onChange={(e) => set(i, 'unit_cost', e.target.value)} aria-label="سعر الوحدة" />
              <label className="inv-exp"><input type="date" value={l.expiry_date} min={head.received_at} onChange={(e) => set(i, 'expiry_date', e.target.value)} aria-label="تاريخ الصلاحية" />{dl != null && <small className={`exp-${expiryTone(dl)}`}>{expiryText(dl)}</small>}</label>
              <b className="inv-ltotal">{money((Number(l.qty) || 0) * (Number(l.unit_cost) || 0))}</b>
              <button className="icon-btn" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1} aria-label="حذف السطر"><Trash2 size={16} /></button>
            </div>
          );
        })}
        <button className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, blank()])}><Plus size={15} /> إضافة سطر</button>
      </div>
      <Field label="ملاحظات"><input value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} maxLength={200} /></Field>
    </Modal>
  );
}

const MOVES = {
  issue: { title: 'صرف من المخزن', icon: PackageMinus, reasons: ISSUE_REASONS, hint: 'يخرج من الدفعة الأقدم صلاحية أولاً تلقائياً.', btn: 'تسجيل الصرف' },
  waste: { title: 'تسجيل تالف', icon: Trash, reasons: WASTE_REASONS, hint: 'يُسجَّل بقيمته على تكلفة المادة ويظهر في تقرير الهدر.', btn: 'تسجيل التالف' },
  return: { title: 'مرتجع للمورد', icon: Undo2, reasons: ['بضاعة تالفة عند الاستلام', 'مخالفة للمواصفات', 'زيادة عن الطلب', 'أخرى'], hint: 'تُخصم الكمية من المخزن وتُسجَّل كمرتجع.', btn: 'تسجيل المرتجع' },
  adjust: { title: 'تسوية جرد', icon: ClipboardCheck, reasons: [], hint: 'أدخل الكمية الفعلية الموجودة؛ يُسجَّل الفرق.', btn: 'اعتماد التسوية' },
};

/** صرف / تالف / مرتجع / تسوية لمادة */
export function MoveForm({ ing, type, ingredients, onClose, onSaved }) {
  const money = useMoney();
  const [run, busy] = useAction();
  const cfg = MOVES[type];
  const [pickId, setPickId] = useState(ing?.id || '');
  const cur = ingredients.find((i) => i.id === Number(pickId));
  const detail = useData(cur ? `/ingredients/${cur.id}` : null, [], [cur?.id]);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState(cfg.reasons[0] || '');
  const [batch, setBatch] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (type === 'adjust' && cur) setQty(String(cur.stock)); }, [pickId]); // eslint-disable-line
  const batches = (detail.data?.batches || []).filter((b) => b.qty_left > 0);
  const n = Number(qty);
  const delta = type === 'adjust' ? n - (cur?.stock || 0) : -Math.abs(n || 0);
  const valid = cur && qty !== '' && Number.isFinite(n) && (type === 'adjust' ? n >= 0 : n > 0);
  const save = async () => {
    const ok = await run(() => api('/stock-movements', { method: 'POST', body: { ingredient_id: cur.id, type, qty: n, reason: reason || undefined, batch_id: Number(batch) || undefined, note } }), 'تم التسجيل');
    if (ok) onSaved();
  };
  const Icon = cfg.icon;
  return (
    <Modal title={cfg.title} onClose={onClose} footer={<button className={`btn btn-lg ${type === 'waste' ? 'btn-danger' : 'btn-primary'}`} onClick={save} disabled={busy || !valid}><Icon size={18} /> {cfg.btn}</button>}>
      <Field label="المادة"><select value={pickId} onChange={(e) => setPickId(e.target.value)} disabled={!!ing}><option value="">اختر المادة…</option>{ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} — {fmtQty(i.stock)} {i.unit}</option>)}</select></Field>
      {cur && <p className="muted small">الرصيد الحالي <b>{fmtQty(cur.stock)} {cur.unit}</b> · متوسط التكلفة {money(cur.cost_per_unit)}</p>}
      <Field label={type === 'adjust' ? `الكمية الفعلية (${cur?.unit || ''})` : `الكمية (${cur?.unit || ''})`}>
        <input type="number" step="0.001" min="0" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus className="input-lg" />
      </Field>
      {valid && <div className={`inv-impact ${delta < 0 ? 'neg' : 'pos'}`}>{type === 'adjust' ? 'الفرق' : 'الأثر على المخزن'}: <b dir="ltr">{delta > 0 ? '+' : ''}{fmtQty(delta)} {cur.unit}</b> · بقيمة <b>{money(Math.abs(delta) * cur.cost_per_unit)}</b>{type !== 'adjust' && n > cur.stock ? <span className="exp-expired"> (أكبر من الرصيد!)</span> : null}</div>}
      {cfg.reasons.length > 0 && <Field label="السبب"><select value={reason} onChange={(e) => setReason(e.target.value)}>{cfg.reasons.map((r) => <option key={r}>{r}</option>)}</select></Field>}
      {type !== 'adjust' && batches.length > 1 && (
        <Field label="من أي دفعة؟" hint="الافتراضي الأقدم صلاحية أولاً (FEFO)">
          <select value={batch} onChange={(e) => setBatch(e.target.value)}><option value="">تلقائي — الأقدم صلاحية أولاً</option>{batches.map((b) => <option key={b.id} value={b.id}>{fmtQty(b.qty_left)} {cur.unit} · {b.expiry_date ? `تنتهي ${b.expiry_date}` : 'بلا صلاحية'}</option>)}</select>
        </Field>
      )}
      <Field label="ملاحظة"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={type === 'waste' ? 'تفاصيل إضافية (اختياري)' : ''} /></Field>
      <p className="muted small">{cfg.hint}</p>
    </Modal>
  );
}

/** مادة جديدة / تعديل مادة */
export function IngredientForm({ ing, suppliers, categories, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ name: ing.name || '', unit: ing.unit || 'كغ', category: ing.category || '', storage: ing.storage || 'جاف', stock: 0, min_stock: ing.min_stock ?? 0, par_level: ing.par_level ?? 0, cost_per_unit: ing.cost_per_unit ?? 0, supplier_id: ing.supplier_id || '', shelf_life_days: ing.shelf_life_days || '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { ...f, supplier_id: f.supplier_id || null };
    const ok = await run(() => (ing.id ? api(`/ingredients/${ing.id}`, { method: 'PUT', body }) : api('/ingredients', { method: 'POST', body })), 'تم الحفظ');
    if (ok) onSaved();
  };
  const del = async () => { if (!window.confirm('حذف المادة من المخزن؟ تبقى حركاتها في السجل.')) return; if (await run(() => api(`/ingredients/${ing.id}`, { method: 'DELETE' }), 'تم الحذف')) onSaved(); };
  return (
    <Modal title={ing.id ? `تعديل «${ing.name}»` : 'مادة جديدة في المخزن'} onClose={onClose} footer={<>{ing.id && <button className="btn btn-danger-ghost" onClick={del}>حذف</button>}<button className="btn btn-primary" onClick={save} disabled={busy || !f.name.trim()}>حفظ</button></>}>
      <div className="grid-2">
        <Field label="اسم المادة"><input value={f.name} onChange={set('name')} autoFocus maxLength={80} /></Field>
        <Field label="الوحدة"><select value={f.unit} onChange={set('unit')}>{['كغ', 'غرام', 'لتر', 'مل', 'حبة', 'علبة', 'كرتون', 'كيس'].map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label="المجموعة"><input list="inv-cats" value={f.category} onChange={set('category')} placeholder="مثال: لحوم ودواجن" /><datalist id="inv-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="التخزين"><select value={f.storage} onChange={set('storage')}>{Object.keys(STORAGE).map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="الحد الأدنى للتنبيه" hint="عنده يُنبَّه ويُقترح إعادة الطلب"><input type="number" min="0" step="0.001" value={f.min_stock} onChange={set('min_stock')} /></Field>
        <Field label="الكمية المستهدفة (Par)" hint="يُعاد الطلب حتى الوصول إليها"><input type="number" min="0" step="0.001" value={f.par_level} onChange={set('par_level')} /></Field>
        <Field label="تكلفة الوحدة"><input type="number" min="0" step="0.01" value={f.cost_per_unit} onChange={set('cost_per_unit')} /></Field>
        <Field label="مدة الصلاحية الافتراضية (أيام)" hint="تُحسب تاريخ الصلاحية تلقائياً عند الاستلام"><input type="number" min="0" value={f.shelf_life_days} onChange={set('shelf_life_days')} /></Field>
        <Field label="المورد المعتاد"><select value={f.supplier_id} onChange={set('supplier_id')}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        {!ing.id && <Field label="الرصيد الافتتاحي"><input type="number" min="0" step="0.001" value={f.stock} onChange={set('stock')} /></Field>}
      </div>
    </Modal>
  );
}

/** بطاقة المادة: الدفعات وتواريخها، الاستهلاك، وكشف حساب المادة */
export function MaterialDrawer({ id, canManage, canRecv, onClose, onAction }) {
  const money = useMoney();
  const { data: m, loading } = useData(`/ingredients/${id}`, ['inventory'], [id]);
  const [run] = useAction();
  const discard = async (b) => { if (!window.confirm(`شطب ${fmtQty(b.qty_left)} ${m.unit} كتالف؟`)) return; if (await run(() => api(`/stock/batches/${b.id}/discard`, { method: 'POST', body: { reason: b.expiry_date && b.expiry_date < today() ? 'انتهاء الصلاحية' : 'تلف / فساد' } }), 'تم الشطب')) onAction(); };
  const maxU = Math.max(...(m?.usage || []).map((u) => u.q), 0.001);
  return (
    <div className="inv-drawer-wrap" onClick={onClose}>
      <aside className="inv-drawer" role="dialog" aria-modal="true" aria-label="تفاصيل المادة" onClick={(e) => e.stopPropagation()}>
        {loading || !m ? <p className="muted">جارِ التحميل…</p> : (
          <>
            <header>
              <div><h2>{m.name}</h2><span className="muted small">{m.category || 'غير مصنّف'} · {STORAGE[m.storage] || ''} {m.storage || ''}{m.supplier_name ? ` · ${m.supplier_name}` : ''}</span></div>
              <button className="icon-btn" onClick={onClose} aria-label="إغلاق">✕</button>
            </header>
            <div className="inv-d-stats">
              <div><span>الرصيد</span><b>{fmtQty(m.stock)} <small>{m.unit}</small></b></div>
              <div><span>القيمة</span><b>{money(m.value)}</b></div>
              <div><span>أيام التغطية</span><b>{m.days_cover ?? '—'}</b></div>
              <div><span>الاستهلاك اليومي</span><b>{m.avg_daily ? fmtQty(m.avg_daily) : '—'}</b></div>
              <div><span>الحد الأدنى / المستهدف</span><b>{fmtQty(m.min_stock)} / {m.par_level ? fmtQty(m.par_level) : '—'}</b></div>
              <div><span>متوسط التكلفة</span><b>{money(m.cost_per_unit)}</b></div>
            </div>
            <div className="inv-d-act">
              {canRecv && <button className="btn btn-sm btn-primary" onClick={() => onAction('receive', m)}><PackagePlus size={15} /> استلام</button>}
              {canRecv && <button className="btn btn-sm" onClick={() => onAction('issue', m)}><PackageMinus size={15} /> صرف</button>}
              {canRecv && <button className="btn btn-sm" onClick={() => onAction('waste', m)}><Trash size={15} /> تالف</button>}
              {canManage && <button className="btn btn-sm" onClick={() => onAction('adjust', m)}><ClipboardCheck size={15} /> تسوية</button>}
              {canManage && <button className="btn btn-sm btn-ghost" onClick={() => onAction('edit', m)}><Pencil size={15} /> تعديل</button>}
            </div>

            <h4>الدفعات وتواريخ الصلاحية</h4>
            {!m.batches.some((b) => b.qty_left > 0) ? <p className="muted small">لا توجد دفعات بها رصيد. {m.stock > 0 ? 'الرصيد الحالي غير مرتبط بدفعات (رصيد افتتاحي).' : ''}</p> : (
              <ul className="inv-batches">
                {m.batches.filter((b) => b.qty_left > 0).map((b) => { const d = daysLeft(b.expiry_date); return (
                  <li key={b.id} className={`exp-${expiryTone(d)}`}>
                    <div><b>{fmtQty(b.qty_left)} {m.unit}</b><small className="muted">من {fmtQty(b.qty_in)} · استُلمت {b.received_at}{b.supplier_name ? ` · ${b.supplier_name}` : ''}</small></div>
                    <span className="exp-chip">{b.expiry_date ? `${b.expiry_date} · ${expiryText(d)}` : 'بلا صلاحية'}</span>
                    {canRecv && d != null && d <= 2 && <button className="btn btn-xs btn-danger-ghost" onClick={() => discard(b)}>شطب</button>}
                  </li>); })}
              </ul>
            )}

            {m.usage.length > 0 && (<><h4>الاستهلاك آخر 30 يوماً</h4><div className="inv-usage" role="img" aria-label="الاستهلاك اليومي">{m.usage.map((u) => <i key={u.d} title={`${u.d}: ${fmtQty(u.q)} ${m.unit}`} style={{ height: `${Math.max(6, (u.q / maxU) * 100)}%` }} />)}</div></>)}

            <h4>كشف حساب المادة</h4>
            <table className="data inv-ledger"><thead><tr><th>التاريخ والوقت</th><th>الحركة</th><th>الكمية</th><th>الرصيد</th></tr></thead>
              <tbody>{m.movements.map((x) => (
                <tr key={x.id}><td dir="ltr" className="small">{x.created_at}</td><td><b>{({ purchase: 'وارد', sale: 'بيع', waste: 'تالف', adjust: 'جرد', issue: 'صرف', return: 'مرتجع' })[x.type]}</b>{x.reason ? <small className="muted"> · {x.reason}</small> : null}</td>
                  <td dir="ltr" className={x.qty < 0 ? 'text-err' : 'text-ok'}>{x.qty > 0 ? '+' : ''}{fmtQty(x.qty)}</td><td dir="ltr">{x.balance_after != null ? fmtQty(x.balance_after) : '—'}</td></tr>))}</tbody></table>
          </>
        )}
      </aside>
    </div>
  );
}

