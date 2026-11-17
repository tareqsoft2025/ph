import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  UtensilsCrossed, Search, Plus, Minus, Armchair, QrCode, X, Send, CircleCheckBig, ChefHat, BellRing, HandPlatter, Clock, SlidersHorizontal, Ban, Phone, UserRound, MapPin, Receipt,
} from 'lucide-react';
import { api } from '../api.js';

const safe = (f, d = null) => { try { return f(); } catch { return d; } };
const lastKey = (t) => `ph-online-last-${String(t).slice(0, 10)}`;
const fmt = (n, cur) => `${(Math.round(Number(n) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${cur || ''}`.trim();
const STEPS = [['new', 'تم الاستلام', Receipt], ['preparing', 'قيد التحضير', ChefHat], ['ready', 'جاهز', BellRing], ['served', 'تم التقديم', HandPlatter]];
const stage = (items) => {
  if (!items.length) return 0;
  if (items.every((i) => i.status === 'served')) return 3;
  if (items.every((i) => ['ready', 'served'].includes(i.status))) return 2;
  if (items.some((i) => ['preparing', 'ready', 'served'].includes(i.status))) return 1;
  return 0;
};

/** صفحة الطلب العامة للزبون (بلا تسجيل دخول): عرض المنيو وإرسال الطلب للمطبخ */
export default function CustomerOrder() {
  const { token: tableToken } = useParams();
  const [cfg, setCfg] = useState(null);
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [picking, setPicking] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => ({ name: safe(() => localStorage.getItem('ph-co-name'), '') || '', phone: safe(() => localStorage.getItem('ph-co-phone'), '') || '', guests: 2, notes: '' }));
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [done, setDone] = useState(() => safe(() => JSON.parse(localStorage.getItem(lastKey(tableToken)) || 'null')));

  useEffect(() => {
    api(`/public/table/${tableToken}`).then((c) => {
      setCfg(c);
      if (!c.enabled) return;
      api(`/public/table/${tableToken}/menu`).then((m) => { setMenu(m); setCat(m.categories[0]?.id ?? 0); }).catch((e) => setError(e.message));
    }).catch((e) => setError(e.message));
  }, [tableToken]);

  const cur = cfg?.currency;
  const items = useMemo(() => {
    if (!menu) return [];
    const s = q.trim();
    return menu.items.filter((i) => (s ? i.name.includes(s) : i.category_id === cat));
  }, [menu, cat, q]);
  const count = cart.reduce((a, l) => a + l.qty, 0);
  const sub = cart.reduce((a, l) => a + l.unit * l.qty, 0);

  const add = (item, { mods = [], qty = 1, notes = '' } = {}) => {
    const unit = item.price + mods.reduce((a, m) => a + m.price, 0);
    const key = `${item.id}|${mods.map((m) => m.id).sort().join(',')}|${notes}`;
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      return ex ? c.map((l) => (l === ex ? { ...l, qty: l.qty + qty } : l)) : [...c, { key, item_id: item.id, name: item.name, unit, qty, mods, notes }];
    });
  };
  const click = (item) => { if (!item.available) return; if (item.modifiers.length) setPicking(item); else add(item); };
  const inCart = (id) => cart.filter((l) => l.item_id === id).reduce((a, l) => a + l.qty, 0);
  const dec = (id) => setCart((c) => { const i = c.findLastIndex((l) => l.item_id === id); if (i < 0) return c; return c[i].qty <= 1 ? c.filter((_, k) => k !== i) : c.map((l, k) => (k === i ? { ...l, qty: l.qty - 1 } : l)); });
  const setQty = (key, d) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));

  async function submit() {
    setFormErr('');
    const name = form.name.trim(); const phone = form.phone.trim();
    if (!adding) {
      if (!name) return setFormErr('أدخل اسمك');
      if (!/^\+?[0-9\s-]{7,15}$/.test(phone)) return setFormErr('أدخل رقم جوال صحيح');
    }
    setBusy(true);
    try {
      const r = await api(`/public/table/${tableToken}/orders`, { method: 'POST', body: {
        guests: Number(form.guests) || 1, customer_name: name, customer_phone: phone, notes: form.notes,
        order_token: adding ? done?.token : undefined,
        items: cart.map((l) => ({ item_id: l.item_id, qty: l.qty, modifier_ids: l.mods.map((m) => m.id), notes: l.notes })),
      } });
      safe(() => { localStorage.setItem('ph-co-name', name); localStorage.setItem('ph-co-phone', phone); localStorage.setItem(lastKey(tableToken), JSON.stringify({ code: r.code, token: r.token })); });
      setCart([]); setSheet(false); setAdding(false); setDone({ code: r.code, token: r.token });
      api(`/public/table/${tableToken}`).then(setCfg).catch(() => {});
    } catch (e) { setFormErr(e.message); } finally { setBusy(false); }
  }

  if (error && !cfg) return <Shell cfg={cfg}><div className="co-state"><QrCode size={44} aria-hidden /><h2>رمز الطاولة غير صالح</h2><p>امسح رمز QR الموجود على طاولتك، أو اطلب المساعدة من النادل.</p></div></Shell>;
  if (!cfg) return <Shell cfg={cfg}><div className="co-state"><p className="muted">جارِ التحميل…</p></div></Shell>;
  if (!cfg.enabled) return <Shell cfg={cfg}><div className="co-state"><Ban size={44} aria-hidden /><h2>الطلب عبر QR متوقف حالياً</h2><p>نادِ النادل لتقديم طلبك.</p></div></Shell>;
  const mine = done && cfg.table.busy && done.code === cfg.open_code;
  if (mine && !adding) return <Shell cfg={cfg}><Tracker order={done} cur={cur} phone={cfg.phone} onAdd={() => setAdding(true)} onClosed={() => { safe(() => localStorage.removeItem(lastKey(tableToken))); setDone(null); setCfg({ ...cfg, table: { ...cfg.table, busy: false } }); }} /></Shell>;
  if (cfg.table.busy && !mine) return <Shell cfg={cfg}><div className="co-state"><Armchair size={44} aria-hidden /><h2>{cfg.table.name} عليها طلب مفتوح</h2><p>لإضافة أصناف نادِ النادل.</p></div></Shell>;

  return (
    <Shell cfg={cfg}>
      <div className="co-tools">
        <label className="menu-search"><Search size={18} aria-hidden /><input type="search" placeholder="ابحث عن طبق…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" /></label>
      </div>
      {menu && (
        <nav className="cat-tabs co-cats" role="tablist" aria-label="الفئات">
          {menu.categories.map((c) => <button key={c.id} role="tab" aria-selected={!q && cat === c.id} className={`cat-tab ${!q && cat === c.id ? 'active' : ''}`} onClick={() => { setQ(''); setCat(c.id); }}>{c.name}</button>)}
        </nav>
      )}
      <main className="co-menu">
        {!menu ? <div className="co-state"><p className="muted">جارِ التحميل…</p></div> : (
          <div className="co-grid">
            {items.map((it) => {
              const n = inCart(it.id);
              const art = it.image || menu.categories.find((c) => c.id === it.category_id)?.icon || '';
              return (
                <article key={it.id} className={`co-dish ${it.available ? '' : 'off'} ${n ? 'in' : ''}`}>
                  <button className="co-dish-main" onClick={() => click(it)} disabled={!it.available} aria-label={`${it.name}، ${fmt(it.price, cur)}`}>
                    <span className="co-art" aria-hidden>{/^(https?:|data:)/.test(art) ? <img src={art} alt="" loading="lazy" /> : <span>{art || '🍽️'}</span>}</span>
                    <span className="co-info">
                      <strong>{it.name}</strong>
                      {it.description && <small>{it.description}</small>}
                      {it.modifiers.length > 0 && <em><SlidersHorizontal size={12} aria-hidden /> خيارات إضافية</em>}
                      <b>{fmt(it.price, cur)}</b>
                    </span>
                  </button>
                  {!it.available ? <span className="co-off">نفد اليوم</span> : n > 0 ? (
                    <span className="co-step"><button onClick={() => dec(it.id)} aria-label="إنقاص"><Minus size={15} /></button><span>{n}</span><button onClick={() => click(it)} aria-label="زيادة"><Plus size={15} /></button></span>
                  ) : <button className="co-add" onClick={() => click(it)} aria-label={`إضافة ${it.name}`}><Plus size={18} strokeWidth={2.6} /></button>}
                </article>
              );
            })}
            {!items.length && <div className="co-state"><p>لا توجد أطباق</p></div>}
          </div>
        )}
      </main>

      {count > 0 && <button className="co-bar" onClick={() => setSheet(true)}><span className="co-bar-n">{count}</span><span>عرض السلة وإرسال الطلب</span><strong>{fmt(sub, cur)}</strong></button>}

      {picking && <Picker item={picking} cur={cur} onClose={() => setPicking(null)} onAdd={(o) => { add(picking, o); setPicking(null); }} />}

      {sheet && (
        <div className="co-sheet-wrap" onClick={() => setSheet(false)}>
          <section className="co-sheet" role="dialog" aria-modal="true" aria-label="سلة الطلب" onClick={(e) => e.stopPropagation()}>
            <header><h2>طلبك</h2><button className="icon-btn" onClick={() => setSheet(false)} aria-label="إغلاق"><X size={20} /></button></header>
            <div className="co-sheet-body">
              <ul className="co-lines">
                {cart.map((l) => (
                  <li key={l.key}>
                    <span className="co-step"><button onClick={() => setQty(l.key, -1)} aria-label="إنقاص"><Minus size={14} /></button><span>{l.qty}</span><button onClick={() => setQty(l.key, 1)} aria-label="زيادة"><Plus size={14} /></button></span>
                    <span className="co-line-name">{l.name}{l.mods.length > 0 && <small>{l.mods.map((m) => m.name).join('، ')}</small>}{l.notes && <small>{l.notes}</small>}</span>
                    <b>{fmt(l.unit * l.qty, cur)}</b>
                  </li>
                ))}
              </ul>
              <div className="co-form">
                <p className="co-badge"><Armchair size={15} aria-hidden /> {cfg.table.name}{adding ? ' · إضافة على طلبك' : ''}</p>
                {!adding && <><label><span><UserRound size={14} aria-hidden /> الاسم *</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
                <label><span><Phone size={14} aria-hidden /> رقم الجوال *</span><input inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" /></label>
                <label><span>عدد الأشخاص</span><input type="number" min="1" max="30" value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} /></label></>}
                <label><span>ملاحظات للمطبخ</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="مثال: بدون بصل" /></label>
              </div>
              <div className="co-sum">
                <div><span>المجموع</span><span>{fmt(sub, cur)}</span></div>
                <small>تُضاف الضريبة (إن وجدت) عند الحساب النهائي.</small>
              </div>
              {formErr && <div className="alert alert-err">{formErr}</div>}
            </div>
            <footer><button className="btn btn-primary btn-lg btn-block" onClick={submit} disabled={busy}><Send size={19} /> {busy ? 'جارِ الإرسال…' : 'إرسال الطلب للمطبخ'}</button></footer>
          </section>
        </div>
      )}
    </Shell>
  );
}

