import { useMemo, useState } from 'react';
import {
  Plus, Download, Printer, Search, Pencil, Trash2, Building, Users, Zap, Droplets, Flame, ShoppingBasket, Wrench, Megaphone, Truck, SprayCan, FileBadge, Wifi, Package, Receipt,
  Coffee, Car, Shield, Landmark, TrendingUp, TrendingDown, Banknote, CreditCard, Wallet, Repeat, CalendarCheck, Tags, BookOpen, Store, CircleCheckBig, Info,
} from 'lucide-react';
import { api } from '../api.js';
import { useApp, useData, useAction, useMoney, has, Modal, Field, Empty, Loading, PageHead, todayStr, PAY_METHODS } from '../lib.jsx';
import { AnimatedMoney } from '../components/TableHero.jsx';

export const EXP_ICONS = { building: Building, users: Users, zap: Zap, droplets: Droplets, flame: Flame, basket: ShoppingBasket, wrench: Wrench, megaphone: Megaphone, truck: Truck, spray: SprayCan, badge: FileBadge, wifi: Wifi, package: Package, receipt: Receipt, coffee: Coffee, car: Car, shield: Shield, landmark: Landmark };
const KIND = { operating: ['تشغيلي', 'يدخل في أرباح الفترة'], cogs: ['مشتريات مواد', 'محتسب أصلاً في تكلفة المبيعات'], capital: ['رأسمالي', 'معدات وأصول لا تُحمَّل على الفترة'] };
const METHOD = { cash: ['نقداً', Banknote], bank: ['بنك', Landmark], card: ['بطاقة', CreditCard], wallet: ['محفظة', Wallet] };
const SWATCH = ['#7c3aed', '#0369a1', '#f59e0b', '#06b6d4', '#ea580c', '#16a34a', '#64748b', '#db2777', '#0d9488', '#84cc16', '#4338ca', '#2563eb', '#9333ea', '#78716c', '#dc2626', '#0b6b3a'];
const ymd = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const RANGES = [['today', 'اليوم'], ['week', '7 أيام'], ['month', 'هذا الشهر'], ['last', 'الشهر الماضي'], ['year', 'السنة'], ['custom', 'فترة']];
function rangeOf(k, a, b) {
  const n = new Date(); const t = ymd(n);
  if (k === 'today') return [t, t];
  if (k === 'week') { const d = new Date(n); d.setDate(d.getDate() - 6); return [ymd(d), t]; }
  if (k === 'month') return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), t];
  if (k === 'last') return [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))];
  if (k === 'year') return [`${n.getFullYear()}-01-01`, t];
  return [a, b];
}
function CatChip({ name, color, icon }) {
  const I = EXP_ICONS[icon] || Receipt;
  return <span className="xp-chip" style={{ '--c': color }}><I size={13} aria-hidden /> {name}</span>;
}

