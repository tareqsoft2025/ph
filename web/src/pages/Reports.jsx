import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Printer, Download, SlidersHorizontal, X, Lightbulb, TriangleAlert, CircleCheck, GitCompareArrows, LayoutDashboard, ShoppingBag, UtensilsCrossed,
  Users, Landmark, Boxes, Contact,
} from 'lucide-react';
import { useData, useMoney, Loading, Empty, ORDER_TYPES, PAY_METHODS, WEEKDAYS, TRANSFER_METHODS, todayStr } from '../lib.jsx';
import { Spark, Donut, Ring } from '../components/charts.jsx';
import { Delta, Trend, HBars, Cols, Heatmap, downloadCsv, pctOf } from '../reports/parts.jsx';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ago = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const PERIODS = {
  today: ['اليوم', () => [ago(0), ago(0)]],
  yesterday: ['أمس', () => [ago(1), ago(1)]],
  d7: ['7 أيام', () => [ago(6), ago(0)]],
  d30: ['30 يوماً', () => [ago(29), ago(0)]],
  month: ['هذا الشهر', () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), ago(0)]; }],
  lastmonth: ['الشهر الماضي', () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; }],
};
const SOURCES = { staff: 'الموظفون', online: 'الزبون عبر QR' };
const DAYPARTS = { morning: ['صباحاً (5–11)', 5, 11], noon: ['ظهراً (12–16)', 12, 16], evening: ['مساءً (17–21)', 17, 21], night: ['ليلاً (22–23)', 22, 23] };
const FILTER_KEYS = ['type', 'method', 'staff', 'category', 'source', 'event', 'area', 'part'];
const TABS = [
  ['overview', 'نظرة عامة', LayoutDashboard], ['sales', 'المبيعات', ShoppingBag], ['items', 'الأصناف', UtensilsCrossed], ['team', 'الفريق', Users],
  ['money', 'المالية', Landmark], ['stock', 'المخزون', Boxes], ['people', 'العملاء والفعاليات', Contact],
];

