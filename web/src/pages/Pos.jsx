import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import {
  useApp, useData, useMoney, useAction, useToast, can, Modal, Field, Empty, Loading,
  ORDER_TYPES, ITEM_STATUS, PAY_METHODS,
} from '../lib.jsx';
import Receipt from '../components/Receipt.jsx';

let draftSeq = 1;

export default function Pos() {
  const { orderId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, settings } = useApp();
  const money = useMoney();
  const toast = useToast();
  const [run, busy] = useAction();

  const menu = useData('/menu', ['menu']);
  const tables = useData('/tables', ['tables']);
  const orderQ = useData(orderId ? `/orders/${orderId}` : null, ['orders', 'kitchen'], [orderId]);
  const order = orderId && orderQ.data?.id === Number(orderId) ? orderQ.data : null;

  const [cat, setCat] = useState(null);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState([]);
  const [picking, setPicking] = useState(null);
  const [paying, setPaying] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [printOrder, setPrintOrder] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [meta, setMeta] = useState({
    type: params.get('type') || (user.role === 'waiter' ? 'dine_in' : 'takeaway'),
    table_id: params.get('table') ? Number(params.get('table')) : '',
    customer_name: '', customer_phone: '', address: '', guests: '', notes: '',
  });

  useEffect(() => { setDraft([]); }, [orderId]);
  useEffect(() => {
    if (menu.data && cat === null) setCat(menu.data.categories[0]?.id ?? 0);
  }, [menu.data, cat]);

  const items = useMemo(() => {
    if (!menu.data) return [];
    const s = q.trim();
    return menu.data.items.filter((i) => (s ? i.name.includes(s) : i.category_id === cat));
  }, [menu.data, cat, q]);

  const currentCat = menu.data?.categories.find((c) => c.id === cat);
  const catIcon = Object.fromEntries((menu.data?.categories || []).map((c) => [c.id, c.icon]));
  const price = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(2));
  const draftTotal = draft.reduce((a, d) => a + d.unit * d.qty, 0);
  const isOpen = !order || order.status === 'open';
  const canPay = can(user, 'cashier', 'manager');

  function addToDraft(item, { modifiers = [], qty = 1, notes = '' } = {}) {
    if (!item.available) return toast('هذا الصنف غير متوفر حالياً', 'err');
    const unit = item.price + modifiers.reduce((a, m) => a + m.price, 0);
    setDraft((d) => {
      const key = `${item.id}|${modifiers.map((m) => m.id).sort().join(',')}|${notes}`;
      const ex = d.find((x) => x.key === key);
      if (ex) return d.map((x) => (x === ex ? { ...x, qty: x.qty + qty } : x));
      return [...d, { key, uid: draftSeq++, item_id: item.id, name: item.name, unit, qty, modifiers, notes }];
    });
  }

  function onItemClick(item) {
    if (item.modifiers?.length) setPicking(item);
    else addToDraft(item);
  }

  const draftPayload = () => draft.map((d) => ({ item_id: d.item_id, qty: d.qty, notes: d.notes, modifier_ids: d.modifiers.map((m) => m.id) }));

  async function submit({ send, thenPay }) {
    const r = await run(async () => {
      if (order) {
        if (draft.length) return api(`/orders/${order.id}/items`, { method: 'POST', body: { items: draftPayload(), send } });
        if (send) return api(`/orders/${order.id}/send`, { method: 'POST' });
        return order;
      }
      if (!draft.length) throw new Error('أضف أصنافاً للطلب');
      return api('/orders', { method: 'POST', body: { ...meta, table_id: meta.table_id || null, guests: Number(meta.guests) || null, items: draftPayload(), send } });
    }, send ? 'تم الإرسال للمطبخ ✓' : 'تم الحفظ');
    if (!r) return;
    setDraft([]);
    setCartOpen(false);
    if (!order) navigate(`/pos/${r.id}`, { replace: true });
    else orderQ.setData(r);
    if (thenPay) setPaying(true);
    else if (send && user.role === 'waiter') navigate('/tables');
  }

  async function lineAction(line, body) {
    const r = await run(() => api(`/orders/${order.id}/items/${line.id}`, { method: 'PATCH', body }));
    if (r) orderQ.setData(r);
  }

  async function cancelOrder() {
    const reason = window.prompt('سبب إلغاء الطلب؟');
    if (reason === null) return;
    const r = await run(() => api(`/orders/${order.id}/cancel`, { method: 'POST', body: { reason } }), 'تم إلغاء الطلب');
    if (r) navigate('/orders');
  }

  async function serveReady() {
    const r = await run(() => api(`/orders/${order.id}/serve`, { method: 'POST' }), 'تم التقديم');
    if (r) orderQ.setData(r);
  }

  function newOrder() {
    setDraft([]);
    navigate('/pos');
  }

  if (menu.loading || (orderId && orderQ.loading && !order)) return <Loading />;
  if (orderId && orderQ.error) return <Empty icon="⚠️" text={orderQ.error} />;

  const freeTables = (tables.data || []).filter((t) => t.status !== 'occupied' || t.order_id === order?.id);
  const pendingCount = order?.items.filter((i) => i.status === 'pending').length || 0;
  const readyCount = order?.items.filter((i) => i.status === 'ready').length || 0;
  const cartCount = draft.reduce((a, d) => a + d.qty, 0) + (order?.items.filter((i) => i.status !== 'cancelled').length || 0);

  return (
    <div className="pos">
      {/* ───── قائمة الأصناف ───── */}
      <section className="pos-menu">
        <header className="menu-hero">
          <div className="menu-brand">
            <span className="menu-kicker">قائمة الطعام</span>
            <h1 className="menu-title">{settings?.restaurant_name}</h1>
          </div>
          <label className="menu-search">
            <span aria-hidden>⌕</span>
            <input type="search" placeholder="ابحث عن طبق…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
          </label>
        </header>

        <nav className="cat-tabs" role="tablist" aria-label="الفئات">
          {menu.data.categories.map((c) => (
            <button key={c.id} role="tab" aria-selected={!q && cat === c.id} className={`cat-tab ${!q && cat === c.id ? 'active' : ''}`} onClick={() => { setQ(''); setCat(c.id); }}>
              <span className="cat-icon" aria-hidden>{c.icon}</span>
              <span>{c.name}</span>
            </button>
          ))}
        </nav>

        <div className="menu-scroll">
          <div className="menu-section-head">
            <span className="orn" aria-hidden />
            <h2>{q ? `نتائج البحث عن «${q}»` : currentCat?.name}</h2>
            <span className="orn" aria-hidden />
          </div>
          <p className="menu-count">{items.length} {items.length === 1 ? 'طبق' : 'أطباق'}</p>

          <div className="dish-grid">
            {items.map((it) => {
              const inCart = draft.filter((d) => d.item_id === it.id).reduce((a, d) => a + d.qty, 0);
              const art = it.image || catIcon[it.category_id] || '🍽️';
              return (
                <button key={it.id} className={`dish st-${it.station} ${it.available ? '' : 'unavailable'} ${inCart ? 'in-cart' : ''}`}
                  onClick={() => isOpen && onItemClick(it)} disabled={!isOpen}
                  aria-label={`${it.name}، ${money(it.price)}${it.available ? '' : '، غير متوفر'}`}>
                  <span className="dish-art" aria-hidden>
                    {/^(https?:|data:)/.test(art) ? <img src={art} alt="" loading="lazy" /> : <span className="dish-emoji">{art}</span>}
                  </span>
                  <span className="dish-body">
                    <span className="dish-name">{it.name}</span>
                    {it.description && <span className="dish-desc">{it.description}</span>}
                    {it.modifiers?.length > 0 && <span className="dish-opts">✦ {it.modifiers.length} خيارات إضافية</span>}
                    <span className="dish-foot">
                      <span className="dish-price"><b>{price(it.price)}</b> <small>{settings?.currency}</small></span>
                      <span className="dish-add" aria-hidden>{it.available ? '+' : ''}</span>
                    </span>
                  </span>
                  {!it.available && <span className="dish-flag">نفد اليوم</span>}
                  {inCart > 0 && <span className="dish-qty">{inCart}</span>}
                </button>
              );
            })}
          </div>
          {!items.length && <Empty icon="🍽️" text="لا توجد أطباق" />}
        </div>
      </section>

      {/* ───── السلة ───── */}
      <section className={`pos-cart ${cartOpen ? 'open' : ''}`}>
        <div className="cart-head">
          {order ? (
            <>
              <div>
                <h2>طلب #{order.number}</h2>
                <span className="muted">{ORDER_TYPES[order.type]}{order.table_name ? ` · ${order.table_name}` : ''}{order.customer_name ? ` · ${order.customer_name}` : ''}</span>
              </div>
              <div className="row gap-s">
                {order.status !== 'open' && <span className={`badge ${order.status === 'paid' ? 'badge-ok' : 'badge-err'}`}>{order.status === 'paid' ? 'مدفوع' : 'ملغى'}</span>}
                <button className="btn btn-ghost btn-sm" onClick={newOrder}>+ طلب جديد</button>
                <button className="icon-btn cart-close" onClick={() => setCartOpen(false)} aria-label="إغلاق">✕</button>
              </div>
            </>
          ) : (
            <>
              <div className="seg" role="radiogroup" aria-label="نوع الطلب">
                {Object.entries(ORDER_TYPES).map(([k, v]) => (
                  <button key={k} role="radio" aria-checked={meta.type === k} className={meta.type === k ? 'active' : ''} onClick={() => setMeta({ ...meta, type: k })}>{v}</button>
                ))}
              </div>
              <button className="icon-btn cart-close" onClick={() => setCartOpen(false)} aria-label="إغلاق">✕</button>
            </>
          )}
        </div>

        {!order && (
          <div className="cart-meta">
            {meta.type === 'dine_in' && (
              <div className="grid-2">
                <select value={meta.table_id} onChange={(e) => setMeta({ ...meta, table_id: Number(e.target.value) || '' })} aria-label="الطاولة">
                  <option value="">— اختر الطاولة —</option>
                  {freeTables.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.area})</option>)}
                </select>
                <input type="number" min="1" placeholder="عدد الأشخاص" value={meta.guests} onChange={(e) => setMeta({ ...meta, guests: e.target.value })} />
              </div>
            )}
            {meta.type !== 'dine_in' && (
              <div className="grid-2">
                <input placeholder="اسم العميل" value={meta.customer_name} onChange={(e) => setMeta({ ...meta, customer_name: e.target.value })} />
                <input placeholder="رقم الجوال" inputMode="tel" dir="ltr" value={meta.customer_phone} onChange={(e) => setMeta({ ...meta, customer_phone: e.target.value })} />
              </div>
            )}
            {meta.type === 'delivery' && (
              <input placeholder="عنوان التوصيل" value={meta.address} onChange={(e) => setMeta({ ...meta, address: e.target.value })} />
            )}
          </div>
        )}

        <div className="cart-lines">
          {order?.items.map((l) => (
            <div key={l.id} className={`line ${l.status === 'cancelled' ? 'line-cancelled' : ''}`}>
              <div className="line-main">
                <span className="line-qty">{l.qty}×</span>
                <div className="line-text">
                  <strong>{l.name}</strong>
                  {l.modifiers.length > 0 && <small>{l.modifiers.map((m) => m.name).join('، ')}</small>}
                  {l.notes && <small className="note">📝 {l.notes}</small>}
                </div>
                <span className="line-price">{money(l.price * l.qty)}</span>
              </div>
              <div className="line-foot">
                <span className={`status status-${l.status}`}>{ITEM_STATUS[l.status]}</span>
                {isOpen && l.status === 'pending' && (
                  <span className="row gap-s">
                    <button className="btn btn-xs" onClick={() => lineAction(l, { qty: l.qty - 1 })} disabled={l.qty <= 1 || busy} aria-label="إنقاص">−</button>
                    <button className="btn btn-xs" onClick={() => lineAction(l, { qty: l.qty + 1 })} disabled={busy} aria-label="زيادة">+</button>
                  </span>
                )}
                {isOpen && l.status !== 'cancelled' && l.status !== 'served' && (l.status === 'pending' || canPay) && (
                  <button className="btn btn-xs btn-danger-ghost" onClick={() => lineAction(l, { cancel: true })} disabled={busy}>إلغاء</button>
                )}
              </div>
            </div>
          ))}

          {draft.length > 0 && order && <div className="divider">إضافات جديدة</div>}
          {draft.map((d) => (
            <div key={d.uid} className="line line-draft">
              <div className="line-main">
                <div className="qty-ctl">
                  <button className="btn btn-xs" onClick={() => setDraft((x) => x.map((y) => (y.uid === d.uid ? { ...y, qty: y.qty + 1 } : y)))} aria-label="زيادة">+</button>
                  <span>{d.qty}</span>
                  <button className="btn btn-xs" onClick={() => setDraft((x) => (d.qty <= 1 ? x.filter((y) => y.uid !== d.uid) : x.map((y) => (y.uid === d.uid ? { ...y, qty: y.qty - 1 } : y))))} aria-label="إنقاص">−</button>
                </div>
                <div className="line-text">
                  <strong>{d.name}</strong>
                  {d.modifiers.length > 0 && <small>{d.modifiers.map((m) => m.name).join('، ')}</small>}
                  {d.notes && <small className="note">📝 {d.notes}</small>}
                </div>
                <span className="line-price">{money(d.unit * d.qty)}</span>
              </div>
            </div>
          ))}
          {!order?.items.length && !draft.length && <Empty icon="🛒" text="اختر الأصناف من القائمة" />}
        </div>

        <div className="cart-totals">
          {order ? (
            <>
              <Row k="المجموع" v={money(order.subtotal)} />
              {order.discount > 0 && <Row k="الخصم" v={`− ${money(order.discount)}`} />}
              {order.service > 0 && <Row k="رسوم الخدمة" v={money(order.service)} />}
              {order.delivery_fee > 0 && <Row k="رسوم التوصيل" v={money(order.delivery_fee)} />}
              <Row k="الضريبة" v={money(order.tax)} />
              <Row k="الإجمالي" v={money(order.total)} big />
              {order.paid > 0 && <Row k="المدفوع" v={money(order.paid)} />}
              {draft.length > 0 && <Row k="إضافات غير محفوظة" v={money(draftTotal)} />}
            </>
          ) : (
            <Row k="المجموع (قبل الضريبة)" v={money(draftTotal)} big />
          )}
        </div>

        {isOpen && (
          <div className="cart-actions">
            {(draft.length > 0 || pendingCount > 0) && (
              <div className="grid-2">
                <button className="btn btn-primary btn-lg" onClick={() => submit({ send: true })} disabled={busy}>🔥 إرسال للمطبخ</button>
                <button className="btn btn-lg" onClick={() => submit({ send: false })} disabled={busy || !draft.length}>حفظ</button>
              </div>
            )}
            {order && (
              <div className="btn-row">
                {readyCount > 0 && <button className="btn btn-ok" onClick={serveReady} disabled={busy}>✓ تقديم ({readyCount})</button>}
                {canPay && <button className="btn" onClick={() => setDiscountOpen(true)}>خصم</button>}
                {order.type === 'dine_in' && <button className="btn" onClick={() => setMoveOpen(true)}>نقل طاولة</button>}
                <button className="btn" onClick={() => setPrintOrder(order)}>🖨️ طباعة</button>
                {canPay && <button className="btn btn-danger-ghost" onClick={cancelOrder} disabled={busy || order.paid > 0}>إلغاء الطلب</button>}
              </div>
            )}
            {canPay && (order || draft.length > 0) && (
              <button className="btn btn-ok btn-lg btn-block" disabled={busy} onClick={() => (draft.length || !order ? submit({ send: true, thenPay: true }) : setPaying(true))}>
                💳 الدفع {order ? `(${money(order.total - order.paid + (draft.length ? draftTotal : 0))})` : ''}
              </button>
            )}
          </div>
        )}
        {order && !isOpen && (
          <div className="cart-actions">
            <button className="btn btn-lg btn-block" onClick={() => setPrintOrder(order)}>🖨️ طباعة الفاتورة</button>
            <button className="btn btn-primary btn-lg btn-block" onClick={newOrder}>+ طلب جديد</button>
          </div>
        )}
      </section>

      <button className="cart-fab" onClick={() => setCartOpen(true)}>
        🛒 السلة {cartCount > 0 && <span className="fab-count">{cartCount}</span>}
        {order && <span>· {money(order.total)}</span>}
      </button>

      {picking && <ModifierPicker item={picking} money={money} onClose={() => setPicking(null)} onAdd={(opts) => { addToDraft(picking, opts); setPicking(null); }} />}
      {paying && order && (
        <PayModal key={order.id} order={order} money={money} onClose={() => setPaying(false)}
          onPaid={(r) => { setPaying(false); orderQ.setData(r.order); if (r.order.status === 'paid') setPrintOrder(r.order); }} />
      )}
      {discountOpen && order && <DiscountModal order={order} onClose={() => setDiscountOpen(false)} onDone={(o) => { orderQ.setData(o); setDiscountOpen(false); }} />}
      {moveOpen && order && (
        <Modal title="نقل إلى طاولة أخرى" onClose={() => setMoveOpen(false)}>
          <div className="table-pick">
            {(tables.data || []).filter((t) => t.status !== 'occupied').map((t) => (
              <button key={t.id} className="btn" onClick={async () => {
                const r = await run(() => api(`/orders/${order.id}/move`, { method: 'POST', body: { table_id: t.id } }), `تم النقل إلى ${t.name}`);
                if (r) { orderQ.setData(r); setMoveOpen(false); }
              }}>{t.name}</button>
            ))}
          </div>
        </Modal>
      )}
      {printOrder && <Receipt order={printOrder} onClose={() => setPrintOrder(null)} />}
    </div>
  );
}

