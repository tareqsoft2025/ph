import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import {
  useApp, useData, useMoney, useAction, useToast, has, Modal, Field, Empty, Loading,
  ORDER_TYPES, ITEM_STATUS, PAY_METHODS,
} from '../lib.jsx';
import Receipt from '../components/Receipt.jsx';
import OrderTimeline from '../components/OrderTimeline.jsx';
import ConfirmBanner from '../components/ConfirmBanner.jsx';
import DishDetail, { hasDetail } from '../components/DishDetail.jsx';
import TableHero, { AnimatedMoney } from '../components/TableHero.jsx';
import { PayModal, DiscountModal } from '../components/PaymentModals.jsx';
import { Search, Utensils, SlidersHorizontal, ChefHat, Plus, StickyNote, ShoppingBag, Flame, CheckCheck, Printer, CreditCard, TriangleAlert, X, History, Minus, UserRound, Phone, MapPin, ReceiptText, ChevronUp, Info, Percent, ArrowLeftRight, Ban } from 'lucide-react';

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
    type: ['dine_in', 'takeaway', 'delivery'].includes(params.get('type')) ? params.get('type') : (params.get('table') ? 'dine_in' : ''),
    table_id: params.get('table') ? Number(params.get('table')) : '',
    customer_name: '', customer_phone: '', address: '', guests: params.get('table') ? 2 : '', notes: '',
  });
  const [tried, setTried] = useState(false);
  const submitted = useRef(false); // بعد إنشاء الطلب لا نعيد التوجيه لطلب الطاولة
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [totalsOpen, setTotalsOpen] = useState(false);
  const [bump, setBump] = useState(0);
  const [metaEdit, setMetaEdit] = useState(false);
  const [infoItem, setInfoItem] = useState(null);
  const linesRef = useRef(null);
  const lastAdded = useRef(null);

  // التحقق من بيانات العميل حسب نوع الطلب
  const metaErrors = {};
  if (meta.type === 'dine_in') {
    if (!meta.table_id) metaErrors.table_id = 'اختر الطاولة';
    if (!(Number(meta.guests) >= 1)) metaErrors.guests = 'أدخل عدد الأشخاص';
  }
  if (!meta.customer_name.trim()) metaErrors.customer_name = 'اسم العميل مطلوب';
  if (!meta.customer_phone.trim()) metaErrors.customer_phone = 'رقم الجوال مطلوب';
  else if (!/^\+?[0-9\s-]{7,15}$/.test(meta.customer_phone.trim())) metaErrors.customer_phone = 'رقم الجوال غير صحيح';
  if (meta.type === 'delivery' && !meta.address.trim()) metaErrors.address = 'عنوان التوصيل مطلوب';
  const metaValid = Object.keys(metaErrors).length === 0;
  const err = (k) => (tried ? metaErrors[k] : null);

  useEffect(() => { setDraft([]); }, [orderId]);
  // سياق جديد (طاولة أخرى أو تيك وي/توصيل): نبدأ ببيانات نظيفة
  const ctxKey = params.toString();
  useEffect(() => {
    if (orderId) return;
    submitted.current = false;
    setTried(false);
    setDraft([]);
    setMeta({
      type: ['dine_in', 'takeaway', 'delivery'].includes(params.get('type')) ? params.get('type') : (params.get('table') ? 'dine_in' : ''),
      table_id: params.get('table') ? Number(params.get('table')) : '',
      customer_name: '', customer_phone: '', address: '', guests: params.get('table') ? 2 : '', notes: '',
    });
  }, [ctxKey]); // eslint-disable-line
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
  const canPay = has(user, 'payments.collect');
  const canEdit = has(user, 'pos.create');
  const canDiscount = has(user, 'orders.discount');
  const canCancel = has(user, 'orders.cancel');
  const canCancelItem = has(user, 'orders.cancel_item');

  const decItem = (id) => setDraft((d) => {
    const i = d.findLastIndex((x) => x.item_id === id);
    if (i < 0) return d;
    return d[i].qty <= 1 ? d.filter((_, k) => k !== i) : d.map((x, k) => (k === i ? { ...x, qty: x.qty - 1 } : x));
  });

  function addToDraft(item, { modifiers = [], qty = 1, notes = '' } = {}) {
    if (!item.available) return toast('هذا الصنف غير متوفر حالياً', 'err');
    setBump((b) => b + 1);
    const unit = item.price + modifiers.reduce((a, m) => a + m.price, 0);
    setDraft((d) => {
      const key = `${item.id}|${modifiers.map((m) => m.id).sort().join(',')}|${notes}`;
      const ex = d.find((x) => x.key === key);
      if (ex) return d.map((x) => (x === ex ? { ...x, qty: x.qty + qty } : x));
      return [...d, { key, uid: draftSeq++, item_id: item.id, name: item.name, unit, qty, modifiers, notes }];
    });
  }

  // نقطة تطير من الطبق إلى السلة (أو زر السلة في الجوال) لتأكيد الإضافة بصرياً
  function fly(el, art) {
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !el?.animate) return;
      const fab = document.querySelector('.cart-fab');
      const target = fab && getComputedStyle(fab).display !== 'none' ? fab : linesRef.current;
      if (!target) return;
      const a = el.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const dot = document.createElement('div');
      dot.className = 'fly-dot';
      dot.textContent = art && !/^(https?:|data:)/.test(art) ? art : '';
      dot.style.left = `${a.left + a.width / 2 - 20}px`;
      dot.style.top = `${a.top + a.height / 2 - 20}px`;
      document.body.appendChild(dot);
      const dx = b.left + Math.min(b.width / 2, 60) - (a.left + a.width / 2);
      const dy = b.top + Math.min(b.height / 2, 80) - (a.top + a.height / 2);
      const anim = dot.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(.9)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(.3)`, opacity: 0.2 },
      ], { duration: 620, easing: 'cubic-bezier(.45,.05,.3,1)' });
      anim.onfinish = () => dot.remove();
    } catch { /* الحركة اختيارية */ }
  }

  function onItemClick(item, el, art) {
    if (item.modifiers?.length) setPicking(item);
    else { addToDraft(item); fly(el, art); }
  }

  // السطر الجديد يظهر دائماً: نمرّر قائمة الأسطر إلى آخر سطر مضاف
  useEffect(() => {
    const box = linesRef.current;
    if (!box || !draft.length) return;
    const last = draft[draft.length - 1];
    if (lastAdded.current === last.uid) return;
    lastAdded.current = last.uid;
    requestAnimationFrame(() => box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }));
  }, [draft]);

  const draftPayload = () => draft.map((d) => ({ item_id: d.item_id, qty: d.qty, notes: d.notes, modifier_ids: d.modifiers.map((m) => m.id) }));

  async function submit({ send, thenPay }) {
    const r = await run(async () => {
      if (order) {
        if (draft.length) return api(`/orders/${order.id}/items`, { method: 'POST', body: { items: draftPayload(), send } });
        if (send) return api(`/orders/${order.id}/send`, { method: 'POST' });
        return order;
      }
      if (!draft.length) throw new Error('أضف أصنافاً للطلب');
      if (!metaValid) {
        setTried(true);
        setCartOpen(true);
        throw new Error(Object.values(metaErrors)[0]);
      }
      return api('/orders', { method: 'POST', body: { ...meta, table_id: meta.table_id || null, guests: Number(meta.guests) || null, items: draftPayload(), send } });
    }, send ? 'تم الإرسال للمطبخ' : 'تم الحفظ');
    if (!r) return;
    submitted.current = true;
    setDraft([]);
    setCartOpen(false);
    setTried(false);
    // النادل يعود للطاولات بعد الإرسال
    if (send && !canPay && !thenPay) { navigate('/tables'); return; }
    if (!order) navigate(`/pos/${r.id}`, { replace: true });
    else orderQ.setData(r);
    if (thenPay) setPaying(true);
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

  async function requestBill() {
    const r = await run(() => api(`/orders/${order.id}/request-bill`, { method: 'POST' }), 'تم إبلاغ الكاشير بطلب الحساب');
    if (r) orderQ.setData(r);
  }

  async function serveReady() {
    const r = await run(() => api(`/orders/${order.id}/serve`, { method: 'POST' }), 'تم التقديم');
    if (r) orderQ.setData(r);
  }

  function newOrder() {
    setDraft([]);
    navigate('/tables');
  }

  if (menu.loading || (orderId && orderQ.loading && !order)) return <Loading />;
  if (!orderId && !canEdit) return <Navigate to={canPay ? '/cashier' : '/tables'} replace />;
  if (orderId && orderQ.error) return <Empty icon={TriangleAlert} text={orderQ.error} />;

  // لا توجد شاشة طلب عامة: يجب الدخول من طاولة (أو طلب تيك وي/توصيل من صفحة الطاولات)
  if (!orderId && (!meta.type || (meta.type === 'dine_in' && !meta.table_id))) return <Navigate to="/tables" replace />;
  const ctxTable = (tables.data || []).find((t) => t.id === (order?.table_id || meta.table_id));
  // الطاولة مشغولة بطلب مفتوح: افتح ذلك الطلب مباشرة
  if (!orderId && !submitted.current && meta.type === 'dine_in' && ctxTable?.order_id) return <Navigate to={`/pos/${ctxTable.order_id}`} replace />;
  const ctxType = order?.type || meta.type;

  const pendingCount = order?.items.filter((i) => i.status === 'pending').length || 0;
  const readyCount = order?.items.filter((i) => i.status === 'ready').length || 0;
  const cartCount = draft.reduce((a, d) => a + d.qty, 0) + (order?.items.filter((i) => i.status !== 'cancelled').length || 0);

  return (
    <div className="pos-page">
    <TableHero
      type={ctxType}
      table={ctxTable}
      order={order}
      guests={meta.guests}
      onGuests={!order && ctxType === 'dine_in' ? (n) => setMeta((m) => ({ ...m, guests: n })) : undefined}
      guestsError={err('guests')}
      customer={{ name: meta.customer_name, phone: meta.customer_phone, address: meta.address }}
      onBack={() => navigate('/tables')}
    />
    <div className="pos">
      {/* ───── قائمة الأصناف ───── */}
      <section className="pos-menu">
        <div className="menu-bar">
          <label className="menu-search">
            <Search size={18} aria-hidden />
            <input type="search" placeholder="ابحث عن طبق…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
          </label>
        </div>

        <nav className="cat-tabs" role="tablist" aria-label="الفئات">
          {menu.data.categories.map((c) => (
            <button key={c.id} role="tab" aria-selected={!q && cat === c.id} className={`cat-tab ${!q && cat === c.id ? 'active' : ''}`} onClick={() => { setQ(''); setCat(c.id); }}>
              <span>{c.name}</span>
            </button>
          ))}
        </nav>

        <div className="menu-scroll">
          <div className="menu-section-head">
            <h2>{q ? `نتائج البحث عن «${q}»` : currentCat?.name}</h2>
            <span className="menu-count">{items.length} {items.length === 1 ? 'طبق' : 'أطباق'}</span>
          </div>

          <div className="dish-grid">
            {items.map((it) => {
              const inCart = draft.filter((d) => d.item_id === it.id).reduce((a, d) => a + d.qty, 0);
              const art = it.image || catIcon[it.category_id] || '';
              return (
                <div key={it.id} className="dish-cell">
                  <button className={`dish st-${it.station} ${it.available ? '' : 'unavailable'} ${inCart ? 'in-cart' : ''}`}
                    onClick={(e) => isOpen && canEdit && onItemClick(it, e.currentTarget, art)} disabled={!isOpen || !canEdit}
                    aria-label={`${it.name}، ${money(it.price)}${it.available ? '' : '، غير متوفر'}`}>
                    <span className="dish-art" aria-hidden>
                      {/^(https?:|data:)/.test(art) ? <img src={art} alt="" loading="lazy" /> : art ? <span className="dish-emoji">{art}</span> : <Utensils size={26} strokeWidth={1.5} />}
                    </span>
                    <span className="dish-body">
                      <span className="dish-name">{it.name}</span>
                      {it.modifiers?.length > 0 && <span className="dish-opts"><SlidersHorizontal size={12} aria-hidden /> {it.modifiers.length} خيارات</span>}
                      <span className="dish-foot">
                        <span className="dish-price"><b>{price(it.price)}</b> <small>{settings?.currency}</small></span>
                        <span className="dish-add" aria-hidden><Plus size={16} strokeWidth={2.6} /></span>
                      </span>
                    </span>
                    {!it.available && <span className="dish-flag">نفد اليوم</span>}
                    {inCart > 0 && <span key={inCart} className="dish-qty">{inCart}</span>}
                  </button>
                  {hasDetail(it) && <button className="dish-info" onClick={() => setInfoItem(it)} aria-label={`تفاصيل ${it.name}`}><Info size={14} strokeWidth={2.4} /></button>}
                  {inCart > 0 && isOpen && <button className="dish-minus" onClick={() => decItem(it.id)} aria-label={`إنقاص ${it.name}`}><Minus size={14} strokeWidth={2.6} /></button>}
                </div>
              );
            })}
          </div>
          {!items.length && <Empty icon={Utensils} text="لا توجد أطباق" />}
        </div>
      </section>

      {/* ───── السلة ───── */}
      <section className={`pos-cart ticket ${cartOpen ? 'open' : ''}`}>
        <div className="cart-head">
          {order ? (
            <>
              <div className="cart-id">
                <span className="tk-kicker"><ReceiptText size={13} aria-hidden /> الطلب <span className="order-code" dir="ltr">{order.code}</span></span>
                <h2 className="tk-title">{order.event_name ? order.event_name : order.table_name || ORDER_TYPES[order.type]}</h2>
                <span className="tk-sub">{order.event_name ? `${order.place || 'مؤسسة'}` : ORDER_TYPES[order.type]}{order.guests ? ` · ${order.guests} أشخاص` : ''}{order.customer_name ? ` · ${order.customer_name}` : ''}{order.customer_phone ? <> · <bdi dir="ltr">{order.customer_phone}</bdi></> : null}</span>
              </div>
              <div className="row gap-s">
                {order.status !== 'open' && <span className={`badge ${order.status === 'paid' ? 'badge-ok' : 'badge-err'}`}>{order.status === 'paid' ? 'مدفوع' : 'ملغى'}</span>}
                <button className="btn btn-sm" onClick={() => setTimelineOpen(true)}><History size={16} /> التفاصيل</button>
                <button className="btn btn-ghost btn-sm" onClick={newOrder} aria-label="طلب جديد"><Plus size={16} /></button>
                <button className="icon-btn cart-close" onClick={() => setCartOpen(false)} aria-label="إغلاق"><X size={20} /></button>
              </div>
            </>
          ) : (
            <>
              <div className="cart-id">
                <span className="tk-kicker"><ReceiptText size={13} aria-hidden /> طلب جديد</span>
                <h2 className="tk-title">{ctxType === 'dine_in' ? (ctxTable?.name || 'طاولة') : ORDER_TYPES[ctxType]}</h2>
                <span className="tk-sub">{ctxType === 'dine_in' ? `${meta.guests || 0} أشخاص${ctxTable?.area ? ` · ${ctxTable.area}` : ''}` : 'يُرسل للمطبخ بعد إدخال بيانات العميل'}</span>
              </div>
              <button className="icon-btn cart-close" onClick={() => setCartOpen(false)} aria-label="إغلاق"><X size={20} /></button>
            </>
          )}
        </div>

        {!order && metaValid && !metaEdit && draft.length > 0 && (
          <button type="button" className="cart-meta-sum" onClick={() => setMetaEdit(true)} aria-label="تعديل بيانات العميل">
            <UserRound size={14} aria-hidden /> <b>{meta.customer_name}</b> <bdi dir="ltr">{meta.customer_phone}</bdi>
            {meta.type === 'delivery' && meta.address && <span className="muted"> · {meta.address}</span>}
            <span className="cms-edit">تعديل</span>
          </button>
        )}
        {!order && (!metaValid || metaEdit || !draft.length) && (
          <div className="cart-meta">
            <div className="grid-2">
              <label className={`cfield ${err('customer_name') ? 'invalid' : ''}`}>
                <span className="cfield-label"><UserRound size={14} aria-hidden /> اسم العميل *</span>
                <input placeholder="اسم العميل *" value={meta.customer_name} onChange={(e) => setMeta({ ...meta, customer_name: e.target.value })} autoComplete="off" aria-invalid={!!err('customer_name')} />
                {err('customer_name') && <span className="cfield-err">{err('customer_name')}</span>}
              </label>
              <label className={`cfield ${err('customer_phone') ? 'invalid' : ''}`}>
                <span className="cfield-label"><Phone size={14} aria-hidden /> رقم الجوال *</span>
                <input inputMode="tel" dir="ltr" placeholder="رقم الجوال *" value={meta.customer_phone} onChange={(e) => setMeta({ ...meta, customer_phone: e.target.value })} autoComplete="off" aria-invalid={!!err('customer_phone')} />
                {err('customer_phone') && <span className="cfield-err">{err('customer_phone')}</span>}
              </label>
            </div>
            {meta.type === 'delivery' && (
              <label className={`cfield ${err('address') ? 'invalid' : ''}`}>
                <span className="cfield-label"><MapPin size={14} aria-hidden /> عنوان التوصيل *</span>
                <input placeholder="عنوان التوصيل *" value={meta.address} onChange={(e) => setMeta({ ...meta, address: e.target.value })} aria-invalid={!!err('address')} />
                {err('address') && <span className="cfield-err">{err('address')}</span>}
              </label>
            )}
          </div>
        )}

        {order && isOpen && has(user, 'pos.create') && order.waiter_id !== user.id && (!order.waiter_id || has(user, 'orders.view')) && (
          <div className="claim-bar">
            <span><UserRound size={15} aria-hidden /> {order.waiter_name ? `الطلب على حساب ${order.waiter_name}` : 'هذا الطلب غير مستلم'}</span>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={async () => { const r = await run(() => api(`/orders/${order.id}/claim`, { method: 'POST' }), 'أصبح الطلب على حسابك'); if (r) orderQ.setData(r); }}>{order.waiter_name ? 'نقله إلي' : 'استلام الطلب على حسابي'}</button>
          </div>
        )}
        {order && <ConfirmBanner order={order} onChanged={(r) => (r.status === 'cancelled' ? navigate('/tables') : orderQ.setData(r))} />}
        <div className="cart-lines" ref={linesRef}>
          {draft.length > 0 && (
            <>
              <div className="divider divider-new"><Flame size={12} aria-hidden /> {order ? 'إضافات جديدة' : 'الطلب'} · لم يُرسل</div>
              {draft.map((d) => (
                <div key={d.uid} className="line line-draft">
                  <div className="line-main">
                    <div className="qty-ctl">
                      <button className="btn btn-xs" onClick={() => setDraft((x) => (d.qty <= 1 ? x.filter((y) => y.uid !== d.uid) : x.map((y) => (y.uid === d.uid ? { ...y, qty: y.qty - 1 } : y))))} aria-label="إنقاص">−</button>
                      <span>{d.qty}</span>
                      <button className="btn btn-xs" onClick={() => setDraft((x) => x.map((y) => (y.uid === d.uid ? { ...y, qty: y.qty + 1 } : y)))} aria-label="زيادة">+</button>
                    </div>
                    <div className="line-text">
                      <strong>{d.name}</strong>
                      {d.modifiers.length > 0 && <small>{d.modifiers.map((m) => m.name).join('، ')}</small>}
                      {d.notes && <small className="note"><StickyNote size={13} aria-hidden /> {d.notes}</small>}
                    </div>
                    <i className="tk-lead" aria-hidden />
                    <span className="line-price">{money(d.unit * d.qty)}</span>
                  </div>
                </div>
              ))}
            </>
          )}
          {order?.items.length > 0 && draft.length > 0 && <div className="divider"><ChefHat size={12} aria-hidden /> في الطلب</div>}
          {order?.items.map((l) => (
            <div key={l.id} className={`line line-st-${l.status} ${l.status === 'cancelled' ? 'line-cancelled' : ''}`}>
              <div className="line-main">
                <span className="line-qty">{l.qty}×</span>
                <div className="line-text">
                  <strong>{l.name}</strong>
                  {l.modifiers.length > 0 && <small>{l.modifiers.map((m) => m.name).join('، ')}</small>}
                  {l.notes && <small className="note"><StickyNote size={13} aria-hidden /> {l.notes}</small>}
                </div>
                <i className="tk-lead" aria-hidden />
                <span className="line-price">{money(l.price * l.qty)}</span>
              </div>
              <div className="line-foot">
                <span className={`status status-${l.status}`}><i className="st-dot" aria-hidden />{ITEM_STATUS[l.status]}</span>
                <span className="row gap-s">
                  {isOpen && l.status === 'pending' && (
                    <span className="qty-ctl">
                      <button className="btn btn-xs" onClick={() => lineAction(l, { qty: l.qty - 1 })} disabled={l.qty <= 1 || busy} aria-label="إنقاص">−</button>
                      <button className="btn btn-xs" onClick={() => lineAction(l, { qty: l.qty + 1 })} disabled={busy} aria-label="زيادة">+</button>
                    </span>
                  )}
                  {isOpen && l.status !== 'cancelled' && l.status !== 'served' && (l.status === 'pending' ? canEdit : canCancelItem) && (
                    <button className="btn btn-xs btn-danger-ghost" onClick={() => lineAction(l, { cancel: true })} disabled={busy}>إلغاء</button>
                  )}
                </span>
              </div>
            </div>
          ))}
          {!order?.items.length && !draft.length && (
            <div className="tk-empty"><span className="tk-empty-ico" aria-hidden><ShoppingBag size={26} /></span><strong>اختر الأصناف من القائمة</strong><small>اضغط على أي طبق وسيظهر هنا كسطر في الإيصال</small></div>
          )}
        </div>

        <div className="cart-foot">
        <div className={`cart-totals ${totalsOpen ? 'open' : ''}`}>
          {cartCount > 0 && <div className="tk-count"><span>عدد الأصناف</span><b>{cartCount}</b></div>}
          {order ? (
            <>
              <div className="tot-details">
                <Row k="المجموع" v={money(order.subtotal)} />
                {order.discount > 0 && <Row k="الخصم" v={`− ${money(order.discount)}`} />}
                {order.service > 0 && <Row k="رسوم الخدمة" v={money(order.service)} />}
                {order.delivery_fee > 0 && <Row k="رسوم التوصيل" v={money(order.delivery_fee)} />}
                <Row k="الضريبة" v={money(order.tax)} />
                {order.paid > 0 && <Row k="المدفوع" v={money(order.paid)} />}
              </div>
              <button type="button" className="tot-toggle" onClick={() => setTotalsOpen((o) => !o)} aria-expanded={totalsOpen}>
                <span>الإجمالي <ChevronUp size={14} aria-hidden className="chev" /></span>
                <strong key={bump}><AnimatedMoney value={order.total} /></strong>
              </button>
              {draft.length > 0 && <Row k="إضافات غير محفوظة" v={money(draftTotal)} />}
            </>
          ) : (
            <Row k="المجموع (قبل الضريبة)" v={<AnimatedMoney value={draftTotal} />} big />
          )}
        </div>

        {isOpen && (
          <div className="cart-actions">
            {canEdit && (draft.length > 0 || pendingCount > 0) && (
              <div className="act-main">
                <button className="btn btn-primary btn-lg" onClick={() => submit({ send: true })} disabled={busy}><Flame size={19} /> إرسال للمطبخ</button>
                <button className="btn btn-lg" onClick={() => submit({ send: false })} disabled={busy || !draft.length}>حفظ</button>
              </div>
            )}
            {order && readyCount > 0 && <button className="btn btn-ok btn-block" onClick={serveReady} disabled={busy}><CheckCheck size={18} /> تقديم ({readyCount})</button>}
            {canPay && (order || draft.length > 0) && (
              <button className="btn btn-ok btn-lg btn-block" disabled={busy} onClick={() => (draft.length || !order ? submit({ send: true, thenPay: true }) : setPaying(true))}>
                <CreditCard size={19} /> الدفع {order ? `(${money(order.total - order.paid + (draft.length ? draftTotal : 0))})` : ''}
              </button>
            )}
            {order && (
              <div className="act-tools">
                {!canPay && canEdit && (
                  <button className={`btn ${order.bill_requested_at ? '' : 'btn-primary'}`} onClick={requestBill} disabled={busy || !!order.bill_requested_at}>
                    <ReceiptText size={17} /> {order.bill_requested_at ? 'طُلب الحساب' : 'طلب الحساب'}
                  </button>
                )}
                {canDiscount && <button className="btn btn-tool" onClick={() => setDiscountOpen(true)} title="خصم" aria-label="خصم"><Percent size={17} /><span>خصم</span></button>}
                {order.type === 'dine_in' && has(user, 'orders.move') && <button className="btn btn-tool" onClick={() => setMoveOpen(true)} title="نقل طاولة" aria-label="نقل طاولة"><ArrowLeftRight size={17} /><span>نقل</span></button>}
                <button className="btn btn-tool" onClick={() => setPrintOrder(order)} title="طباعة" aria-label="طباعة"><Printer size={17} /><span>طباعة</span></button>
                {canCancel && <button className="btn btn-tool btn-danger-ghost" onClick={cancelOrder} disabled={busy || order.paid > 0} title="إلغاء الطلب" aria-label="إلغاء الطلب"><Ban size={17} /><span>إلغاء</span></button>}
              </div>
            )}
          </div>
        )}
        {order && !isOpen && (
          <div className="cart-actions">
            <button className="btn btn-lg btn-block" onClick={() => setPrintOrder(order)}><Printer size={18} /> طباعة الفاتورة</button>
            <button className="btn btn-primary btn-lg btn-block" onClick={newOrder}><Plus size={18} /> طلب جديد</button>
          </div>
        )}
        </div>
      </section>

      <button className="cart-fab" onClick={() => setCartOpen(true)}>
        <ShoppingBag size={20} /> السلة {cartCount > 0 && <span className="fab-count">{cartCount}</span>}
        {order && <span>· {money(order.total)}</span>}
      </button>

      {infoItem && (
        <Modal title="تفاصيل الوجبة" onClose={() => setInfoItem(null)}
          footer={isOpen && canEdit && infoItem.available ? <button className="btn btn-primary btn-lg" onClick={() => { const it = infoItem; setInfoItem(null); onItemClick(it); }}><Plus size={18} /> إضافة للطلب</button> : null}>
          <DishDetail item={infoItem} price={money(infoItem.price)} art={infoItem.image || catIcon[infoItem.category_id] || ''} />
        </Modal>
      )}
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
      {timelineOpen && order && <OrderTimeline orderId={order.id} onClose={() => setTimelineOpen(false)} />}
    </div>
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
