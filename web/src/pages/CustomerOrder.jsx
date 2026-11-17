import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  UtensilsCrossed, Search, Plus, Minus, Armchair, QrCode, X, Send, Banknote, Wallet, Landmark, Smartphone, Copy, Check, Building2, MapPin as PinIcon, Info, CircleCheckBig, ChefHat, BellRing, HandPlatter, Clock, SlidersHorizontal, Ban, Phone, UserRound, MapPin, Receipt,
} from 'lucide-react';
import { api, watchOrder } from '../api.js';
import { pushSupported, pushKey, enableOrderPush, isIOS, isStandalone } from '../webpush.js';

const safe = (f, d = null) => { try { return f(); } catch { return d; } };
const deviceId = () => { let d = safe(() => localStorage.getItem('ph-co-device')); if (!d) { d = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); safe(() => localStorage.setItem('ph-co-device', d)); } return d; };
const lastKey = (t) => `ph-online-last-${String(t).slice(0, 10)}`;
const when = (s) => String(s || '').replace('T', ' ').slice(0, 16);
const fmt = (n, cur) => `${(Math.round(Number(n) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${cur || ''}`.trim();
const STEPS = [['new', 'تم الاستلام', Receipt], ['preparing', 'قيد التحضير', ChefHat], ['ready', 'جاهز', BellRing], ['served', 'تم التقديم', HandPlatter]];
const BILL_LABEL = { cash: 'نقداً', wallet: 'محفظة', bank: 'بنك', jawwalpay: 'جوال بي' };
const BILL_METHODS = [['jawwalpay', 'جوال بي', Smartphone], ['wallet', 'محفظة', Wallet], ['bank', 'بنك', Landmark], ['cash', 'نقداً', Banknote]];
const stage = (items) => {
  if (!items.length) return 0;
  if (items.every((i) => i.status === 'served')) return 3;
  if (items.every((i) => ['ready', 'served'].includes(i.status))) return 2;
  if (items.some((i) => ['preparing', 'ready', 'served'].includes(i.status))) return 1;
  return 0;
};

