import { useState } from 'react';
import { api } from '../api.js';
import { useData, useMoney, useAction, Modal, Field, Loading, Empty, PageHead, STATIONS } from '../lib.jsx';

export default function MenuAdmin() {
  const money = useMoney();
  const { data, loading, reload } = useData('/menu', ['menu']);
  const [run] = useAction();
  const [cat, setCat] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [editCat, setEditCat] = useState(null);

  if (loading) return <Loading />;
  const current = cat ?? data.categories[0]?.id;
  const items = data.items.filter((i) => i.category_id === current);

  async function openItem(id) {
    const full = await run(() => api(`/items/${id}`));
    if (full) setEditItem(full);
  }

  return (
    <div>
      <PageHead title="قائمة الطعام" sub={`${data.items.length} صنف في ${data.categories.length} فئات`}>
        <button className="btn" onClick={() => setEditCat({})}>+ فئة</button>
        <button className="btn btn-primary" onClick={() => setEditItem({ category_id: current, price: '', station: 'kitchen', available: 1, modifiers: [], recipe: [] })}>+ صنف</button>
      </PageHead>
      <div className="split">
        <aside className="list-panel">
          {data.categories.map((c) => (
            <div key={c.id} className={`list-item ${current === c.id ? 'active' : ''}`}>
              <button className="list-main" onClick={() => setCat(c.id)}>
                <span>{c.icon} {c.name}</span>
                <span className="muted">{data.items.filter((i) => i.category_id === c.id).length}</span>
              </button>
              <button className="icon-btn" onClick={() => setEditCat(c)} aria-label="تعديل الفئة">✎</button>
            </div>
          ))}
        </aside>
        <div className="table-wrap">
          {!items.length ? <Empty text="لا توجد أصناف في هذه الفئة" /> : (
            <table className="data">
              <thead><tr><th>الصنف</th><th>السعر</th><th>القسم</th><th>الإضافات</th><th>متوفر</th><th /></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td><strong>{i.name}</strong>{i.description && <div className="muted small">{i.description}</div>}</td>
                    <td>{money(i.price)}</td>
                    <td>{STATIONS[i.station]}</td>
                    <td>{i.modifiers.length || '—'}</td>
                    <td>
                      <label className="switch">
                        <input type="checkbox" checked={!!i.available} onChange={(e) => run(() => api(`/items/${i.id}/availability`, { method: 'PATCH', body: { available: e.target.checked } }))} />
                      </label>
                    </td>
                    <td><button className="btn btn-sm" onClick={() => openItem(i.id)}>تعديل</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {editItem && <ItemForm item={editItem} categories={data.categories} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); reload(); }} />}
      {editCat && <CategoryForm cat={editCat} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); reload(); }} />}
    </div>
  );
}

function CategoryForm({ cat, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ name: cat.name || '', icon: cat.icon || '', sort: cat.sort || 0 });
  const save = async () => {
    const ok = await run(() => (cat.id ? api(`/categories/${cat.id}`, { method: 'PUT', body: f }) : api('/categories', { method: 'POST', body: f })), 'تم الحفظ');
    if (ok) onSaved();
  };
  const del = async () => {
    if (!window.confirm('حذف الفئة؟')) return;
    const ok = await run(() => api(`/categories/${cat.id}`, { method: 'DELETE' }), 'تم الحذف');
    if (ok) onSaved();
  };
  return (
    <Modal title={cat.id ? 'تعديل الفئة' : 'فئة جديدة'} onClose={onClose} footer={
      <>
        {cat.id && <button className="btn btn-danger-ghost" onClick={del} disabled={busy}>حذف</button>}
        <button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button>
      </>
    }>
      <Field label="الاسم"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <div className="grid-2">
        <Field label="أيقونة (إيموجي)"><input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} /></Field>
        <Field label="الترتيب"><input type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: Number(e.target.value) })} /></Field>
      </div>
    </Modal>
  );
}