function Shell({ cfg, children }) {
  return (
    <div className="co">
      <header className="co-head">
        <span className="brand-mark" aria-hidden><UtensilsCrossed size={20} strokeWidth={2.2} /></span>
        <div><strong>{cfg?.name || 'المطعم'}</strong><small>{cfg?.table ? `${cfg.table.name} · اطلب من هاتفك` : 'اطلب من هاتفك'}</small></div>
      </header>
      {children}
    </div>
  );
}

function Picker({ item, cur, onClose, onAdd }) {
  const [sel, setSel] = useState([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const unit = item.price + sel.reduce((a, m) => a + m.price, 0);
  const toggle = (m) => setSel((s) => (s.some((x) => x.id === m.id) ? s.filter((x) => x.id !== m.id) : [...s, m]));
  return (
    <div className="co-sheet-wrap" onClick={onClose}>
      <section className="co-sheet" role="dialog" aria-modal="true" aria-label={item.name} onClick={(e) => e.stopPropagation()}>
        <header><h2>{item.name}</h2><button className="icon-btn" onClick={onClose} aria-label="إغلاق"><X size={20} /></button></header>
        <div className="co-sheet-body">
          {item.description && <p className="muted">{item.description}</p>}
          <div className="mod-list">
            {item.modifiers.map((m) => (
              <label key={m.id} className={`mod ${sel.some((x) => x.id === m.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={sel.some((x) => x.id === m.id)} onChange={() => toggle(m)} />
                <span>{m.name}</span><span className="muted">{m.price ? `+${fmt(m.price, cur)}` : 'مجاناً'}</span>
              </label>
            ))}
          </div>
          <div className="co-form"><label><span>ملاحظات</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: بدون مايونيز" /></label></div>
        </div>
        <footer className="co-pick-foot">
          <span className="co-step lg"><button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="إنقاص"><Minus size={16} /></button><span>{qty}</span><button onClick={() => setQty(qty + 1)} aria-label="زيادة"><Plus size={16} /></button></span>
          <button className="btn btn-primary btn-lg" onClick={() => onAdd({ mods: sel, qty, notes: notes.trim() })}>إضافة · {fmt(unit * qty, cur)}</button>
        </footer>
      </section>
    </div>
  );
}

/** متابعة حالة الطلب للزبون */
function Tracker({ order, cur, phone, onAdd, onClosed }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const timer = useRef();
  useEffect(() => {
    let alive = true;
    const load = () => api(`/public/orders/${order.code}?t=${order.token}`)
      .then((d) => { if (alive) { setData(d); setErr(''); } })
      .catch((e) => { if (alive) setErr(e.message); });
    load();
    timer.current = setInterval(load, 6000);
    return () => { alive = false; clearInterval(timer.current); };
  }, [order.code, order.token]);
  const st = data ? stage(data.items) : 0;
  const closed = data && data.status !== 'open';
  return (
    <div className="co-track">
      <span className="co-check" aria-hidden><CircleCheckBig size={42} /></span>
      <h2>تم إرسال طلبك للمطبخ</h2>
      <p className="muted">رقم الطلب{data?.table_name ? ` · ${data.table_name}` : ''}</p>
      <p className="co-code" dir="ltr">{order.code}</p>
      {err && !data && <div className="alert alert-err">{err}</div>}
      {data && (
        <>
          {closed ? <div className="alert alert-warn">{data.status === 'paid' ? 'تم إغلاق الطلب. شكراً لزيارتكم!' : 'أُلغي هذا الطلب. تواصل مع المطعم للمساعدة.'}</div> : (
            <ol className="co-steps" aria-label="حالة الطلب">
              {STEPS.map(([k, label, I], i) => <li key={k} className={i < st ? 'done' : i === st ? 'cur' : ''}><span><I size={18} aria-hidden /></span><small>{label}</small></li>)}
            </ol>
          )}
          <ul className="co-lines flat">
            {data.items.map((i, k) => <li key={k}><b>{i.qty}×</b><span className="co-line-name">{i.name}</span><span className={`status status-${i.status}`}>{{ new: 'تم الاستلام', preparing: 'قيد التحضير', ready: 'جاهز', served: 'تم التقديم' }[i.status] || i.status}</span></li>)}
          </ul>
          <p className="co-total"><span>الإجمالي</span><strong>{fmt(data.total, cur)}</strong></p>
        </>
      )}
      <p className="muted small"><Clock size={13} aria-hidden /> تتحدث الحالة تلقائياً. احتفظ بهذه الصفحة مفتوحة.{phone ? <> للاستفسار <bdi dir="ltr">{phone}</bdi></> : null}</p>
      {closed ? <button className="btn btn-block" onClick={onClosed}>طلب جديد</button> : <button className="btn btn-primary btn-block" onClick={onAdd}><Plus size={17} /> إضافة أصناف لطلبي</button>}
    </div>
  );
}

/** الدخول بدون رمز طاولة */
export function NoQr() {
  return (
    <Shell cfg={null}>
      <div className="co-state"><QrCode size={44} aria-hidden /><h2>الطلب عبر رمز QR فقط</h2><p>امسح رمز QR الموجود على طاولتك لعرض المنيو وإرسال طلبك.</p></div>
    </Shell>
  );
}
