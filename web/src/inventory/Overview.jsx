import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, TriangleAlert, Hourglass, CalendarX2, Trash2, ArrowDownUp, PackagePlus, Copy, Check, ShoppingCart, Phone } from 'lucide-react';
import { api } from '../api.js';
import { useData, useAction, useMoney, Loading, Empty } from '../lib.jsx';
import { Donut } from '../components/charts.jsx';
import { fmtQty, daysLeft, expiryTone, expiryText } from './inv.js';

/** رسم التدفق اليومي: وارد (أزرق) وصادر (عنبري) وتالف (أحمر) لكل يوم */
function FlowChart({ rows, money }) {
  const max = Math.max(...rows.flatMap((r) => [r.in, r.out, r.waste]), 1);
  return (
    <div className="inv-flow" role="img" aria-label="حركة المخزن آخر 14 يوماً">
      {rows.map((r) => (
        <div key={r.day} className="inv-flow-d" title={`${r.day}\nوارد ${money(r.in)}\nصادر ${money(r.out)}\nتالف ${money(r.waste)}`}>
          <div className="fl-bars"><i className="in" style={{ height: `${(r.in / max) * 100}%` }} /><i className="out" style={{ height: `${(r.out / max) * 100}%` }} /><i className="waste" style={{ height: `${(r.waste / max) * 100}%` }} /></div>
          <span>{r.day.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

/** نظرة عامة: مؤشرات الإدارة وتنبيهات الصلاحية واقتراحات إعادة الطلب وتحليل الهدر */
export default function Overview({ canRecv, onReceive, onGo }) {
  const money = useMoney();
  const { data: o, loading, reload } = useData('/inventory/overview', ['inventory']);
  const [run] = useAction();
  const [copied, setCopied] = useState('');
  if (loading || !o) return <Loading />;
  const k = o.kpis;

  const bySupplier = o.suggestions.reduce((m, s) => { const key = s.supplier_name || 'بلا مورد محدد'; (m[key] = m[key] || { id: s.supplier_id, name: key, rows: [] }).rows.push(s); return m; }, {});
  const orderText = (g) => `طلب شراء — ${g.name}\n${g.rows.map((s) => `• ${s.name}: ${fmtQty(s.need)} ${s.unit}`).join('\n')}`;
  const copy = async (g) => { try { await navigator.clipboard.writeText(orderText(g)); setCopied(g.name); setTimeout(() => setCopied(''), 1600); } catch { /* */ } };
  const discard = async (b) => { if (!window.confirm(`شطب ${fmtQty(b.qty_left)} ${b.unit} من «${b.name}» كتالف؟`)) return; if (await run(() => api(`/stock/batches/${b.id}/discard`, { method: 'POST', body: { reason: 'انتهاء الصلاحية' } }), 'تم شطب الدفعة')) reload(); };

  const kpis = [
    { icon: Wallet, tone: 'val', l: 'قيمة المخزون', v: money(k.value), s: `${k.items} مادة` },
    { icon: TriangleAlert, tone: k.low + k.out ? 'warn' : 'ok', l: 'تحتاج إعادة طلب', v: k.low + k.out, s: k.out ? `${k.out} نفدت` : 'تحت الحد الأدنى', go: 'stock' },
    { icon: Hourglass, tone: k.expiring ? 'warn' : 'ok', l: 'تنتهي خلال 7 أيام', v: k.expiring, s: money(k.expiring_value), go: 'expiry' },
    { icon: CalendarX2, tone: k.expired ? 'err' : 'ok', l: 'منتهية الصلاحية', v: k.expired, s: k.expired ? `خسارة محتملة ${money(k.expired_value)}` : 'لا شيء', go: 'expiry' },
    { icon: Trash2, tone: 'waste', l: 'تالف هذا الشهر', v: money(k.waste_month), s: `${k.waste_pct}% من المشتريات`, go: 'waste' },
    { icon: ArrowDownUp, tone: 'flow', l: 'حركة اليوم', v: `${money(k.today_in)}`, s: `وارد · صادر ${money(k.today_out)}`, go: 'in' },
  ];

  return (
    <div className="inv-ov">
      <section className="inv-kpis">
        {kpis.map((x) => { const I = x.icon; const Tag = x.go ? 'button' : 'div'; return (
          <Tag key={x.l} className={`inv-kpi k-${x.tone}`} onClick={x.go ? () => onGo(x.go) : undefined}><span className="ic"><I size={18} aria-hidden /></span><span className="l">{x.l}</span><strong>{x.v}</strong><small>{x.s}</small></Tag>); })}
      </section>

      <div className="inv-grid">
        <section className="inv-card wide">
          <header><h3>حركة المخزن آخر 14 يوماً</h3><div className="inv-legend"><span className="in">وارد</span><span className="out">صادر</span><span className="waste">تالف</span></div></header>
          <FlowChart rows={o.flow} money={money} />
        </section>

        <section className="inv-card">
          <header><h3><CalendarX2 size={16} aria-hidden /> تنبيهات الصلاحية</h3><button className="dsh-more" onClick={() => onGo('expiry')}>الكل</button></header>
          {!o.expiry.expired.length && !o.expiry.expiring.length ? <Empty icon={Check} text="لا توجد دفعات قاربت على الانتهاء" /> : (
            <ul className="inv-alerts">
              {[...o.expiry.expired, ...o.expiry.expiring].slice(0, 7).map((b) => { const d = daysLeft(b.expiry_date); return (
                <li key={b.id} className={`exp-${expiryTone(d)}`}>
                  <div><strong>{b.name}</strong><small>{fmtQty(b.qty_left)} {b.unit} · {money(b.qty_left * (b.unit_cost || 0))}</small></div>
                  <span className="exp-chip">{expiryText(d)}</span>
                  {canRecv && d < 0 && <button className="btn btn-xs btn-danger-ghost" onClick={() => discard(b)}>شطب</button>}
                </li>); })}
            </ul>
          )}
        </section>

        <section className="inv-card">
          <header><h3><ShoppingCart size={16} aria-hidden /> اقتراحات إعادة الطلب</h3><span className="muted small">{o.suggestions.length} مادة</span></header>
          {!o.suggestions.length ? <Empty icon={Check} text="كل المواد فوق الحد الأدنى" /> : Object.values(bySupplier).map((g) => (
            <div key={g.name} className="inv-sug">
              <header><strong>{g.name}</strong><span className="muted small">≈ {money(g.rows.reduce((a, s) => a + s.est_cost, 0))}</span>
                <button className="btn btn-xs" onClick={() => copy(g)}>{copied === g.name ? <><Check size={13} /> نُسخ</> : <><Copy size={13} /> نسخ الطلب</>}</button>
                {canRecv && <button className="btn btn-xs btn-primary" onClick={() => onReceive({ supplier_id: g.id, lines: g.rows.map((s) => ({ ingredient_id: s.ingredient_id, need: s.need })) })}><PackagePlus size={13} /> استلام</button>}</header>
              <ul>{g.rows.map((s) => <li key={s.ingredient_id}><span>{s.name}</span><span className="muted small">{fmtQty(s.stock)} / {fmtQty(s.min_stock)} {s.unit}{s.days_cover != null ? ` · يكفي ${s.days_cover} يوم` : ''}</span><b>{fmtQty(s.need)} {s.unit}</b></li>)}</ul>
            </div>
          ))}
        </section>

        <section className="inv-card">
          <header><h3>التالف حسب السبب</h3><span className="muted small">هذا الشهر</span></header>
          <Donut rows={o.waste_by_reason.map((r) => ({ label: r.reason, value: r.value }))} fmt={money} />
          {o.top_waste.length > 0 && <div className="inv-top"><h4>أكثر المواد هدراً</h4><ol>{o.top_waste.map((w) => <li key={w.name}><span>{w.name}</span><small>{fmtQty(w.qty)} {w.unit}</small><b>{money(w.value)}</b></li>)}</ol></div>}
        </section>

        <section className="inv-card">
          <header><h3>قيمة المخزون حسب المجموعة</h3></header>
          <ul className="inv-bars">{o.by_category.map((c) => <li key={c.name}><span>{c.name}</span><span className="tr"><i style={{ width: `${(c.value / (o.by_category[0]?.value || 1)) * 100}%` }} /></span><b>{money(c.value)}</b></li>)}</ul>
          {o.top_used.length > 0 && <div className="inv-top"><h4>الأكثر استهلاكاً (14 يوماً)</h4><ol>{o.top_used.map((w) => <li key={w.name}><span>{w.name}</span><small>{fmtQty(w.qty)} {w.unit}</small><b>{money(w.value)}</b></li>)}</ol></div>}
        </section>
      </div>
      <p className="muted small inv-foot"><Phone size={13} aria-hidden /> الموردون وأرقامهم في تبويب «الموردون». <Link to="/reports">التقارير</Link> تعرض أثر الهدر على الربح.</p>
    </div>
  );
}
