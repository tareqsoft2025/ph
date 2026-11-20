import { useMemo, useState } from 'react';
import { Search, PackagePlus, PackageMinus, Trash, FileText, ListOrdered } from 'lucide-react';
import { useData, useMoney, Loading, Empty, Modal } from '../lib.jsx';
import { fmtQty, MOVE_LABEL, MOVE_TONE, daysAgo } from './inv.js';

const META = {
  in: { title: 'الوارد', sub: 'كل ما دخل المخزن: استلامات الموردين بتواريخ صلاحيتها وأسعارها', tone: 'in', icon: PackagePlus, empty: 'لا توجد حركات وارد في هذه الفترة' },
  out: { title: 'الصادر', sub: 'كل ما خرج: بيع المطعم تلقائياً، الصرف الداخلي، ومرتجع الموردين', tone: 'out', icon: PackageMinus, empty: 'لا توجد حركات صادر في هذه الفترة' },
  waste: { title: 'التالف والهدر', sub: 'كل ما شُطب مع سببه وقيمته؛ الهدر المحاسَب أول طريق لخفض التكلفة', tone: 'waste', icon: Trash, empty: 'لا يوجد تالف في هذه الفترة — ممتاز!' },
};
const PERIODS = [['0', 'اليوم'], ['7', '7 أيام'], ['30', '30 يوماً'], ['', 'الكل']];

