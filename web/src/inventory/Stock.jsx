import { useMemo, useState } from 'react';
import { Search, PackagePlus, PackageMinus, Trash, Plus, ChevronLeft } from 'lucide-react';
import { useData, useMoney, Loading, Empty } from '../lib.jsx';
import { fmtQty, STORAGE, daysLeft, expiryTone, expiryText } from './inv.js';

const FILTERS = [['all', 'الكل'], ['low', 'تحت الحد'], ['out', 'نفدت'], ['soon', 'قريبة الانتهاء'], ['expired', 'فيها منتهٍ']];

/** الأرصدة: كل المواد بمستوى المخزون مقابل المستهدف والصلاحية والتغطية */
export default function Stock({ canManage, canRecv, onOpen, onAction, onNew }) {
  const money = useMoney();
  const { data, loading } = useData('/ingredients', ['inventory']);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [f, setF] = useState('all');
  const [storage, setStorage] = useState('');
  const rows = useMemo(() => (data || []).filter((i) => {
    if (q && !i.name.includes(q.trim())) return false;
    if (cat && (i.category || 'غير مصنّف') !== cat) return false;
    if (storage && i.storage !== storage) return false;
    if (f === 'low') return i.low;
    if (f === 'out') return i.out;
    if (f === 'soon') return i.soon_qty > 0;
    if (f === 'expired') return i.expired_qty > 0;
    return true;
  }), [data, q, cat, f, storage]);
  const cats = useMemo(() => [...new Set((data || []).map((i) => i.category || 'غير مصنّف'))], [data]);
  if (loading) return <Loading />;
  const total = rows.reduce((a, i) => a + i.value, 0);

  return (
    <div className="inv-stock">
      <div className="inv-bar">
        <span className="search-box"><Search size={16} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن مادة…" aria-label="بحث" /></span>
        <div className="seg" role="tablist">{FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={f === k} className={f === k ? 'active' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
        <select value={storage} onChange={(e) => setStorage(e.target.value)} aria-label="التخزين"><option value="">كل أنواع التخزين</option>{Object.keys(STORAGE).map((s) => <option key={s} value={s}>{STORAGE[s]} {s}</option>)}</select>
        {canManage && <button className="btn btn-primary" onClick={onNew}><Plus size={16} /> مادة جديدة</button>}
      </div>
      <div className="inv-chips" role="tablist" aria-label="المجموعات">
        <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>كل المجموعات</button>
        {cats.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {!rows.length ? <Empty text="لا توجد مواد مطابقة" /> : (
        <div className="table-wrap">
          <table className="data inv-table">
            <thead><tr><th>المادة</th><th>الرصيد مقابل المستهدف</th><th>التغطية</th><th>أقرب صلاحية</th><th>القيمة</th><th /></tr></thead>
            <tbody>
              {rows.map((i) => {
                const par = i.par_level > 0 ? i.par_level : Math.max(i.min_stock * 2, i.stock, 1);
                const pct = Math.max(0, Math.min(100, (i.stock / par) * 100));
                const minPct = Math.min(100, (i.min_stock / par) * 100);
                const d = daysLeft(i.nearest_expiry);
                const tone = i.out ? 'out' : i.low ? 'low' : 'ok';
                return (
                  <tr key={i.id} className={`inv-row s-${tone}`} onClick={() => onOpen(i.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(i.id)}>
                    <td><strong>{i.name}</strong><small className="muted">{STORAGE[i.storage] || ''} {i.category || 'غير مصنّف'}{i.supplier_name ? ` · ${i.supplier_name}` : ''}</small></td>
                    <td className="inv-level">
                      <div className="top"><b>{fmtQty(i.stock)} <small>{i.unit}</small></b>{i.out ? <span className="badge badge-err">نفدت</span> : i.low ? <span className="badge badge-warn">تحت الحد</span> : null}</div>
                      <div className="bar" title={`الحد الأدنى ${fmtQty(i.min_stock)} · المستهدف ${i.par_level ? fmtQty(i.par_level) : '—'}`}><i className={`fill ${tone}`} style={{ width: `${pct}%` }} /><i className="min" style={{ insetInlineStart: `${minPct}%` }} /></div>
                    </td>
                    <td>{i.days_cover != null ? <span className={`cov ${i.days_cover <= 2 ? 'low' : ''}`}>{i.days_cover} يوم</span> : <span className="muted">—</span>}</td>
                    <td>{i.nearest_expiry ? <span className={`exp-chip exp-${expiryTone(d)}`}>{expiryText(d)}</span> : <span className="muted small">—</span>}{i.expired_qty > 0 && <small className="exp-expired"> منتهٍ {fmtQty(i.expired_qty)}</small>}</td>
                    <td className="num">{money(i.value)}</td>
                    <td className="acts" onClick={(e) => e.stopPropagation()}>
                      {canRecv && <button className="icon-btn" title="استلام" aria-label="استلام" onClick={() => onAction('receive', i)}><PackagePlus size={16} /></button>}
                      {canRecv && <button className="icon-btn" title="صرف" aria-label="صرف" onClick={() => onAction('issue', i)}><PackageMinus size={16} /></button>}
                      {canRecv && <button className="icon-btn danger" title="تالف" aria-label="تالف" onClick={() => onAction('waste', i)}><Trash size={16} /></button>}
                      <button className="icon-btn" title="التفاصيل" aria-label="التفاصيل" onClick={() => onOpen(i.id)}><ChevronLeft size={16} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={4}>{rows.length} مادة</td><td className="num"><b>{money(total)}</b></td><td /></tr></tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