/** التقارير: فلاتر ذكية + مقارنة بالفترة السابقة + رؤى تلقائية */
export default function Reports() {
  const money = useMoney();
  const [sp, setSp] = useSearchParams();
  const preset = sp.get('p') || 'today';
  const [pf, pt] = PERIODS[preset] ? PERIODS[preset][1]() : [sp.get('from') || todayStr(), sp.get('to') || todayStr()];
  const from = preset === 'custom' ? (sp.get('from') || todayStr()) : pf;
  const to = preset === 'custom' ? (sp.get('to') || todayStr()) : pt;
  const tab = sp.get('tab') || 'overview';
  const compare = sp.get('cmp') !== '0';
  const fv = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) || '']));
  const active = FILTER_KEYS.filter((k) => fv[k]);
  const [open, setOpen] = useState(active.length > 0);

  const set = (patch) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => { if (v === '' || v == null || (k === 'cmp' && v === '1') || (k === 'tab' && v === 'overview') || (k === 'p' && v === 'today')) n.delete(k); else n.set(k, v); });
    setSp(n, { replace: true });
  };
  const setPreset = (p) => set({ p, from: '', to: '' });

  const qs = new URLSearchParams({ from, to });
  FILTER_KEYS.filter((k) => k !== 'part').forEach((k) => { if (fv[k]) qs.set(k, fv[k]); });
  if (fv.part && DAYPARTS[fv.part]) { qs.set('hour_from', DAYPARTS[fv.part][1]); qs.set('hour_to', DAYPARTS[fv.part][2]); }
  const { data: d, loading } = useData(`/reports/overview?${qs}`, ['orders', 'inventory', 'transfers'], [qs.toString()]);

  const meta = d?.meta;
  const chipLabel = (k) => {
    const v = fv[k];
    if (k === 'type') return ORDER_TYPES[v];
    if (k === 'method') return PAY_METHODS[v];
    if (k === 'staff') return meta?.staff.find((s) => String(s.id) === v)?.name;
    if (k === 'category') return meta?.categories.find((s) => String(s.id) === v)?.name;
    if (k === 'source') return SOURCES[v] || v;
    if (k === 'event') return v === 'any' ? 'كل الفعاليات' : v === 'none' ? 'بدون فعالية' : meta?.events.find((s) => String(s.id) === v)?.name;
    if (k === 'area') return v;
    return DAYPARTS[v]?.[0];
  };
  const LBL = { type: 'النوع', method: 'الدفع', staff: 'الموظف', category: 'الفئة', source: 'المصدر', event: 'الفعالية', area: 'المنطقة', part: 'الوقت' };

  return (
    <div className="rp">
      <header className="rp-head">
        <div><h1>التقارير</h1><p className="muted">{from === to ? from : `${from} ← ${to}`}{d ? ` · ${d.range.days} ${d.range.days === 1 ? 'يوم' : 'يوماً'}` : ''}{active.length ? ` · ${active.length} فلتر نشط` : ''}</p></div>
        <div className="rp-head-act">
          <button className="btn" onClick={() => d && exportCsv(d, from, to)} disabled={!d}><Download size={16} aria-hidden /> تصدير CSV</button>
          <button className="btn" onClick={() => window.print()} aria-label="طباعة"><Printer size={16} aria-hidden /> طباعة</button>
        </div>
      </header>

      <section className="rp-filters" aria-label="فلاتر التقرير">
        <div className="rp-row">
          <div className="seg" role="tablist" aria-label="الفترة">
            {Object.entries(PERIODS).map(([k, [l]]) => <button key={k} role="tab" aria-selected={preset === k} className={preset === k ? 'active' : ''} onClick={() => setPreset(k)}>{l}</button>)}
            <button role="tab" aria-selected={preset === 'custom'} className={preset === 'custom' ? 'active' : ''} onClick={() => set({ p: 'custom', from, to })}>مخصص</button>
          </div>
          {preset === 'custom' && (
            <span className="rp-dates"><input type="date" value={from} max={to} onChange={(e) => set({ p: 'custom', from: e.target.value, to })} aria-label="من" /><span aria-hidden>←</span><input type="date" value={to} min={from} onChange={(e) => set({ p: 'custom', from, to: e.target.value })} aria-label="إلى" /></span>
          )}
          <label className={`rp-switch ${compare ? 'on' : ''}`}><input type="checkbox" checked={compare} onChange={(e) => set({ cmp: e.target.checked ? '1' : '0' })} /><GitCompareArrows size={15} aria-hidden /> قارن بالفترة السابقة</label>
          <button className={`btn rp-fbtn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}><SlidersHorizontal size={15} aria-hidden /> فلاتر{active.length ? <b>{active.length}</b> : null}</button>
        </div>
        {open && (
          <div className="rp-selects">
            <Sel label="نوع الطلب" v={fv.type} on={(v) => set({ type: v })} opts={Object.entries(ORDER_TYPES)} />
            <Sel label="طريقة الدفع" v={fv.method} on={(v) => set({ method: v })} opts={Object.entries(PAY_METHODS)} />
            <Sel label="الموظف" v={fv.staff} on={(v) => set({ staff: v })} opts={(meta?.staff || []).map((s) => [String(s.id), s.name])} />
            <Sel label="الفئة" v={fv.category} on={(v) => set({ category: v })} opts={(meta?.categories || []).map((s) => [String(s.id), s.name])} />
            <Sel label="المصدر" v={fv.source} on={(v) => set({ source: v })} opts={Object.entries(SOURCES)} />
            <Sel label="الفعالية" v={fv.event} on={(v) => set({ event: v })} opts={[['any', 'كل الفعاليات'], ['none', 'بدون فعالية'], ...(meta?.events || []).map((s) => [String(s.id), s.name])]} />
            <Sel label="المنطقة" v={fv.area} on={(v) => set({ area: v })} opts={(meta?.areas || []).map((a) => [a, a])} />
            <Sel label="وقت اليوم" v={fv.part} on={(v) => set({ part: v })} opts={Object.entries(DAYPARTS).map(([k, x]) => [k, x[0]])} />
          </div>
        )}
        {active.length > 0 && (
          <div className="rp-chips" aria-label="الفلاتر النشطة">
            {active.map((k) => <button key={k} className="rp-chip" onClick={() => set({ [k]: '' })} aria-label={`إزالة فلتر ${LBL[k]}`}><span>{LBL[k]}:</span> <b>{chipLabel(k) || fv[k]}</b> <X size={13} aria-hidden /></button>)}
            <button className="rp-clear" onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])))}>مسح الكل</button>
          </div>
        )}
      </section>

      {loading && !d ? <Loading /> : !d ? null : (
        <div className={loading ? 'rp-busy' : ''}>
          <Insights d={d} money={money} compare={compare} />
          <Kpis d={d} money={money} compare={compare} />
          <nav className="rp-tabs" role="tablist" aria-label="أقسام التقرير">
            {TABS.map(([k, l, Icon]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set({ tab: k })}><Icon size={16} aria-hidden /> {l}</button>)}
          </nav>
          {tab === 'overview' && <Overview d={d} money={money} compare={compare} />}
          {tab === 'sales' && <Sales d={d} money={money} />}
          {tab === 'items' && <Items d={d} money={money} />}
          {tab === 'team' && <Team d={d} money={money} />}
          {tab === 'money' && <Money d={d} money={money} compare={compare} />}
          {tab === 'stock' && <Stock d={d} money={money} />}
          {tab === 'people' && <People d={d} money={money} />}
        </div>
      )}
    </div>
  );
}

function Sel({ label, v, on, opts }) {
  return (
    <label className={`rp-sel ${v ? 'on' : ''}`}>
      <span>{label}</span>
      <select value={v} onChange={(e) => on(e.target.value)}><option value="">الكل</option>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
    </label>
  );
}

/** رؤى تلقائية مستخرجة من البيانات */
function Insights({ d, money, compare }) {
  const list = useMemo(() => {
    const k = d.kpis; const p = d.prev_kpis; const out = [];
    if (!k.orders) return [{ tone: 'info', text: 'لا توجد مبيعات في هذه الفترة بالفلاتر الحالية. جرّب توسيع الفترة أو مسح بعض الفلاتر.' }];
    if (compare && p.sales > 0) {
      const c = ((k.sales - p.sales) / p.sales) * 100;
      if (Math.abs(c) >= 3) out.push({ tone: c > 0 ? 'good' : 'bad', text: `المبيعات ${c > 0 ? 'ارتفعت' : 'انخفضت'} ${Math.abs(c).toFixed(0)}% عن الفترة السابقة (${money(p.sales)} ← ${money(k.sales)}).` });
    }
    if (d.best_day && d.range.days > 1) out.push({ tone: 'info', text: `أفضل يوم ${d.best_day.day} بمبيعات ${money(d.best_day.total)} من ${d.best_day.orders} طلب.` });
    if (d.peak_hour) out.push({ tone: 'info', text: `ذروة البيع عند الساعة ${d.peak_hour.hour}:00 (${money(d.peak_hour.total)}) — جهّز الفريق قبلها.` });
    if (d.items[0]) out.push({ tone: 'good', text: `«${d.items[0].name}» الأكثر طلباً: ${d.items[0].qty} قطعة (${Math.round(pctOf(d.items[0].total, d.items.reduce((a, i) => a + i.total, 0)))}% من مبيعات الأصناف).` });
    if (k.net_sales > 0) out.push(k.margin < 30 ? { tone: 'bad', text: `هامش مجمل الربح ${k.margin.toFixed(0)}% — منخفض. راجع تسعير الأصناف وتكلفة الوصفات.` } : { tone: 'good', text: `هامش مجمل الربح ${k.margin.toFixed(0)}% — جيد.` });
    if (k.discount_rate >= 8) out.push({ tone: 'bad', text: `الخصومات ${k.discount_rate.toFixed(1)}% من المبيعات (${money(k.discounts)}) — راجع من يمنحها.` });
    if (k.sales > 0 && pctOf(k.waste, k.sales) >= 3) out.push({ tone: 'bad', text: `الهدر ${money(k.waste)} (${pctOf(k.waste, k.sales).toFixed(1)}% من المبيعات). السبب الأكبر: ${d.inventory.waste_by_reason[0]?.reason || '—'}.` });
    if (k.orders && pctOf(k.cancelled, k.orders + k.cancelled) >= 5) out.push({ tone: 'bad', text: `ألغيت ${k.cancelled} طلبات (${pctOf(k.cancelled, k.orders + k.cancelled).toFixed(0)}%) بقيمة ${money(k.cancelled_value)}.` });
    const unv = d.by_payment.filter((x) => TRANSFER_METHODS.includes(x.method)).reduce((a, x) => a + x.unverified, 0);
    if (unv > 0) out.push({ tone: 'bad', text: `${money(unv)} تحويلات لم يُؤكَّد وصولها بعد — افتح شاشة تدقيق التحويلات.` });
    if (k.expenses > 0 && k.expenses > k.gross_profit) out.push({ tone: 'bad', text: `المصروفات ${money(k.expenses)} تفوق مجمل الربح — الفترة بصافي خسارة ${money(Math.abs(k.net_profit))}.` });
    if (d.inventory.low.length) out.push({ tone: 'bad', text: `${d.inventory.low.length} مواد تحت الحد الأدنى للمخزون، أولها «${d.inventory.low[0].name}».` });
    if (d.unsold.length >= 3) out.push({ tone: 'info', text: `${d.unsold.length}${d.unsold.length >= 12 ? '+' : ''} صنفاً فعّالاً لم يُبَع إطلاقاً في هذه الفترة.` });
    return out.slice(0, 6);
  }, [d, money, compare]);
  return (
    <section className="rp-insights" aria-label="رؤى تلقائية">
      <h2><Lightbulb size={16} aria-hidden /> ماذا يقول لك التقرير</h2>
      <ul>{list.map((x, i) => { const Icon = x.tone === 'bad' ? TriangleAlert : x.tone === 'good' ? CircleCheck : Lightbulb; return <li key={i} className={x.tone}><Icon size={16} aria-hidden /><span>{x.text}</span></li>; })}</ul>
    </section>
  );
}

function Kpis({ d, money, compare }) {
  const k = d.kpis; const p = d.prev_kpis;
  const spark = d.series.map((s) => s.total);
  const small = [
    ['متوسط الفاتورة', money(k.avg_ticket), k.avg_ticket, p.avg_ticket],
    ['للشخص الواحد', k.guests ? money(k.per_guest) : '—', k.per_guest, p.per_guest],
    ['الخصومات', money(k.discounts), k.discounts, p.discounts, true, `${k.discount_rate.toFixed(1)}%`],
    ['طلبات ملغاة', k.cancelled, k.cancelled, p.cancelled, true, k.cancelled_value ? money(k.cancelled_value) : ''],
    ['الهدر', money(k.waste), k.waste, p.waste, true],
    ['المصروفات', money(k.expenses), k.expenses, p.expenses, true],
    ['الضريبة', money(k.tax), k.tax, p.tax],
    ['الضيوف', k.guests, k.guests, p.guests],
  ];
  return (
    <section className="rp-kpis">
      <article className="rp-kpi main">
        <span className="lbl">إجمالي المبيعات</span>
        <strong>{money(k.sales)}</strong>
        <Delta cur={k.sales} prev={p.sales} show={compare} />
        <div className="spark-wrap"><Spark values={spark} height={52} /></div>
        <small className="muted">{k.orders} طلب · صافي بلا ضريبة {money(k.net_sales)}</small>
      </article>
      <article className="rp-kpi"><span className="lbl">مجمل الربح</span><strong>{money(k.gross_profit)}</strong><Delta cur={k.gross_profit} prev={p.gross_profit} show={compare} />
        <div className="rp-ringrow"><Ring value={k.margin} size={52} stroke={6} tone="var(--ok, #16a34a)"><small>{Math.round(k.margin)}%</small></Ring><small className="muted">هامش الربح · تكلفة {money(k.cogs)}</small></div></article>
      <article className={`rp-kpi ${k.net_profit < 0 ? 'neg' : ''}`}><span className="lbl">صافي الربح</span><strong>{money(k.net_profit)}</strong><Delta cur={k.net_profit} prev={p.net_profit} show={compare} /><small className="muted">بعد الهدر والمصروفات</small></article>
      <article className="rp-kpi"><span className="lbl">عدد الطلبات</span><strong>{k.orders}</strong><Delta cur={k.orders} prev={p.orders} show={compare} /><small className="muted">{d.range.days > 1 ? `${(k.orders / d.range.days).toFixed(1)} طلب يومياً` : 'اليوم'}</small></article>
      <div className="rp-smalls">
        {small.map(([l, v, cur, prev, inv, sub]) => <div key={l} className="rp-small"><span>{l}</span><b>{v}</b><Delta cur={cur} prev={prev} invert={inv} show={compare} />{sub ? <small className="muted">{sub}</small> : null}</div>)}
      </div>
    </section>
  );
}

const Card = ({ title, sub, children, wide, className = '' }) => (
  <section className={`rp-card ${wide ? 'wide' : ''} ${className}`}><header><h3>{title}</h3>{sub && <small className="muted">{sub}</small>}</header>{children}</section>
);

function Overview({ d, money, compare }) {
  const k = d.kpis;
  const pl = [
    ['المبيعات شاملة الضريبة', k.sales, 'base'], ['الضريبة', -k.tax, 'neg'], ['صافي المبيعات', k.net_sales, 'sub'], ['تكلفة المبيعات', -k.cogs, 'neg'],
    ['مجمل الربح', k.gross_profit, 'sub'], ['الهدر', -k.waste, 'neg'], ['المصروفات', -k.expenses, 'neg'], ['صافي الربح', k.net_profit, 'total'],
  ];
  const mx = Math.max(...pl.map((r) => Math.abs(r[1])), 1);
  return (
    <div className="rp-grid">
      <Card title="اتجاه المبيعات" sub={d.range.days > 1 ? 'مبيعات كل يوم' : 'يوم واحد — انظر الساعات أدناه'} wide>
        {d.range.days > 1 ? <Trend series={d.series} prev={d.prev_series} money={money} compare={compare} />
          : <Cols rows={byHourRows(d)} fmt={money} height={190} hot={d.peak_hour ? byHourRows(d).findIndex((r) => r.hour === d.peak_hour.hour) : -1} />}
      </Card>
      <Card title="من المبيعات إلى صافي الربح" sub="أين يذهب كل ريال">
        <ul className="rp-pl">
          {pl.map(([l, v, t]) => <li key={l} className={t}><span>{l}</span><i style={{ width: `${(Math.abs(v) / mx) * 100}%` }} /><b>{v < 0 ? `− ${money(-v)}` : money(v)}</b></li>)}
        </ul>
      </Card>
      <Card title="ساعات الذروة" sub="أيام الأسبوع × ساعات اليوم" wide><Heatmap heat={d.heat} money={money} /></Card>
      <Card title="نوع الطلب"><Donut rows={d.by_type.map((t) => ({ label: `${ORDER_TYPES[t.type] || t.type} (${t.orders})`, value: t.total }))} fmt={money} /></Card>
      <Card title="طرق الدفع"><Donut rows={d.by_payment.map((t) => ({ label: PAY_METHODS[t.method] || t.method, value: t.total }))} fmt={money} /></Card>
    </div>
  );
}
const byHourRows = (d) => {
  if (!d.by_hour.length) return [];
  const lo = Math.min(...d.by_hour.map((h) => h.hour)); const hi = Math.max(...d.by_hour.map((h) => h.hour));
  const m = new Map(d.by_hour.map((h) => [h.hour, h]));
  return Array.from({ length: hi - lo + 1 }, (_, i) => ({ hour: lo + i, label: `${lo + i}`, value: m.get(lo + i)?.total || 0, sub: `${m.get(lo + i)?.orders || 0} طلب` }));
};

function Sales({ d, money }) {
  const wk = WEEKDAYS.map((n, dow) => { const r = d.by_weekday.find((x) => x.dow === dow); return { label: n.replace('ال', ''), value: r ? r.total / Math.max(r.days, 1) : 0, sub: r ? `${r.orders} طلب في ${r.days} يوم` : '' }; });
  const bestWk = wk.reduce((b, r, i) => (r.value > (wk[b]?.value || 0) ? i : b), 0);
  return (
    <div className="rp-grid">
      <Card title="متوسط المبيعات حسب اليوم" sub="متوسط ما يبيعه كل يوم أسبوع"><Cols rows={wk} fmt={money} hot={bestWk} /></Card>
      <Card title="المبيعات حسب الساعة"><Cols rows={byHourRows(d)} fmt={money} hot={d.peak_hour ? byHourRows(d).findIndex((r) => r.hour === d.peak_hour.hour) : -1} /></Card>
      <Card title="نوع الطلب"><HBars rows={d.by_type.map((t) => ({ label: ORDER_TYPES[t.type] || t.type, sub: `${t.orders} طلب · متوسط ${money(t.avg)}`, value: t.total }))} fmt={money} /></Card>
      <Card title="مصدر الطلب"><HBars rows={d.by_source.map((t) => ({ label: SOURCES[t.source] || t.source, sub: `${t.orders} طلب`, value: t.total }))} fmt={money} /></Card>
      <Card title="المناطق"><HBars rows={d.by_area.map((t) => ({ label: t.area, sub: `${t.orders} طلب`, value: t.total }))} fmt={money} empty="لا طلبات صالة بمناطق" /></Card>
      <Card title="أكثر الطاولات مبيعاً"><HBars rows={d.by_table.map((t) => ({ label: t.name, sub: `${t.orders} طلب`, value: t.total }))} fmt={money} empty="لا طلبات صالة" /></Card>
      {d.range.days > 1 && (
        <Card title="كشف يومي" wide>
          <div className="table-wrap"><table className="data"><thead><tr><th>اليوم</th><th>الطلبات</th><th>المبيعات</th><th>مقابل اليوم المماثل السابق</th></tr></thead>
            <tbody>{d.series.map((s, i) => <tr key={s.day}><td dir="ltr">{s.day}</td><td>{s.orders}</td><td className="num">{money(s.total)}</td><td><Delta cur={s.total} prev={d.prev_series[i]?.total || 0} /></td></tr>)}</tbody></table></div>
        </Card>
      )}
    </div>
  );
}

function Items({ d, money }) {
  const total = d.items.reduce((a, i) => a + i.total, 0);
  return (
    <div className="rp-grid">
      <Card title="الأصناف الأكثر مبيعاً" sub={`${d.items_count} صنفاً بيع`} wide>
        {!d.items.length ? <p className="rp-empty">لا مبيعات</p> : (
          <div className="table-wrap"><table className="data rp-items"><thead><tr><th>#</th><th>الصنف</th><th>الفئة</th><th>الكمية</th><th>الطلبات</th><th>المبيعات</th><th>الحصة</th></tr></thead>
            <tbody>{d.items.map((i, n) => <tr key={i.id ?? n}><td className="muted">{n + 1}</td><td><strong>{i.name}</strong></td><td className="muted small">{i.category || '—'}</td><td>{i.qty}</td><td>{i.orders}</td><td className="num">{money(i.total)}</td><td><span className="rp-share"><i style={{ width: `${pctOf(i.total, total)}%` }} /><em>{Math.round(pctOf(i.total, total))}%</em></span></td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title="المبيعات حسب الفئة"><Donut rows={d.by_category.map((c) => ({ label: c.name, value: c.total }))} fmt={money} /></Card>
      <Card title="الأقل مبيعاً" sub="يستحق مراجعة السعر أو الترويج"><HBars rows={d.bottom_items.map((i) => ({ label: i.name, sub: `${i.qty} قطعة`, value: i.total }))} fmt={money} /></Card>
      <Card title="أصناف لم تُبَع" sub="فعّالة في القائمة بلا أي طلب">
        {d.unsold.length ? <div className="rp-tags">{d.unsold.map((u) => <span key={u.id} className="rp-tag">{u.name}<small>{u.category}</small></span>)}</div> : <p className="rp-empty">كل الأصناف الفعّالة بيعت — ممتاز</p>}
      </Card>
    </div>
  );
}

function Team({ d, money }) {
  const total = d.staff.reduce((a, s) => a + s.total, 0);
  return (
    <div className="rp-grid">
      <Card title="أداء الموظفين" sub="الطلبات المسجَّلة على حساب كل موظف" wide>
        {!d.staff.length ? <p className="rp-empty">لا بيانات</p> : (
          <div className="table-wrap"><table className="data"><thead><tr><th>الموظف</th><th>الطلبات</th><th>المبيعات</th><th>متوسط الفاتورة</th><th>الخصومات</th><th>الحصة</th></tr></thead>
            <tbody>{d.staff.map((s) => <tr key={s.id}><td><strong>{s.name}</strong></td><td>{s.orders}</td><td className="num">{money(s.total)}</td><td>{money(s.avg)}</td><td className={s.discounts > 0 ? 'text-warn' : ''}>{money(s.discounts)}</td><td><span className="rp-share"><i style={{ width: `${pctOf(s.total, total)}%` }} /><em>{Math.round(pctOf(s.total, total))}%</em></span></td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title="الكاشيرات (من أغلق الفاتورة)"><HBars rows={d.cashiers.map((c) => ({ label: c.name, sub: `${c.orders} فاتورة`, value: c.total }))} fmt={money} /></Card>
    </div>
  );
}

function Money({ d, money, compare }) {
  const k = d.kpis;
  const exp = d.expenses;
  const pay = d.by_payment;
  return (
    <div className="rp-grid">
      <Card title="طرق الدفع والتحويلات" sub="التحويلات تُدقَّق في شاشة تدقيق التحويلات" wide>
        {!pay.length ? <p className="rp-empty">لا مدفوعات</p> : (
          <div className="table-wrap"><table className="data"><thead><tr><th>الطريقة</th><th>عدد العمليات</th><th>الإجمالي</th><th>تم تأكيده</th><th>لم يُؤكَّد</th></tr></thead>
            <tbody>{pay.map((p) => { const tr = TRANSFER_METHODS.includes(p.method); return <tr key={p.method}><td><strong>{PAY_METHODS[p.method] || p.method}</strong></td><td>{p.n}</td><td className="num">{money(p.total)}</td><td className="text-ok">{tr ? money(p.confirmed) : '—'}</td><td className={p.unverified > 0 ? 'text-err' : ''}>{tr ? money(p.unverified) : '—'}</td></tr>; })}</tbody></table></div>
        )}
      </Card>
      <Card title="المصروفات حسب النوع" sub={`${money(exp.total)} إجمالاً`}>
        <HBars rows={exp.by_category.map((c) => ({ label: c.name || 'بدون نوع', sub: `${c.n} عملية`, value: c.total, color: c.color || undefined }))} fmt={money} total={exp.total} empty="لا مصروفات في هذه الفترة" />
      </Card>
      <Card title="أكبر الموردين / الجهات"><HBars rows={exp.by_vendor.map((v) => ({ label: v.vendor, sub: `${v.n} عملية`, value: v.total }))} fmt={money} empty="لا جهات مسجّلة" /></Card>
      <Card title="المصروفات بحسب وسيلة الدفع"><HBars rows={exp.by_method.map((m) => ({ label: PAY_METHODS[m.method] || m.method, value: m.total }))} fmt={money} empty="لا مصروفات" /></Card>
      <Card title="أكبر الخصومات" sub={`${d.discounts.orders} فاتورة بخصم · ${money(k.discounts)}`}>
        {!d.discounts.top.length ? <p className="rp-empty">لا خصومات</p> : (
          <ul className="rp-list">{d.discounts.top.map((x) => <li key={x.id}><span><b dir="ltr">{x.code}</b><small className="muted">{x.waiter_name || ''}{x.discount_type === 'percent' ? ` · ${x.discount_value}%` : ''}</small></span><b className="text-warn">{money(x.discount)}</b></li>)}</ul>
        )}
      </Card>
      <Card title="الإلغاءات" sub={`${k.cancelled} طلب · ${d.cancels.items} صنف ملغى`}>
        {!d.cancels.reasons.length ? <p className="rp-empty">لا إلغاءات</p> : <HBars rows={d.cancels.reasons.map((x) => ({ label: x.reason, sub: `${x.n} طلب`, value: x.value }))} fmt={money} />}
      </Card>
      {compare && <Card title="مقارنة بالفترة السابقة" sub={`${d.previous.from} ← ${d.previous.to}`} wide>
        <div className="table-wrap"><table className="data"><thead><tr><th>المؤشر</th><th>الحالية</th><th>السابقة</th><th>التغيّر</th></tr></thead>
          <tbody>{[['المبيعات', 'sales'], ['صافي المبيعات', 'net_sales'], ['تكلفة المبيعات', 'cogs', true], ['مجمل الربح', 'gross_profit'], ['الهدر', 'waste', true], ['المصروفات', 'expenses', true], ['صافي الربح', 'net_profit']].map(([l, key, inv]) => <tr key={key}><td>{l}</td><td className="num">{money(d.kpis[key])}</td><td className="num muted">{money(d.prev_kpis[key])}</td><td><Delta cur={d.kpis[key]} prev={d.prev_kpis[key]} invert={inv} /></td></tr>)}</tbody></table></div>
      </Card>}
    </div>
  );
}

function Stock({ d, money }) {
  const inv = d.inventory;
  return (
    <div className="rp-grid">
      <div className="rp-minis wide">
        <div><span>قيمة المخزون الحالية</span><b>{money(inv.value)}</b></div>
        <div><span>مشتريات الفترة</span><b>{money(inv.purchases)}</b></div>
        <div><span>تكلفة المبيعات</span><b>{money(d.kpis.cogs)}</b></div>
        <div><span>الهدر</span><b className={d.kpis.waste > 0 ? 'text-warn' : ''}>{money(d.kpis.waste)}</b></div>
      </div>
      <Card title="الهدر حسب السبب"><HBars rows={inv.waste_by_reason.map((w) => ({ label: w.reason, sub: `${w.n} حركة`, value: w.value }))} fmt={money} empty="لا هدر في هذه الفترة — ممتاز" /></Card>
      <Card title="أكثر المواد هدراً"><HBars rows={inv.waste_top.map((w) => ({ label: w.name, sub: `${+w.qty.toFixed(2)} ${w.unit}`, value: w.value }))} fmt={money} empty="لا هدر" /></Card>
      <Card title="مواد تحت الحد الأدنى" wide>
        {!inv.low.length ? <p className="rp-empty">المخزون جيد</p> : <ul className="rp-list">{inv.low.map((i) => <li key={i.id}><span><b>{i.name}</b></span><b className="text-err">{+i.stock.toFixed(2)} / {i.min_stock} {i.unit}</b></li>)}</ul>}
      </Card>
    </div>
  );
}

function People({ d, money }) {
  const c = d.customers;
  return (
    <div className="rp-grid">
      <div className="rp-minis wide">
        <div><span>عملاء مسجَّلون بطلبات</span><b>{c.unique}</b></div>
        <div><span>عملاء جدد</span><b>{c.new}</b></div>
        <div><span>عملاء عادوا أكثر من مرة</span><b>{c.repeat}</b></div>
        <div><span>طلبات بعميل مسجَّل</span><b>{c.with_customer}</b><small>{Math.round(pctOf(c.with_customer, d.kpis.orders))}% من الطلبات</small></div>
      </div>
      <Card title="أفضل العملاء" wide>
        {!c.top.length ? <p className="rp-empty">لا عملاء مسجَّلون في هذه الفترة</p> : (
          <div className="table-wrap"><table className="data"><thead><tr><th>العميل</th><th>الجوال</th><th>الطلبات</th><th>الإنفاق</th></tr></thead>
            <tbody>{c.top.map((x) => <tr key={x.id}><td><strong>{x.name || '—'}</strong></td><td dir="ltr">{x.phone}</td><td>{x.orders}</td><td className="num">{money(x.total)}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title="الفعاليات" sub="مبيعات الطلبات المرتبطة بفعاليات المؤسسات" wide>
        {!d.by_event.length ? <p className="rp-empty">لا طلبات فعاليات في هذه الفترة</p> : <HBars rows={d.by_event.map((e) => ({ label: e.name, sub: `${e.orders} طلب`, value: e.total }))} fmt={money} />}
      </Card>
    </div>
  );
}

function exportCsv(d, from, to) {
  const k = d.kpis;
  downloadCsv(`تقرير-${from}-${to}.csv`, [
    ['المؤشرات', ['المؤشر', 'الحالية', 'السابقة'], [['المبيعات', 'sales'], ['الطلبات', 'orders'], ['متوسط الفاتورة', 'avg_ticket'], ['صافي المبيعات', 'net_sales'], ['الضريبة', 'tax'], ['الخصومات', 'discounts'], ['تكلفة المبيعات', 'cogs'], ['مجمل الربح', 'gross_profit'], ['الهدر', 'waste'], ['المصروفات', 'expenses'], ['صافي الربح', 'net_profit']].map(([l, key]) => [l, k[key], d.prev_kpis[key]])],
    ['المبيعات اليومية', ['اليوم', 'الطلبات', 'المبيعات'], d.series.map((s) => [s.day, s.orders, s.total])],
    ['الأصناف', ['الصنف', 'الفئة', 'الكمية', 'المبيعات'], d.items.map((i) => [i.name, i.category, i.qty, i.total])],
    ['الموظفون', ['الموظف', 'الطلبات', 'المبيعات', 'الخصومات'], d.staff.map((s) => [s.name, s.orders, s.total, s.discounts])],
    ['طرق الدفع', ['الطريقة', 'العمليات', 'الإجمالي'], d.by_payment.map((p) => [PAY_METHODS[p.method] || p.method, p.n, p.total])],
    ['المصروفات', ['النوع', 'الإجمالي'], d.expenses.by_category.map((c) => [c.name, c.total])],
  ]);
}