/** تبويب وارد / صادر / تالف: ملخص الفترة + كشف الحركات بتوقيت كل حركة */
export default function Flow({ kind, canRecv, onAdd, onReceipts }) {
  const money = useMoney();
  const m = META[kind];
  const [period, setPeriod] = useState('30');
  const [q, setQ] = useState('');
  const [view, setView] = useState('items');
  const [open, setOpen] = useState(null);
  const from = period === '' ? '' : daysAgo(Number(period));
  const path = `/stock-movements?kind=${kind}${from ? `&from=${from}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`;
  const { data, loading } = useData(path, ['inventory'], []);
  const rc = useData(kind === 'in' && view === 'docs' ? '/stock/receipts' : null, ['inventory'], [view]);
  const rows = data?.rows || [];
  const stats = useMemo(() => {
    const byReason = {};
    rows.forEach((r) => { const k = r.reason || r.supplier_name || MOVE_LABEL[r.type]; byReason[k] = (byReason[k] || 0) + Math.abs(r.qty) * r.cost; });
    const top = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0];
    return { value: rows.reduce((a, r) => a + Math.abs(r.qty) * r.cost, 0), top };
  }, [rows]);
  const Icon = m.icon;

  return (
    <div className={`inv-flowtab k-${m.tone}`}>
      <header className="inv-fhead">
        <div><h2><Icon size={20} aria-hidden /> {m.title}</h2><p className="muted">{m.sub}</p></div>
        {canRecv && kind === 'in' && <button className="btn btn-primary btn-lg" onClick={() => onAdd('receive')}><PackagePlus size={18} /> استلام بضاعة</button>}
        {canRecv && kind === 'out' && <button className="btn btn-primary btn-lg" onClick={() => onAdd('issue')}><PackageMinus size={18} /> صرف من المخزن</button>}
        {canRecv && kind === 'waste' && <button className="btn btn-danger btn-lg" onClick={() => onAdd('waste')}><Trash size={18} /> تسجيل تالف</button>}
      </header>

      <div className="inv-bar">
        <div className="seg" role="tablist">{PERIODS.map(([k, l]) => <button key={k} role="tab" aria-selected={period === k} className={period === k ? 'active' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div>
        <span className="search-box"><Search size={16} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="مادة، سبب، ملاحظة…" aria-label="بحث" /></span>
        {kind === 'in' && <div className="seg"><button className={view === 'items' ? 'active' : ''} onClick={() => setView('items')}><ListOrdered size={14} /> الأصناف</button><button className={view === 'docs' ? 'active' : ''} onClick={() => setView('docs')}><FileText size={14} /> مستندات الاستلام</button></div>}
      </div>

      <div className="inv-sum">
        <div><span>عدد الحركات</span><b>{data?.count ?? '…'}</b></div>
        <div><span>القيمة الإجمالية</span><b>{money(stats.value)}</b></div>
        {stats.top && <div><span>{kind === 'waste' ? 'أكثر الأسباب' : kind === 'in' ? 'أكبر مورد' : 'أكبر بند'}</span><b>{stats.top[0]}</b><small>{money(stats.top[1])}</small></div>}
      </div>

      {kind === 'in' && view === 'docs' ? (
        rc.loading ? <Loading /> : !(rc.data || []).length ? <Empty text="لا توجد مستندات استلام" /> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>المورد</th><th>الأصناف</th><th>الإجمالي</th><th>سجّله</th></tr></thead>
            <tbody>{rc.data.map((r) => <tr key={r.id} className="inv-row" onClick={() => setOpen(r.id)} tabIndex={0}><td dir="ltr">{r.received_at}<small className="muted"> {String(r.created_at).slice(11, 19)}</small></td><td dir="ltr"><b>{r.invoice_no || '—'}</b></td><td>{r.supplier_name || '—'}</td><td>{r.lines}</td><td className="num"><b>{money(r.total)}</b></td><td>{r.user_name || '—'}</td></tr>)}</tbody>
          </table></div>
        )
      ) : loading ? <Loading /> : !rows.length ? <Empty icon={Icon} text={m.empty} /> : (
        <div className="table-wrap">
          <table className="data inv-ledger">
            <thead><tr><th>التاريخ والوقت</th><th>المادة</th><th>الحركة</th><th>الكمية</th><th>القيمة</th><th>{kind === 'in' ? 'المورد / الفاتورة' : 'السبب / المرجع'}</th><th>الصلاحية</th><th>الرصيد بعد</th><th>بواسطة</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td dir="ltr" className="small">{r.created_at}</td>
                  <td><strong>{r.ingredient_name}</strong><small className="muted">{r.category || ''}</small></td>
                  <td><span className={`mv mv-${MOVE_TONE[r.type]}`}>{MOVE_LABEL[r.type]}</span></td>
                  <td dir="ltr" className={r.qty < 0 ? 'text-err' : 'text-ok'}>{r.qty > 0 ? '+' : ''}{fmtQty(r.qty)} {r.unit}</td>
                  <td className="num">{money(Math.abs(r.qty) * r.cost)}</td>
                  <td className="small">{kind === 'in' ? <>{r.supplier_name || '—'}{r.invoice_no ? <small className="muted" dir="ltr"> · {r.invoice_no}</small> : null}</> : <>{r.reason || ''}{r.order_code ? <bdi dir="ltr" className="muted"> {r.order_code}</bdi> : null}{r.note ? <small className="muted"> · {r.note}</small> : null}</>}</td>
                  <td dir="ltr" className="small">{r.batch_expiry || '—'}</td>
                  <td dir="ltr" className="small">{r.balance_after != null ? fmtQty(r.balance_after) : '—'}</td>
                  <td className="small">{r.user_name || (r.order_code ? 'تلقائي (بيع)' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.count > rows.length && <p className="muted small inv-more">يعرض آخر {rows.length} حركة من {data.count}؛ ضيّق الفترة أو ابحث لتصل لما تريد.</p>}
        </div>
      )}
      {open && <ReceiptDoc id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReceiptDoc({ id, onClose }) {
  const money = useMoney();
  const { data: r } = useData(`/stock/receipts/${id}`, [], [id]);
  return (
    <Modal wide title={r ? `مستند استلام ${r.invoice_no || `#${r.id}`}` : 'مستند استلام'} onClose={onClose}>
      {!r ? <Loading /> : (
        <>
          <div className="trf-brief"><div><span>المورد</span><strong>{r.supplier_name || '—'}</strong></div><div><span>تاريخ الاستلام</span><strong dir="ltr">{r.received_at}</strong></div><div><span>سجّله</span><strong>{r.user_name || '—'}</strong></div><div><span>وقت التسجيل</span><strong dir="ltr">{r.created_at}</strong></div></div>
          <table className="data"><thead><tr><th>المادة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th>الصلاحية</th><th>المتبقي</th></tr></thead>
            <tbody>{r.lines.map((l) => <tr key={l.id}><td><strong>{l.name}</strong></td><td>{fmtQty(l.qty_in)} {l.unit}</td><td>{money(l.unit_cost || 0)}</td><td className="num">{money(l.qty_in * (l.unit_cost || 0))}</td><td dir="ltr">{l.expiry_date || '—'}</td><td>{fmtQty(l.qty_left)} {l.unit}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3}>الإجمالي</td><td className="num"><b>{money(r.total)}</b></td><td colSpan={2} /></tr></tfoot></table>
          {r.note && <p className="muted small">ملاحظة: {r.note}</p>}
        </>
      )}
    </Modal>
  );
}