/** صفحة الطلب العامة للزبون (بلا تسجيل دخول): عرض المنيو وإرسال الطلب للمطبخ */
export default function CustomerOrder({ kind = 'table' }) {
  const { token: tableToken } = useParams();
  const isEvent = kind === 'event';
  const base = isEvent ? `/public/event/${tableToken}` : `/public/table/${tableToken}`;
  const [cfg, setCfg] = useState(null);
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState('');
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [picking, setPicking] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [adding, setAdding] = useState(false);
  const [askedAt, setAskedAt] = useState(0);
  const [askErr, setAskErr] = useState('');
  const [, force] = useState(0);
  const [form, setForm] = useState(() => ({ name: safe(() => localStorage.getItem('ph-co-name'), '') || '', phone: safe(() => localStorage.getItem('ph-co-phone'), '') || '', guests: 2, notes: '', place: '' }));
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [done, setDone] = useState(() => safe(() => JSON.parse(localStorage.getItem(lastKey(tableToken)) || 'null')));

  useEffect(() => {
    api(isEvent ? base : `${base}?d=${deviceId()}`).then((raw) => {
      // طلب مؤسسة: نحوّل الرد إلى نفس شكل إعدادات الطاولة
      const c = isEvent ? { enabled: raw.enabled, name: raw.restaurant, currency: raw.currency, phone: raw.phone, event: raw.event, table: null, bill_allowed: raw.event.billing === 'individual' } : raw;
      setCfg(c);
      if (!c.enabled || (isEvent && c.event.state !== 'open')) return;
      api(`${base}/menu`).then((m) => { setMenu(m); setCat(m.categories[0]?.id ?? 0); }).catch((e) => setError(e.message));
    }).catch((e) => setError(e.message));
  }, [tableToken]); // eslint-disable-line

  // الطاولة لم تُفتح بعد: نعيد الفحص تلقائياً حتى يفتحها النادل
  const waitingOpen = !isEvent && !!cfg && cfg.enabled && !cfg.table.open && !cfg.table.busy;
  useEffect(() => {
    if (!waitingOpen) return undefined;
    const t = setInterval(() => api(`/public/table/${tableToken}`).then(setCfg).catch(() => {}), 6000);
    return () => clearInterval(t);
  }, [waitingOpen, tableToken]);

  const askOpen = async () => {
    setAskErr('');
    try { await api(`/public/table/${tableToken}/request-open`, { method: 'POST', body: { device_id: deviceId() } }); setAskedAt(Date.now()); setTimeout(() => force((n) => n + 1), 61000); }
    catch (e) { setAskErr(e.message); }
  };
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
      if (isEvent) {
        if (phone && !/^\+?[0-9\s-]{7,15}$/.test(phone)) return setFormErr('رقم الجوال غير صحيح');
        if (cfg.event.places.length && !form.place) return setFormErr('اختر مكانك');
      } else if (!/^\+?[0-9\s-]{7,15}$/.test(phone)) return setFormErr('أدخل رقم جوال صحيح');
    }
    if (isEvent && cfg.event.order_cap && sub > cfg.event.order_cap) return setFormErr(`تجاوزت سقف الطلب الواحد (${fmt(cfg.event.order_cap, cur)})`);
    setBusy(true);
    try {
      const r = await api(`${base}/orders`, { method: 'POST', body: {
        device_id: deviceId(), guests: Number(form.guests) || 1, customer_name: name, customer_phone: phone, notes: form.notes, place: form.place,
        order_token: adding ? done?.token : undefined,
        items: cart.map((l) => ({ item_id: l.item_id, qty: l.qty, modifier_ids: l.mods.map((m) => m.id), notes: l.notes })),
      } });
      safe(() => { localStorage.setItem('ph-co-name', name); localStorage.setItem('ph-co-phone', phone); localStorage.setItem(lastKey(tableToken), JSON.stringify({ code: r.code, token: r.token })); });
      setCart([]); setSheet(false); setAdding(false); setDone({ code: r.code, token: r.token });
      if (!isEvent) api(base).then(setCfg).catch(() => {});
    } catch (e) { setFormErr(e.message); } finally { setBusy(false); }
  }

  if (error && !cfg) return <Shell cfg={cfg}><div className="co-state"><QrCode size={44} aria-hidden /><h2>رمز الطاولة غير صالح</h2><p>امسح رمز QR الموجود على طاولتك، أو اطلب المساعدة من النادل.</p></div></Shell>;
  if (!cfg) return <Shell cfg={cfg}><div className="co-state"><p className="muted">جارِ التحميل…</p></div></Shell>;
  if (!cfg.enabled) return <Shell cfg={cfg}><div className="co-state"><Ban size={44} aria-hidden /><h2>الطلب عبر QR متوقف حالياً</h2><p>نادِ النادل لتقديم طلبك.</p></div></Shell>;
  if (isEvent && cfg.event.state !== 'open' && !done) {
    const st = cfg.event.state;
    return <Shell cfg={cfg}><div className="co-state"><Ban size={44} aria-hidden /><h2>{st === 'not_started' ? 'لم تبدأ الفعالية بعد' : st === 'ended' ? 'انتهت فترة الطلب' : 'الطلب متوقف مؤقتاً'}</h2><p>{st === 'not_started' ? `يبدأ الطلب ${when(cfg.event.starts_at)}` : st === 'ended' ? `انتهى الطلب ${when(cfg.event.ends_at)}` : 'تواصل مع المنظّم أو المطعم.'}</p></div></Shell>;
  }
  const mine = isEvent ? !!done : done && cfg.table.busy && done.code === cfg.open_code;
  if (done && !adding && (isEvent || mine || !cfg.table.busy)) return <Shell cfg={cfg}><Tracker order={done} cur={cur} phone={cfg.phone} billAllowed={!!cfg.bill_allowed} institution={isEvent && cfg.event.billing === 'institution'} onAdd={() => setAdding(true)} onClosed={() => { safe(() => localStorage.removeItem(lastKey(tableToken))); setDone(null); if (!isEvent) setCfg({ ...cfg, table: { ...cfg.table, busy: false } }); }} /></Shell>;
  if (waitingOpen) return <Shell cfg={cfg}><div className="co-state"><HandPlatter size={44} aria-hidden /><h2>أهلاً بك! {cfg.table.name}</h2><p>الطلب من هاتفك يبدأ عندما يفتح النادل الطاولة. ستظهر القائمة تلقائياً بمجرد فتحها.</p>{askedAt && Date.now() - askedAt < 60000 ? <div className="co-sent"><CircleCheckBig size={18} aria-hidden /> تم إبلاغ النادل، ستفتح القائمة خلال لحظات</div> : <button className="btn btn-primary btn-lg" onClick={askOpen}><BellRing size={18} /> {askedAt ? 'تنبيه النادل مرة أخرى' : 'اطلب من النادل فتح الطاولة'}</button>}{askErr && <div className="alert alert-err">{askErr}</div>}</div></Shell>;
  if (!isEvent && cfg.table.busy && !mine) return <Shell cfg={cfg}><div className="co-state"><Armchair size={44} aria-hidden /><h2>{cfg.table.name} عليها طلب مفتوح</h2><p>لإضافة أصناف نادِ النادل.</p></div></Shell>;

  return (
    <Shell cfg={cfg}>
      {isEvent && (
        <div className="co-rules">
          <span className="co-rules-ico" aria-hidden><Info size={16} /></span>
          <span>{cfg.event.menu_mode === 'selected' ? 'قائمة مخصصة لمؤسستكم' : cfg.event.menu_mode === 'cap' ? `الأصناف حتى ${fmt(cfg.event.price_cap, cur)} للصنف` : 'قائمة المطعم الكاملة'}{cfg.event.order_cap ? ` · سقف الطلب ${fmt(cfg.event.order_cap, cur)}` : ''}{cfg.event.billing === 'institution' ? ' · الحساب على المؤسسة' : ''}</span>
        </div>
      )}
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
                <p className="co-badge">{isEvent ? <><Building2 size={15} aria-hidden /> {cfg.event.name}</> : <><Armchair size={15} aria-hidden /> {cfg.table.name}</>}{adding ? ' · إضافة على طلبك' : ''}</p>
                {!adding && <><label><span><UserRound size={14} aria-hidden /> الاسم *</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
                <label><span><Phone size={14} aria-hidden /> رقم الجوال {isEvent ? '(اختياري)' : '*'}</span><input inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" /></label>
                {isEvent ? (
                  <label><span><PinIcon size={14} aria-hidden /> المكان / الطاولة{cfg.event.places.length ? ' *' : ''}</span>
                    {cfg.event.places.length ? <select value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })}><option value="">اختر مكانك</option>{cfg.event.places.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                      : <input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="مثال: طاولة 3" />}
                  </label>
                ) : <label><span>عدد الأشخاص</span><input type="number" min="1" max="30" value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} /></label>}</>}
                <label><span>ملاحظات للمطبخ</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="مثال: بدون بصل" /></label>
              </div>
              <div className="co-sum">
                <div><span>المجموع</span><span>{fmt(sub, cur)}</span></div>
                {isEvent && cfg.event.order_cap ? <small className={sub > cfg.event.order_cap ? 'co-over' : ''}>سقف الطلب الواحد {fmt(cfg.event.order_cap, cur)}{sub > cfg.event.order_cap ? ' — خفّض الكمية أو الأصناف' : ''}</small> : null}
                <small>{isEvent && cfg.event.billing === 'institution' ? 'الحساب على المؤسسة، لا تدفع شيئاً.' : 'تُضاف الضريبة (إن وجدت) عند الحساب النهائي.'}</small>
              </div>
              {formErr && <div className="alert alert-err">{formErr}</div>}
            </div>
            <footer><button className="btn btn-primary btn-lg btn-block" onClick={submit} disabled={busy}><Send size={19} /> {busy ? 'جارِ الإرسال…' : isEvent && cfg.event.needs_approval ? 'إرسال الطلب للاعتماد' : 'إرسال الطلب للمطبخ'}</button></footer>
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
        <div><strong>{cfg?.name || 'المطعم'}</strong><small>{cfg?.event ? `${cfg.event.name} · قائمة المؤسسة` : cfg?.table ? `${cfg.table.name} · اطلب من هاتفك` : 'اطلب من هاتفك'}</small></div>
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