function ItemForm({ item, categories, onClose, onSaved }) {
  const money = useMoney();
  const [run, busy] = useAction();
  const ingredients = useData('/ingredients');
  const [f, setF] = useState({
    category_id: item.category_id, name: item.name || '', description: item.description || '', price: item.price ?? '',
    station: item.station || 'kitchen', available: item.available ?? 1,
    modifiers: item.modifiers?.map((m) => ({ name: m.name, price: m.price })) || [],
    recipe: item.recipe?.map((r) => ({ ingredient_id: r.ingredient_id, qty: r.qty })) || [],
  });
  const set = (k, v) => setF({ ...f, [k]: v });
  const ingMap = Object.fromEntries((ingredients.data || []).map((i) => [i.id, i]));
  const cost = f.recipe.reduce((a, r) => a + (Number(r.qty) || 0) * (ingMap[r.ingredient_id]?.cost_per_unit || 0), 0);
  const margin = Number(f.price) > 0 ? Math.round((1 - cost / Number(f.price)) * 100) : 0;

  const save = async () => {
    const body = { ...f, price: Number(f.price) || 0 };
    const ok = await run(() => (item.id ? api(`/items/${item.id}`, { method: 'PUT', body }) : api('/items', { method: 'POST', body })), 'تم حفظ الصنف');
    if (ok) onSaved();
  };
  const del = async () => {
    if (!window.confirm('حذف الصنف من القائمة؟')) return;
    const ok = await run(() => api(`/items/${item.id}`, { method: 'DELETE' }), 'تم الحذف');
    if (ok) onSaved();
  };

  return (
    <Modal wide title={item.id ? `تعديل: ${item.name}` : 'صنف جديد'} onClose={onClose} footer={
      <>
        {item.id && <button className="btn btn-danger-ghost" onClick={del} disabled={busy}>حذف</button>}
        <button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button>
      </>
    }>
      <div className="grid-2">
        <Field label="اسم الصنف"><input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="السعر"><input type="number" min="0" step="0.5" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <Field label="الفئة">
          <select value={f.category_id} onChange={(e) => set('category_id', Number(e.target.value))}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="قسم التحضير">
          <select value={f.station} onChange={(e) => set('station', e.target.value)}>
            {Object.entries(STATIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="الوصف"><input value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>

      <h4 className="section-title">الإضافات والخيارات</h4>
      {f.modifiers.map((m, i) => (
        <div key={i} className="inline-row">
          <input placeholder="الاسم" value={m.name} onChange={(e) => set('modifiers', f.modifiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input type="number" placeholder="السعر" value={m.price} onChange={(e) => set('modifiers', f.modifiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
          <button className="icon-btn" onClick={() => set('modifiers', f.modifiers.filter((_, j) => j !== i))} aria-label="حذف">✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => set('modifiers', [...f.modifiers, { name: '', price: 0 }])}>+ إضافة خيار</button>

      <h4 className="section-title">الوصفة (للخصم التلقائي من المخزون)</h4>
      {f.recipe.map((r, i) => (
        <div key={i} className="inline-row">
          <select value={r.ingredient_id || ''} onChange={(e) => set('recipe', f.recipe.map((x, j) => (j === i ? { ...x, ingredient_id: Number(e.target.value) } : x)))}>
            <option value="">— المادة —</option>
            {(ingredients.data || []).map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}
          </select>
          <input type="number" step="0.001" placeholder="الكمية" value={r.qty} onChange={(e) => set('recipe', f.recipe.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
          <button className="icon-btn" onClick={() => set('recipe', f.recipe.filter((_, j) => j !== i))} aria-label="حذف">✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => set('recipe', [...f.recipe, { ingredient_id: '', qty: '' }])}>+ إضافة مادة</button>
      {f.recipe.length > 0 && (
        <div className="cost-box">
          <span>التكلفة: <strong>{money(cost)}</strong></span>
          <span>هامش الربح: <strong className={margin < 50 ? 'text-warn' : 'text-ok'}>{margin}%</strong></span>
        </div>
      )}
    </Modal>
  );
}