function Row({ k, v, big }) {
  return <div className={`tot-row ${big ? 'big' : ''}`}><span>{k}</span><span>{v}</span></div>;
}

function ModifierPicker({ item, money, onClose, onAdd }) {
  const [sel, setSel] = useState([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const unit = item.price + sel.reduce((a, m) => a + m.price, 0);
  const toggle = (m) => setSel((s) => (s.some((x) => x.id === m.id) ? s.filter((x) => x.id !== m.id) : [...s, m]));
  return (
    <Modal title={item.name} onClose={onClose} footer={
      <>
        <div className="qty-ctl qty-lg">
          <button className="btn" onClick={() => setQty(qty + 1)} aria-label="زيادة">+</button>
          <span>{qty}</span>
          <button className="btn" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="إنقاص">−</button>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => onAdd({ modifiers: sel, qty, notes: notes.trim() })}>إضافة · {money(unit * qty)}</button>
      </>
    }>
      <p className="muted">{item.description}</p>
      <div className="mod-list">
        {item.modifiers.map((m) => (
          <label key={m.id} className={`mod ${sel.some((x) => x.id === m.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={sel.some((x) => x.id === m.id)} onChange={() => toggle(m)} />
            <span>{m.name}</span>
            <span className="muted">{m.price ? `+${money(m.price)}` : 'مجاناً'}</span>
          </label>
        ))}
      </div>
      <Field label="ملاحظات للمطبخ">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: بدون مايونيز" />
      </Field>
    </Modal>
  );
}

function PayModal({ order, money, onClose, onPaid }) {
  const [run, busy] = useAction();
  const remaining = Math.round((order.total - order.paid) * 100) / 100;
  const [lines, setLines] = useState([]);
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(String(remaining));
  useEffect(() => { setLines([]); setAmount(String(remaining)); }, [remaining]);
  const entered = lines.reduce((a, l) => a + l.amount, 0);
  const left = Math.round((remaining - entered) * 100) / 100;
  const pendingAmt = Number(amount) || 0;
  const change = Math.max(0, Math.round((entered + pendingAmt - remaining) * 100) / 100);
  const quick = [...new Set([left, Math.ceil(left / 10) * 10, Math.ceil(left / 50) * 50, Math.ceil(left / 100) * 100].filter((x) => x > 0))];

  function addLine() {
    if (!(pendingAmt > 0)) return;
    setLines([...lines, { method, amount: pendingAmt }]);
    const newLeft = Math.max(0, Math.round((left - pendingAmt) * 100) / 100);
    setAmount(String(newLeft));
  }

  async function confirm() {
    const payments = [...lines];
    if (pendingAmt > 0) payments.push({ method, amount: pendingAmt });
    if (!payments.length) return;
    const r = await run(() => api(`/orders/${order.id}/pay`, { method: 'POST', body: { payments } }));
    if (r) onPaid(r);
  }

  return (
    <Modal title={`دفع طلب #${order.number}`} onClose={onClose} footer={
      <button className="btn btn-ok btn-lg btn-block" onClick={confirm} disabled={busy}>
        تأكيد الدفع {change > 0 ? `· الباقي للعميل ${money(change)}` : ''}
      </button>
    }>
      <div className="pay-total">
        <span>المطلوب</span>
        <strong>{money(remaining)}</strong>
      </div>
      <div className="seg seg-lg" role="radiogroup" aria-label="طريقة الدفع">
        {Object.entries(PAY_METHODS).map(([k, v]) => (
          <button key={k} role="radio" aria-checked={method === k} className={method === k ? 'active' : ''} onClick={() => setMethod(k)}>{v}</button>
        ))}
      </div>
      <Field label="المبلغ">
        <input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-lg" />
      </Field>
      {method === 'cash' && (
        <div className="quick-amounts">
          {quick.map((v) => <button key={v} className="btn" onClick={() => setAmount(String(v))}>{v}</button>)}
        </div>
      )}
      <button className="btn btn-ghost btn-block" onClick={addLine} disabled={!(pendingAmt > 0) || pendingAmt >= left}>+ تقسيم الدفع (إضافة طريقة أخرى)</button>
      {lines.length > 0 && (
        <ul className="pay-lines">
          {lines.map((l, i) => (
            <li key={i}><span>{PAY_METHODS[l.method]}</span><span>{money(l.amount)}</span>
              <button className="btn btn-xs btn-danger-ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>حذف</button></li>
          ))}
          <li className="muted"><span>المتبقي</span><span>{money(Math.max(0, left))}</span><span /></li>
        </ul>
      )}
    </Modal>
  );
}

function DiscountModal({ order, onClose, onDone }) {
  const [run, busy] = useAction();
  const [type, setType] = useState(order.discount_type || 'percent');
  const [value, setValue] = useState(order.discount_value || '');
  async function save(v) {
    const r = await run(() => api(`/orders/${order.id}/discount`, { method: 'POST', body: { type, value: v } }), 'تم تطبيق الخصم');
    if (r) onDone(r);
  }
  return (
    <Modal title="خصم على الطلب" onClose={onClose} footer={
      <>
        {order.discount > 0 && <button className="btn btn-danger-ghost" onClick={() => save(0)} disabled={busy}>إزالة الخصم</button>}
        <button className="btn btn-primary" onClick={() => save(Number(value) || 0)} disabled={busy}>تطبيق</button>
      </>
    }>
      <div className="seg" role="radiogroup">
        <button className={type === 'percent' ? 'active' : ''} onClick={() => setType('percent')}>نسبة %</button>
        <button className={type === 'amount' ? 'active' : ''} onClick={() => setType('amount')}>مبلغ</button>
      </div>
      <Field label={type === 'percent' ? 'النسبة' : 'المبلغ'}>
        <input type="number" min="0" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </Field>
      {type === 'percent' && (
        <div className="quick-amounts">{[5, 10, 15, 20, 25, 50].map((p) => <button key={p} className="btn" onClick={() => setValue(p)}>{p}%</button>)}</div>
      )}
    </Modal>
  );
}