/** المصاريف: دفتر محاسبة — قيود، أنواع، مصاريف ثابتة، وملخص الربح */
export default function Expenses() {
  const money = useMoney();
  const { user } = useApp();
  const manage = has(user, 'expenses.manage');
  const [tab, setTab] = useState('ledger');
  const [rk, setRk] = useState('month');
  const [cf, setCf] = useState(todayStr());
  const [ct, setCt] = useState(todayStr());
  const [cat, setCat] = useState('');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [from, to] = rangeOf(rk, cf, ct);

  const meta = useData('/expenses/meta?all=1', ['shift'], []);
  const qs = new URLSearchParams({ from, to, ...(cat ? { category_id: cat } : {}), ...(method ? { method } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const list = useData(`/expenses?${qs}`, [], [qs.toString()]);
  const sum = useData(manage ? `/expenses/summary?from=${from}&to=${to}` : null, [], [from, to]);
  const reload = () => { list.reload(); sum.reload?.(); meta.reload(); };

  const catById = useMemo(() => Object.fromEntries((meta.data?.categories || []).map((c) => [c.id, c])), [meta.data]);
  const csv = () => {
    const rows = [['التاريخ', 'النوع', 'البيان', 'المورد', 'الدفع', 'الضريبة', 'المبلغ', 'المرجع', 'سجّله']];
    (list.data?.rows || []).forEach((e) => rows.push([e.expense_date, e.category_name, e.description || '', e.vendor || '', METHOD[e.method][0] + (e.from_drawer ? ' (من الدرج)' : ''), e.tax, e.amount, e.reference || '', e.user_name || '']));
    const body = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
    a.download = `expenses-${from}_${to}.csv`; a.click();
  };

  return (
    <div className="xp">
      <PageHead title="المصاريف" sub={manage ? 'دفتر المحاسبة: سجّل المصاريف وتابع أين يذهب المال' : 'سجّل المصاريف التي دفعتها (تظهر لك مصاريفك فقط)'}>
        <button className="btn btn-primary btn-lg" onClick={() => setEdit({})}><Plus size={18} /> تسجيل مصروف</button>
      </PageHead>

      {manage && (
        <div className="xp-tabs" role="tablist">
          {[['ledger', BookOpen, 'الدفتر'], ['cats', Tags, 'الأنواع'], ['recurring', Repeat, 'الثابتة']].map(([k, I, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><I size={16} aria-hidden /> {l}</button>
          ))}
        </div>
      )}

      {tab === 'ledger' && (
        <>
          <div className="xp-filters">
            <div className="seg" role="tablist" aria-label="الفترة">{RANGES.map(([k, v]) => <button key={k} role="tab" aria-selected={rk === k} className={rk === k ? 'active' : ''} onClick={() => setRk(k)}>{v}</button>)}</div>
            {rk === 'custom' && <span className="xp-dates"><input type="date" value={cf} max={ct} onChange={(e) => setCf(e.target.value)} aria-label="من" /><input type="date" value={ct} min={cf} onChange={(e) => setCt(e.target.value)} aria-label="إلى" /></span>}
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="النوع"><option value="">كل الأنواع</option>{(meta.data?.categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="طريقة الدفع"><option value="">كل طرق الدفع</option>{Object.entries(METHOD).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</select>
            <label className="search-field"><Search size={16} aria-hidden /><input type="search" placeholder="مورد، بيان، رقم فاتورة" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" /></label>
          </div>

          {manage && sum.data && <Summary s={sum.data} money={money} cat={cat} setCat={setCat} />}

          <section className="xp-ledger" aria-label="دفتر المصاريف">
            <header>
              <h2>القيود <small>{list.data?.rows.length ?? 0}</small></h2>
              <div className="xp-ledger-actions"><button className="btn btn-sm" onClick={csv} disabled={!list.data?.rows.length}><Download size={15} /> تصدير CSV</button><button className="btn btn-sm" onClick={() => window.print()}><Printer size={15} /> طباعة</button></div>
            </header>
            {list.loading && !list.data ? <Loading /> : !list.data?.rows.length ? <Empty icon={BookOpen} text="لا توجد مصاريف في هذه الفترة. اضغط «تسجيل مصروف» لإضافة أول قيد." /> : (
              <div className="table-wrap">
                <table className="data xp-table">
                  <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>الدفع</th><th>المبلغ</th><th>سجّله</th></tr></thead>
                  <tbody>
                    {list.data.rows.map((e) => (
                      <tr key={e.id} className={manage ? 'xp-row' : ''} onClick={() => manage && setEdit(e)} tabIndex={manage ? 0 : undefined} onKeyDown={(ev) => ev.key === 'Enter' && manage && setEdit(e)}>
                        <td className="nowrap" dir="ltr">{e.expense_date}</td>
                        <td><CatChip name={e.category_name} color={e.color} icon={e.icon} /></td>
                        <td><strong>{e.vendor || e.description || '—'}</strong>{e.vendor && e.description && <small>{e.description}</small>}{e.reference && <small dir="ltr">#{e.reference}</small>}</td>
                        <td className="nowrap">{METHOD[e.method][0]}{e.from_drawer ? <span className="badge badge-warn" title="خُصم من درج الكاشير">من الدرج</span> : null}{e.recurring_id ? <span className="badge" title="مصروف ثابت"><Repeat size={11} aria-hidden /></span> : null}</td>
                        <td className="xp-amt">{money(e.amount)}{e.tax > 0 && <small>منها ضريبة {money(e.tax)}</small>}</td>
                        <td className="muted small">{e.user_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><th colSpan={4}>الإجمالي</th><th className="xp-amt">{money(list.data.total)}</th><th /></tr></tfoot>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {tab === 'cats' && manage && <Categories cats={meta.data?.categories || []} money={money} onChanged={reload} />}
      {tab === 'recurring' && manage && <Recurring cats={(meta.data?.categories || []).filter((c) => c.active)} money={money} onChanged={reload} />}
      {edit && meta.data && <ExpenseForm meta={meta.data} initial={edit} onClose={() => setEdit(null)} onSaved={(close) => { if (close !== false) setEdit(null); reload(); }} />}
    </div>
  );
}

/** ملخص الفترة: الإجمالي، من أين يأتي، وماذا بقي من المبيعات */
function Summary({ s, money, cat, setCat }) {
  const total = s.total || 0;
  const p = s.profit;
  const ref = Math.max(p.net_sales, p.cogs + p.operating, 1);
  const bar = (v) => `${Math.min(100, Math.max(0, (Math.abs(v) / ref) * 100))}%`;
  const maxDay = Math.max(1, ...s.byDay.map((d) => d.total));
  return (
    <div className="xp-sum">
      <section className="xp-hero">
        <span>إجمالي المصاريف</span>
        <strong><AnimatedMoney value={total} /></strong>
        {s.change_pct != null && <em className={s.change_pct > 0 ? 'up' : 'down'}>{s.change_pct > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {Math.abs(s.change_pct)}% {s.change_pct > 0 ? 'أعلى' : 'أقل'} من الفترة السابقة</em>}
        <small>{s.count} قيد · متوسط {money(s.avg_per_day)} يومياً{s.tax_recoverable > 0 ? ` · ضريبة قابلة للاسترداد ${money(s.tax_recoverable)}` : ''}</small>
        {s.drawer_cash > 0 && <small><Banknote size={12} aria-hidden /> خرج من درج الكاشير {money(s.drawer_cash)}</small>}
      </section>

      <section className="xp-profit" aria-label="أين تذهب المبيعات">
        <h2>أين تذهب المبيعات؟ <small>تقديري</small></h2>
        <div className="xp-prow"><span>صافي المبيعات</span><i style={{ width: bar(p.net_sales) }} className="sales" /><b>{money(p.net_sales)}</b></div>
        <div className="xp-prow"><span>تكلفة المواد المباعة</span><i style={{ width: bar(p.cogs) }} className="cogs" /><b>− {money(p.cogs)}</b></div>
        <div className="xp-prow"><span>مصاريف التشغيل</span><i style={{ width: bar(p.operating) }} className="opex" /><b>− {money(p.operating)}</b></div>
        <div className={`xp-prow net ${p.net < 0 ? 'neg' : ''}`}><span>صافي الربح</span><i style={{ width: bar(p.net) }} className="net" /><b>{money(p.net)}</b></div>
        {(p.purchases > 0 || p.capital > 0) && <p className="xp-note"><Info size={12} aria-hidden /> لا تُحسب هنا: مشتريات المواد {money(p.purchases)} (داخلة في تكلفة المواد المباعة){p.capital > 0 ? ` ومعدات ${money(p.capital)}` : ''}.</p>}
      </section>

      <section className="xp-cats" aria-label="حسب النوع">
        <h2>حسب النوع</h2>
        {!s.byCategory.length ? <p className="muted small">لا مصاريف في هذه الفترة.</p> : s.byCategory.map((c) => {
          const I = EXP_ICONS[c.icon] || Receipt;
          return (
            <button key={c.id} className={`xp-cat ${String(cat) === String(c.id) ? 'on' : ''}`} style={{ '--c': c.color }} onClick={() => setCat(String(cat) === String(c.id) ? '' : String(c.id))} aria-pressed={String(cat) === String(c.id)}>
              <span className="xp-cat-ico"><I size={16} aria-hidden /></span>
              <span className="xp-cat-name">{c.name}<small>{c.n} قيد</small></span>
              <span className="xp-cat-bar"><i style={{ width: `${(c.total / total) * 100}%` }} /></span>
              <span className="xp-cat-v"><b>{money(c.total)}</b><small>{Math.round((c.total / total) * 100)}%</small></span>
            </button>
          );
        })}
      </section>

      <section className="xp-side">
        <div className="xp-mini">
          <h2>يومياً</h2>
          <div className="xp-days">{s.byDay.slice(-24).map((d) => <span key={d.day} title={`${d.day}: ${money(d.total)}`} style={{ height: `${Math.max(6, (d.total / maxDay) * 100)}%` }} />)}</div>
        </div>
        <div className="xp-mini">
          <h2>طريقة الدفع</h2>
          {s.byMethod.map((m) => { const [l, I] = METHOD[m.method]; return <div key={m.method} className="xp-meth"><I size={14} aria-hidden /> {l}<b>{money(m.total)}</b></div>; })}
        </div>
        {s.topVendors.length > 0 && (
          <div className="xp-mini">
            <h2>أكثر الموردين</h2>
            {s.topVendors.map((v) => <div key={v.vendor} className="xp-meth"><Store size={14} aria-hidden /> {v.vendor}<b>{money(v.total)}</b></div>)}
          </div>
        )}
      </section>
    </div>
  );
}

function ExpenseForm({ meta, initial, onClose, onSaved }) {
  const money = useMoney();
  const [run, busy] = useAction();
  const cats = meta.categories.filter((c) => c.active || c.id === initial.category_id);
  const [f, setF] = useState(() => ({
    category_id: initial.category_id || '', amount: initial.amount ? String(initial.amount) : '', expense_date: initial.expense_date || todayStr(), method: initial.method || 'cash',
    from_drawer: !!initial.from_drawer, vendor: initial.vendor || '', description: initial.description || '', reference: initial.reference || '', tax: initial.tax ? String(initial.tax) : '', hasTax: initial.tax > 0,
  }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [err, setErr] = useState('');
  const body = () => ({ ...f, amount: Number(f.amount), tax: f.hasTax ? Number(f.tax) || 0 : 0, from_drawer: f.method === 'cash' && f.from_drawer });
  const save = async (again) => {
    setErr('');
    if (!f.category_id) return setErr('اختر نوع المصروف');
    if (!(Number(f.amount) > 0)) return setErr('أدخل المبلغ');
    const ok = await run(() => (initial.id ? api(`/expenses/${initial.id}`, { method: 'PUT', body: body() }) : api('/expenses', { method: 'POST', body: body() })), 'تم تسجيل المصروف');
    if (!ok) return;
    if (again) { setF((x) => ({ ...x, amount: '', description: '', reference: '', tax: '', hasTax: false })); onSaved(false); } else onSaved(true);
  };
  const del = async () => { if (window.confirm('حذف هذا المصروف نهائياً؟') && await run(() => api(`/expenses/${initial.id}`, { method: 'DELETE' }), 'تم الحذف')) onSaved(true); };
  const sel = meta.categories.find((c) => c.id === Number(f.category_id));

  return (
    <Modal title={initial.id ? 'تعديل مصروف' : 'تسجيل مصروف'} onClose={onClose} wide footer={
      <>
        {initial.id && meta.manage && <button className="btn btn-danger-ghost" onClick={del}><Trash2 size={16} /> حذف</button>}
        {!initial.id && <button className="btn" onClick={() => save(true)} disabled={busy}>حفظ وإضافة آخر</button>}
        <button className="btn btn-primary btn-lg" onClick={() => save(false)} disabled={busy}>حفظ</button>
      </>
    }>
      <div className="xp-form">
        <div className="xp-amount">
          <span>المبلغ</span>
          <input inputMode="decimal" autoFocus value={f.amount} onChange={(e) => set('amount', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" aria-label="المبلغ" />
          {Number(f.amount) > 0 && <small>{money(Number(f.amount))}</small>}
        </div>

        <div>
          <h4>النوع</h4>
          <div className="xp-tiles" role="radiogroup" aria-label="نوع المصروف">
            {cats.map((c) => { const I = EXP_ICONS[c.icon] || Receipt; return (
              <button key={c.id} role="radio" aria-checked={Number(f.category_id) === c.id} className={`xp-tile ${Number(f.category_id) === c.id ? 'on' : ''}`} style={{ '--c': c.color }} onClick={() => set('category_id', c.id)}><I size={20} aria-hidden /><span>{c.name}</span></button>
            ); })}
          </div>
          {sel && <p className="xp-kind">{KIND[sel.kind][0]} · {KIND[sel.kind][1]}</p>}
        </div>

        <div>
          <h4>طريقة الدفع</h4>
          <div className="xp-methods" role="radiogroup" aria-label="طريقة الدفع">
            {Object.entries(METHOD).map(([k, [l, I]]) => <button key={k} role="radio" aria-checked={f.method === k} className={`xp-method ${f.method === k ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, method: k, from_drawer: k === 'cash' ? x.from_drawer : false }))}><I size={17} aria-hidden /> {l}</button>)}
          </div>
          {f.method === 'cash' && (
            <label className={`switch xp-drawer ${f.from_drawer ? 'on' : ''}`}>
              <input type="checkbox" checked={f.from_drawer} disabled={!meta.shift_open && !f.from_drawer} onChange={(e) => set('from_drawer', e.target.checked)} />
              دُفع من درج الكاشير (يُخصم من النقد المتوقع في الوردية){!meta.shift_open && !f.from_drawer ? ' — لا توجد وردية مفتوحة' : ''}
            </label>
          )}
        </div>

        <div className="grid-2">
          <Field label="التاريخ"><input type="date" value={f.expense_date} onChange={(e) => set('expense_date', e.target.value)} /></Field>
          <Field label="المورد / المستفيد">
            <input list="xp-vendors" value={f.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="مثال: شركة الكهرباء" />
            <datalist id="xp-vendors">{meta.vendors.map((v) => <option key={v} value={v} />)}</datalist>
          </Field>
          <Field label="البيان"><input value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="ماذا دفعت؟" /></Field>
          <Field label="رقم الفاتورة / السند"><input dir="ltr" value={f.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
        </div>
        <label className="switch"><input type="checkbox" checked={f.hasTax} onChange={(e) => set('hasTax', e.target.checked)} /> المبلغ يتضمن ضريبة قيمة مضافة (قابلة للاسترداد)</label>
        {f.hasTax && <Field label="قيمة الضريبة ضمن المبلغ"><input inputMode="decimal" value={f.tax} onChange={(e) => set('tax', e.target.value.replace(/[^0-9.]/g, ''))} /></Field>}
        {err && <div className="alert alert-err">{err}</div>}
      </div>
    </Modal>
  );
}

function Categories({ cats, money, onChanged }) {
  const [edit, setEdit] = useState(null);
  return (
    <section className="xp-catpage">
      <div className="xp-sec-head"><h2>أنواع المصاريف</h2><button className="btn btn-primary btn-sm" onClick={() => setEdit({})}><Plus size={15} /> نوع جديد</button></div>
      <div className="xp-catgrid">
        {cats.map((c) => { const I = EXP_ICONS[c.icon] || Receipt; return (
          <button key={c.id} className={`xp-catcard ${c.active ? '' : 'off'}`} style={{ '--c': c.color }} onClick={() => setEdit(c)}>
            <span className="xp-cat-ico"><I size={20} aria-hidden /></span>
            <strong>{c.name}</strong>
            <small>{KIND[c.kind][0]} · {c.uses} قيد{c.active ? '' : ' · مخفي'}</small>
          </button>
        ); })}
      </div>
      {edit && <CategoryForm initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged(); }} />}
    </section>
  );
}

function CategoryForm({ initial, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ name: '', kind: 'operating', color: SWATCH[0], icon: 'receipt', active: true, ...initial, active: initial.id ? !!initial.active : true });
  const save = async () => { if (await run(() => (initial.id ? api(`/expense-categories/${initial.id}`, { method: 'PUT', body: f }) : api('/expense-categories', { method: 'POST', body: f })), 'تم الحفظ')) onSaved(); };
  const del = async () => {
    if (!window.confirm('حذف هذا النوع؟ إن كانت عليه قيود فسيُخفى فقط.')) return;
    if (await run(() => api(`/expense-categories/${initial.id}`, { method: 'DELETE' }), 'تم')) onSaved();
  };
  return (
    <Modal title={initial.id ? 'تعديل نوع' : 'نوع مصروف جديد'} onClose={onClose} footer={<>{initial.id && <button className="btn btn-danger-ghost" onClick={del}><Trash2 size={16} /> حذف</button>}<button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button></>}>
      <div className="xp-form">
        <Field label="الاسم *"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="كيف يُحاسَب؟" hint={KIND[f.kind][1]}>
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <div><h4>اللون</h4><div className="xp-swatches">{SWATCH.map((c) => <button key={c} className={f.color === c ? 'on' : ''} style={{ background: c }} onClick={() => setF({ ...f, color: c })} aria-label={c} />)}</div></div>
        <div><h4>الأيقونة</h4><div className="xp-icons">{Object.entries(EXP_ICONS).map(([k, I]) => <button key={k} className={f.icon === k ? 'on' : ''} style={{ '--c': f.color }} onClick={() => setF({ ...f, icon: k })} aria-label={k}><I size={18} /></button>)}</div></div>
        {initial.id && <label className="switch"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> نشط (يظهر عند تسجيل المصاريف)</label>}
      </div>
    </Modal>
  );
}

function Recurring({ cats, money, onChanged }) {
  const { data, reload } = useData('/expenses/recurring', [], []);
  const [run, busy] = useAction();
  const [edit, setEdit] = useState(null);
  const gen = async () => { const r = await run(() => api('/expenses/recurring/run', { method: 'POST', body: {} })); if (r) { window.alert(r.created ? `أُنشئ ${r.created} قيد بإجمالي ${money(r.total)}` : 'كل مصاريف هذا الشهر مسجلة مسبقاً'); reload(); onChanged(); } };
  return (
    <section className="xp-catpage">
      <div className="xp-sec-head">
        <div><h2>المصاريف الثابتة</h2><p className="muted small">الإيجار والاشتراكات والرواتب… سجّلها مرة واحدة ثم أنشئ قيود الشهر بضغطة.</p></div>
        <div className="btn-row"><button className="btn" onClick={gen} disabled={busy}><CalendarCheck size={16} /> إنشاء قيود هذا الشهر</button><button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} /> مصروف ثابت</button></div>
      </div>
      {!data?.length ? <Empty icon={Repeat} text="لا توجد مصاريف ثابتة بعد" /> : (
        <ul className="xp-rec">
          {data.map((t) => (
            <li key={t.id} className={t.active ? '' : 'off'}>
              <button onClick={() => setEdit(t)}>
                <CatChip name={t.category_name} color={t.color} icon={t.icon} />
                <strong>{t.name}</strong>
                <span className="muted small">يوم {t.day_of_month} من كل شهر · {METHOD[t.method][0]}</span>
                <b>{money(t.amount)}</b>
                {t.done_this_month > 0 ? <span className="badge badge-ok"><CircleCheckBig size={11} aria-hidden /> سُجّل هذا الشهر</span> : t.active ? <span className="badge badge-warn">لم يُسجَّل</span> : <span className="badge">موقوف</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit && <RecurringForm cats={cats} initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </section>
  );
}

function RecurringForm({ cats, initial, onClose, onSaved }) {
  const [run, busy] = useAction();
  const [f, setF] = useState({ name: '', category_id: '', amount: '', method: 'bank', vendor: '', day_of_month: 1, active: true, ...initial, active: initial.id ? !!initial.active : true });
  const save = async () => { if (await run(() => (initial.id ? api(`/expenses/recurring/${initial.id}`, { method: 'PUT', body: f }) : api('/expenses/recurring', { method: 'POST', body: f })), 'تم الحفظ')) onSaved(); };
  const del = async () => { if (window.confirm('حذف هذا المصروف الثابت؟ لن تُحذف القيود السابقة.') && await run(() => api(`/expenses/recurring/${initial.id}`, { method: 'DELETE' }), 'تم الحذف')) onSaved(); };
  return (
    <Modal title={initial.id ? 'تعديل مصروف ثابت' : 'مصروف ثابت جديد'} onClose={onClose} footer={<>{initial.id && <button className="btn btn-danger-ghost" onClick={del}><Trash2 size={16} /> حذف</button>}<button className="btn btn-primary" onClick={save} disabled={busy}>حفظ</button></>}>
      <div className="xp-form">
        <Field label="الاسم *"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثال: إيجار المحل" autoFocus /></Field>
        <div className="grid-2">
          <Field label="النوع *"><select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">اختر</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="المبلغ *"><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
          <Field label="يوم الشهر"><input type="number" min="1" max="28" value={f.day_of_month} onChange={(e) => setF({ ...f, day_of_month: e.target.value })} /></Field>
          <Field label="طريقة الدفع"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <Field label="المورد / المستفيد"><input value={f.vendor || ''} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></Field>
        {initial.id && <label className="switch"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> نشط</label>}
      </div>
    </Modal>
  );
}