/** متابعة حالة الطلب للزبون: تتحدث فوراً عند ضغط المطبخ على أي مرحلة */
function Tracker({ order, cur, phone, billAllowed, institution, onAdd, onClosed }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [live, setLive] = useState(true);
  const [flash, setFlash] = useState('');
  const prev = useRef(-1);
  const [, tick] = useState(0);
  const [billOpen, setBillOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pp, setPp] = useState({ state: 'hidden' });   // hidden | ask | on | denied | busy | ios

  useEffect(() => {
    let alive = true;
    let busy = false;
    const load = async () => {
      if (busy) return; busy = true;
      try { const d = await api(`/public/orders/${order.code}?t=${order.token}`); if (alive) { setData(d); setErr(''); setLive(true); } }
      catch (e) { if (alive) { setErr(e.message); setLive(false); } } finally { busy = false; }
    };
    load();
    const off = watchOrder(order.code, order.token, load);      // تحديث لحظي
    const poll = setInterval(load, 10000);                       // شبكة أمان إن انقطع الاتصال اللحظي
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    const clock = setInterval(() => tick((n) => n + 1), 30000);
    return () => { alive = false; off(); clearInterval(poll); clearInterval(clock); document.removeEventListener('visibilitychange', vis); };
  }, [order.code, order.token]);

  // إشعارات خارج الصفحة (Web Push): تظهر البطاقة إن كان الخادم والمتصفح يدعمانها
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pushSupported()) { if (isIOS() && !isStandalone() && alive) setPp({ state: 'ios' }); return; }
      if (!(await pushKey())) return;
      const subKey = `ph-wp-${order.code}`;
      if (Notification.permission === 'denied') { alive && setPp({ state: 'denied' }); return; }
      if (Notification.permission === 'granted' && safe(() => localStorage.getItem(subKey))) { alive && setPp({ state: 'on' }); return; }
      alive && setPp({ state: 'ask' });
    })();
    return () => { alive = false; };
  }, [order.code]);
  const askPush = async () => {
    setPp({ state: 'busy' });
    try {
      const r = await enableOrderPush(order.code, order.token);
      if (r === 'granted') { safe(() => localStorage.setItem(`ph-wp-${order.code}`, '1')); setPp({ state: 'on' }); }
      else setPp({ state: r === 'denied' ? 'denied' : 'ask' });
    } catch { setPp({ state: 'ask' }); }
  };

  const pend = !!data?.pending_confirm;
  const st = data ? stage(data.items) : 0;
  const closed = data && data.status !== 'open';

  // تنبيه عند تغيّر المرحلة (اهتزاز + شريط) وخصوصاً عند جاهزية الطلب
  useEffect(() => {
    if (!data || closed || pend) { prev.current = st; return; }
    if (prev.current >= 0 && st > prev.current) {
      setFlash(STEPS[st][1]);
      safe(() => navigator.vibrate?.(st >= 2 ? [200, 100, 200, 100, 300] : 120));
      const t = setTimeout(() => setFlash(''), 5000);
      prev.current = st;
      return () => clearTimeout(t);
    }
    prev.current = st;
    return undefined;
  }, [st, data, closed, pend]);

  const mins = data ? Math.max(0, Math.round((Date.now() - new Date(String(data.created_at).replace(' ', 'T')).getTime()) / 60000)) : 0;
  return (
    <div className="co-track">
      <span className="co-check" aria-hidden><CircleCheckBig size={42} /></span>
      <h2>{pend ? (data?.event ? 'طلبك بانتظار الاعتماد' : 'طلبك بانتظار تأكيد النادل') : closed && data.status === 'cancelled' ? 'لم يُقبل الطلب' : st >= 2 && !closed ? 'طلبك جاهز! 🎉' : 'تم إرسال طلبك للمطبخ'}</h2>
      <p className="muted">رقم الطلب{data?.table_name ? ` · ${data.table_name}` : ''}{data?.event ? ` · ${data.event.name}${data.place ? ` · ${data.place}` : ''}` : ''}</p>
      <p className="co-code" dir="ltr">{order.code}</p>
      <p className={`co-live ${live ? 'on' : ''}`}><i aria-hidden /> {live ? 'تحديث مباشر' : 'انقطع الاتصال، نحاول مجدداً…'}{data && !closed ? ` · منذ ${mins} د` : ''}</p>
      {flash && <div className="co-flash" role="status">{st >= 2 ? '🔔' : '✨'} {flash}</div>}
      {err && !data && <div className="alert alert-err">{err}</div>}
      {!closed && pp.state === 'ask' && (
        <div className="co-pushcard">
          <span className="co-pushicon" aria-hidden><BellRing size={22} /></span>
          <div><strong>أبقَ على اطلاع بطلبك</strong><small>اسمح بالإشعارات لتصلك «تم القبول» و«بدأ التحضير» و«طلبك جاهز» حتى لو أغلقت الصفحة.</small></div>
          <button className="btn btn-primary btn-sm" onClick={askPush}>تفعيل الإشعارات</button>
        </div>
      )}
      {!closed && pp.state === 'busy' && <div className="co-pushcard"><span className="co-pushicon" aria-hidden><BellRing size={22} /></span><div><strong>جارِ التفعيل…</strong><small>اضغط «السماح» في نافذة المتصفح.</small></div></div>}
      {!closed && pp.state === 'on' && <div className="co-pushcard on"><span className="co-pushicon" aria-hidden><CircleCheckBig size={22} /></span><div><strong>الإشعارات مفعّلة</strong><small>ستصلك تحديثات طلبك حتى لو أغلقت الصفحة.</small></div></div>}
      {!closed && pp.state === 'denied' && <div className="co-pushcard warn"><span className="co-pushicon" aria-hidden><Ban size={22} /></span><div><strong>الإشعارات محظورة</strong><small>لتفعيلها: اضغط أيقونة القفل بجانب عنوان الصفحة ← الإشعارات ← السماح، ثم أعد فتح الصفحة.</small></div></div>}
      {!closed && pp.state === 'ios' && <div className="co-pushcard warn"><span className="co-pushicon" aria-hidden><BellRing size={22} /></span><div><strong>لتصلك الإشعارات على آيفون</strong><small>اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية» وافتح الطلب منها.</small></div></div>}
      {data && (
        <>
          {pend && <div className="alert alert-warn"><Clock size={16} aria-hidden /> سيصل طلبك للمطبخ فور تأكيد النادل له.</div>}
          {closed ? <div className="alert alert-warn">{data.status === 'paid' ? 'تم إغلاق الطلب. شكراً لزيارتكم!' : `أُلغي هذا الطلب${data.cancel_reason ? `: ${data.cancel_reason}` : ''}. نادِ النادل للمساعدة.`}</div> : !pend && (
            <ol className="co-steps" aria-label="حالة الطلب" style={{ '--p': st }}>
              {STEPS.map(([k, label, I], i) => <li key={k} className={i < st ? 'done' : i === st ? 'cur' : ''}><span><I size={18} aria-hidden /></span><small>{label}</small></li>)}
            </ol>
          )}
          {data.bill && !closed && (
            <section className="co-ticket" aria-label="طلب الحساب">
              <span className="co-ticket-ico" aria-hidden><Receipt size={26} /></span>
              <h3>تم إرسال طلب الحساب</h3>
              <p className="co-ticket-msg">يرجى التوجه إلى الكاشير</p>
              <button className="co-ticket-code" onClick={async () => { try { await navigator.clipboard.writeText(order.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } }} aria-label="نسخ كود العملية">
                <small>كود العملية</small>
                <strong dir="ltr">{order.code}</strong>
                <span className="co-ticket-copy">{copied ? <><Check size={13} /> تم النسخ</> : <><Copy size={13} /> نسخ</>}</span>
              </button>
              <dl className="co-ticket-rows">
                <div><dt>طريقة الدفع</dt><dd>{BILL_LABEL[data.bill.method] || data.bill.method}</dd></div>
                {data.bill.name && <div><dt>الاسم</dt><dd>{data.bill.name}</dd></div>}
                {data.bill.phone && <div><dt>{data.bill.method === 'jawwalpay' ? 'رقم جوال بي' : data.bill.method === 'wallet' ? 'رقم المحفظة' : 'الجوال'}</dt><dd dir="ltr">{data.bill.phone}</dd></div>}
                <div><dt>المبلغ</dt><dd>{fmt(data.total, cur)}</dd></div>
              </dl>
              <button className="btn btn-ghost btn-sm" onClick={async () => { try { await api(`/public/orders/${order.code}/bill?t=${order.token}`, { method: 'DELETE' }); setData((d) => ({ ...d, bill: null })); } catch { /* */ } }}>إلغاء طلب الحساب</button>
            </section>
          )}
          <ul className="co-lines flat">
            {data.items.map((i, k) => <li key={k}><b>{i.qty}×</b><span className="co-line-name">{i.name}</span><span className={`status status-${i.status}`}>{pend && i.status === 'pending' ? 'بانتظار التأكيد' : { new: 'تم الاستلام', preparing: 'قيد التحضير', ready: 'جاهز', served: 'تم التقديم' }[i.status] || i.status}</span></li>)}
          </ul>
          <p className="co-total"><span>الإجمالي</span><strong>{fmt(data.total, cur)}</strong></p>
        </>
      )}
      <p className="muted small"><Clock size={13} aria-hidden /> احتفظ بهذه الصفحة مفتوحة وستتحدث الحالة تلقائياً.{phone ? <> للاستفسار <bdi dir="ltr">{phone}</bdi></> : null}</p>
      {closed ? <button className="btn btn-block" onClick={onClosed}>طلب جديد</button> : (
        <>
          {institution && !pend && data && <div className="co-billwait" role="status"><Building2 size={18} aria-hidden /><div><strong>الحساب على المؤسسة</strong><small>لا حاجة لطلب الحساب أو الدفع</small></div></div>}
          {billAllowed && !pend && data && !data.bill && data.items.length > 0 && (st >= 2
            ? <button className="btn btn-ok btn-lg btn-block" onClick={() => setBillOpen(true)}><Receipt size={19} /> طلب الحساب</button>
            : <div className="co-billwait" role="status"><Receipt size={18} aria-hidden /><div><strong>طلب الحساب</strong><small>يتاح بعد تجهيز طلبك في المطبخ</small></div><span className="co-billwait-lock" aria-hidden>🔒</span></div>)}
          {!data?.bill && <button className="btn btn-primary btn-block" onClick={onAdd}><Plus size={17} /> إضافة أصناف لطلبي</button>}
        </>
      )}
      {billOpen && <BillSheet order={order} total={data?.total} cur={cur} onClose={() => setBillOpen(false)} onDone={(b) => { setBillOpen(false); setData((d) => ({ ...d, bill: { at: new Date().toISOString(), ...b } })); }} />}
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

/** طلب الحساب: اختيار طريقة الدفع ثم الاسم ورقم الجوال */
function BillSheet({ order, total, cur, onClose, onDone }) {
  const [method, setMethod] = useState('jawwalpay');
  const [name, setName] = useState(() => safe(() => localStorage.getItem('ph-co-name'), '') || '');
  const [phone, setPhone] = useState(() => safe(() => localStorage.getItem('ph-co-phone'), '') || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const e = method !== 'cash';
  const phoneLabel = method === 'jawwalpay' ? 'رقم جوال بي *' : method === 'wallet' ? 'رقم المحفظة *' : 'رقم الجوال (اختياري)';
  const send = async () => {
    setErr('');
    if (e && !name.trim()) return setErr('أدخل الاسم');
    if ((method === 'jawwalpay' || method === 'wallet') && !/^\+?[0-9\s-]{7,15}$/.test(phone.trim())) return setErr(method === 'jawwalpay' ? 'أدخل رقم جوال بي صحيحاً' : 'أدخل رقم المحفظة صحيحاً');
    setBusy(true);
    try {
      const b = { method, name: e ? name.trim() : '', phone: e ? phone.trim() : '' };
      await api(`/public/orders/${order.code}/bill?t=${order.token}`, { method: 'POST', body: b });
      safe(() => { localStorage.setItem('ph-co-name', name.trim()); });
      onDone(b);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="co-sheet-wrap" onClick={onClose}>
      <section className="co-sheet" role="dialog" aria-modal="true" aria-label="طلب الحساب" onClick={(ev) => ev.stopPropagation()}>
        <header><h2>طلب الحساب</h2><button className="icon-btn" onClick={onClose} aria-label="إغلاق"><X size={20} /></button></header>
        <div className="co-sheet-body">
          <p className="co-bill-total"><span>المبلغ المطلوب</span><strong>{fmt(total, cur)}</strong></p>
          <div className="co-methods" role="radiogroup" aria-label="طريقة الدفع">
            {BILL_METHODS.map(([k, label, I]) => (
              <button key={k} role="radio" aria-checked={method === k} className={`co-method ${method === k ? 'on' : ''}`} onClick={() => setMethod(k)}><I size={22} aria-hidden /><span>{label}</span></button>
            ))}
          </div>
          {e ? (
            <div className="co-form">
              <label><span><UserRound size={14} aria-hidden /> الاسم *</span><input value={name} onChange={(ev) => setName(ev.target.value)} autoComplete="name" /></label>
              <label><span><Phone size={14} aria-hidden /> {phoneLabel}</span><input inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" value={phone} onChange={(ev) => setPhone(ev.target.value)} autoComplete="tel" /></label>
            </div>
          ) : <p className="muted small">ادفع نقداً عند الكاشير. لا حاجة لإدخال بيانات.</p>}
          {err && <div className="alert alert-err">{err}</div>}
        </div>
        <footer><button className="btn btn-ok btn-lg btn-block" onClick={send} disabled={busy}><Send size={19} /> {busy ? 'جارِ الإرسال…' : 'إرسال للكاشير'}</button></footer>
      </section>
    </div>
  );
}
