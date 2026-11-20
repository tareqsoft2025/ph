import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Printer, Plus, Copy, Check, CircleCheckBig, Ban, Armchair, ShoppingBag, Bike, Building2, QrCode, Clock, Users, UserRound, Phone, MapPin, Banknote,
  ReceiptText, Hourglass, CircleAlert, CircleX, StickyNote, Timer, Wallet, Landmark, Smartphone, CreditCard, ExternalLink,
} from 'lucide-react';
import { useApp, useMoney, has, ORDER_TYPES, PAY_METHODS, ROLE_LABELS, ITEM_STATUS, timeOf, clockOf, spanOf } from '../lib.jsx';
import { EVENT, stagesOf } from '../components/OrderTimeline.jsx';

const TYPE_ICON = { dine_in: Armchair, takeaway: ShoppingBag, delivery: Bike };
const PAY_ICON = { cash: Banknote, card: CreditCard, wallet: Wallet, bank: Landmark, jawwalpay: Smartphone };
const VERIFY = { pending: ['بانتظار التدقيق', 'warn', Hourglass], confirmed: ['وصل المبلغ', 'ok', CircleCheckBig], mismatch: ['فرق في المبلغ', 'err', CircleAlert], rejected: ['لم يصل', 'err', CircleX] };

const ms = (s) => (s ? new Date(String(s).replace(' ', 'T')).getTime() : NaN);
const mins = (a, b) => { const d = (ms(b) - ms(a)) / 60000; return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null; };
const fmtDur = (m) => (m == null ? '' : m >= 60 ? `${Math.floor(m / 60)}س ${m % 60}د` : `${m} د`);
const dayOf = (s) => (s ? new Date(String(s).replace(' ', 'T')).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' }) : '');

/**
 * ملف الطلب المنتهي (مدفوع أو ملغى): بدل شاشة الطلب نعرض المعاملة كاملة —
 * الحالة والطاولة والعميل والفاتورة والدفعات ومراحل الطلب بأزمنتها وسجل الحركات.
 */
export default function OrderDetail({ order: o, onPrint, onNew }) {
  const money = useMoney();
  const navigate = useNavigate();
  const { user } = useApp();
  const [copied, setCopied] = useState(false);
  const paid = o.status === 'paid';
  const cancelled = o.status === 'cancelled';
  const TypeIcon = o.event_name ? Building2 : TYPE_ICON[o.type] || ShoppingBag;

  const items = o.items;
  const active = items.filter((i) => i.status !== 'cancelled');
  const cancelledItems = items.filter((i) => i.status === 'cancelled');
  const totalQty = active.reduce((a, i) => a + i.qty, 0);
  const end = o.closed_at || o.events[o.events.length - 1]?.created_at;
  const total = mins(o.created_at, end);

  // مراحل الطلب مع المدة من المرحلة السابقة
  const stages = useMemo(() => {
    const st = stagesOf(o);
    const paidAt = o.events.find((e) => e.type === 'paid')?.created_at || o.closed_at;
    let prev = null;
    return st.map((s) => {
      const time = s.time || (s.k === 'served' && s.done ? paidAt : null);
      const gap = time && prev ? mins(prev, time) : null;
      if (time) prev = time;
      return { ...s, time, gap };
    });
  }, [o]);
  const cancelEvent = o.events.find((e) => e.type === 'cancelled');
  const cancelUser = cancelEvent?.user_name;

  const copy = async () => { try { await navigator.clipboard.writeText(o.code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ } };
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/orders'));
  const sourceLabel = o.source === 'online' ? (o.event_name ? 'طلب من QR المؤسسة' : 'طلب الزبون عبر QR') : 'طلب الموظف';

  return (
    <div className="od">
      <div className="od-bar">
        <button className="btn btn-ghost" onClick={back}><ArrowRight size={17} /> رجوع</button>
        <div className="od-bar-act">
          <button className="btn" onClick={copy}>{copied ? <><Check size={16} /> تم النسخ</> : <><Copy size={16} /> نسخ الكود</>}</button>
          <button className="btn" onClick={() => onPrint(o)}><Printer size={16} /> طباعة الفاتورة</button>
          {o.type === 'dine_in' && o.table_id && has(user, 'pos.create') && <Link className="btn" to={`/pos?type=dine_in&table=${o.table_id}`}><Armchair size={16} /> طلب جديد على {o.table_name}</Link>}
          <button className="btn btn-primary" onClick={onNew}><Plus size={16} /> طلب جديد</button>
        </div>
      </div>

      {/* ───── الغلاف: الحالة والمعاملة ───── */}
      <header className={`od-hero ${cancelled ? 'is-cancelled' : 'is-paid'}`}>
        <span className="od-seal" aria-hidden>{cancelled ? <Ban size={34} strokeWidth={1.8} /> : <CircleCheckBig size={34} strokeWidth={1.8} />}</span>
        <div className="od-hero-main">
          <span className="od-state">{cancelled ? 'طلب ملغى' : 'طلب منفَّذ ومُغلق'}</span>
          <h1 dir="ltr">{o.code}</h1>
          <div className="od-where">
            <span><TypeIcon size={15} aria-hidden /> {o.event_name ? `${o.event_name}${o.place ? ` · ${o.place}` : ''}` : `${ORDER_TYPES[o.type]}${o.table_name ? ` · ${o.table_name}` : ''}`}</span>
            {o.guests ? <span><Users size={15} aria-hidden /> {o.guests} أشخاص</span> : null}
            <span>{o.source === 'online' ? <QrCode size={15} aria-hidden /> : <UserRound size={15} aria-hidden />} {sourceLabel}</span>
            <span><Clock size={15} aria-hidden /> {dayOf(o.created_at)} · {timeOf(o.created_at)}</span>
          </div>
        </div>
        <div className="od-hero-total">
          <span>{cancelled ? 'قيمة الطلب الملغى' : 'الإجمالي المدفوع'}</span>
          <strong className={cancelled ? 'struck' : ''}>{money(cancelled ? o.total : o.paid || o.total)}</strong>
          <small>{totalQty} صنف{total != null ? ` · استغرق ${fmtDur(total)}` : ''}</small>
        </div>
      </header>

      {cancelled && (
        <div className="od-cancel" role="note">
          <Ban size={18} aria-hidden />
          <div><strong>سبب الإلغاء</strong><span>{o.cancel_reason || cancelEvent?.message || 'لم يُذكر سبب'}{cancelUser ? ` · بواسطة ${cancelUser}` : ''}</span></div>
        </div>
      )}

      {/* ───── مراحل الطلب بأزمنتها ───── */}
      {!cancelled && (
        <section className="od-card od-journey" aria-label="مراحل الطلب">
          <header><h3><Timer size={16} aria-hidden /> رحلة الطلب</h3>{total != null && <span className="od-total-time">من الإنشاء إلى الدفع <b>{fmtDur(total)}</b></span>}</header>
          <ol className="od-stages">
            {stages.map((s, i) => (
              <li key={s.k} className={s.done ? 'done' : ''}>
                {i > 0 && s.gap > 0 && s.done && <span className="od-gap">+{fmtDur(s.gap)}</span>}
                <span className="od-node" aria-hidden>{s.done ? <Check size={15} strokeWidth={3} /> : i + 1}</span>
                <strong>{s.label}</strong>
                <time dir="ltr">{s.time ? clockOf(s.time) : s.done ? '—' : ''}</time>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="od-grid">
        <div className="od-col">
          {/* ───── الفاتورة ───── */}
          <section className="od-card od-paper" aria-label="الفاتورة">
            <header><h3><ReceiptText size={16} aria-hidden /> الفاتورة</h3><span className="muted small">{active.length} بند</span></header>
            <ul className="od-lines">
              {active.map((i) => (
                <li key={i.id}>
                  <span className="q">{i.qty}×</span>
                  <span className="n"><strong>{i.name}</strong>
                    {i.modifiers.length > 0 && <small>{i.modifiers.map((m) => m.name).join('، ')}</small>}
                    {i.notes && <small className="note"><StickyNote size={12} aria-hidden /> {i.notes}</small>}
                  </span>
                  <i className="lead" aria-hidden />
                  <span className="p">{money(i.price * i.qty)}</span>
                </li>
              ))}
              {cancelledItems.map((i) => (
                <li key={i.id} className="gone">
                  <span className="q">{i.qty}×</span><span className="n"><strong>{i.name}</strong><small>{ITEM_STATUS.cancelled}</small></span><i className="lead" aria-hidden /><span className="p">{money(i.price * i.qty)}</span>
                </li>
              ))}
            </ul>
            <dl className="od-sum">
              <div><dt>المجموع</dt><dd>{money(o.subtotal)}</dd></div>
              {o.discount > 0 && <div className="minus"><dt>الخصم</dt><dd>− {money(o.discount)}</dd></div>}
              {o.service > 0 && <div><dt>رسوم الخدمة</dt><dd>{money(o.service)}</dd></div>}
              {o.delivery_fee > 0 && <div><dt>رسوم التوصيل</dt><dd>{money(o.delivery_fee)}</dd></div>}
              <div><dt>الضريبة</dt><dd>{money(o.tax)}</dd></div>
              <div className="grand"><dt>الإجمالي</dt><dd>{money(o.total)}</dd></div>
            </dl>
          </section>

          {/* ───── الدفعات ───── */}
          {o.payments.length > 0 && (
            <section className="od-card" aria-label="الدفعات">
              <header><h3><Banknote size={16} aria-hidden /> الدفعات</h3><span className="muted small">{o.payments.length} دفعة</span></header>
              <ul className="od-pays">
                {o.payments.map((p) => {
                  const PI = PAY_ICON[p.method] || Banknote;
                  const v = p.verify_status ? VERIFY[p.verify_status] : null;
                  const VI = v?.[2];
                  return (
                    <li key={p.id}>
                      <span className="ic"><PI size={17} aria-hidden /></span>
                      <div className="tx">
                        <strong>{PAY_METHODS[p.method] || p.method}</strong>
                        <small className="muted">{timeOf(p.created_at)}{p.user_name ? ` · ${p.user_name}` : ''}{p.reference ? <> · <bdi dir="ltr">{p.reference}</bdi></> : null}{p.payer_name ? ` · ${p.payer_name}` : ''}</small>
                      </div>
                      {v && (has(user, 'transfers.audit')
                        ? <Link to="/transfers" className={`badge badge-${v[1]}`}><VI size={12} aria-hidden /> {v[0]} <ExternalLink size={11} aria-hidden /></Link>
                        : <span className={`badge badge-${v[1]}`}><VI size={12} aria-hidden /> {v[0]}</span>)}
                      <b>{money(p.amount)}</b>
                    </li>
                  );
                })}
              </ul>
              {paid && o.paid > o.total && <p className="muted small">المدفوع يزيد عن الإجمالي بـ {money(o.paid - o.total)} (الباقي للعميل).</p>}
            </section>
          )}
        </div>

        <aside className="od-col">
          {/* ───── من وأين ───── */}
          <section className="od-card" aria-label="بيانات المعاملة">
            <header><h3>بيانات المعاملة</h3></header>
            <dl className="od-facts">
              <div><dt><TypeIcon size={14} aria-hidden /> الطاولة / النوع</dt><dd>{o.event_name ? `${o.event_name}${o.place ? ` · ${o.place}` : ''}` : `${ORDER_TYPES[o.type]}${o.table_name ? ` · ${o.table_name}` : ''}`}</dd></div>
              <div><dt><UserRound size={14} aria-hidden /> العميل</dt><dd>{o.customer_name || '—'}</dd></div>
              {o.customer_phone && <div><dt><Phone size={14} aria-hidden /> الجوال</dt><dd><a href={`tel:${o.customer_phone}`} dir="ltr">{o.customer_phone}</a></dd></div>}
              {o.address && <div><dt><MapPin size={14} aria-hidden /> العنوان</dt><dd>{o.address}</dd></div>}
              <div><dt><UserRound size={14} aria-hidden /> الموظف المسؤول</dt><dd>{o.waiter_name || '—'}</dd></div>
              {o.cashier_name && <div><dt><Banknote size={14} aria-hidden /> الكاشير</dt><dd>{o.cashier_name}</dd></div>}
              <div><dt><Clock size={14} aria-hidden /> الإنشاء</dt><dd dir="ltr">{String(o.created_at).slice(0, 16)}</dd></div>
              {end && <div><dt><Clock size={14} aria-hidden /> {cancelled ? 'الإلغاء' : 'الإغلاق'}</dt><dd dir="ltr">{String(end).slice(0, 16)}</dd></div>}
              {o.notes && <div><dt><StickyNote size={14} aria-hidden /> ملاحظات</dt><dd>{o.notes}</dd></div>}
            </dl>
          </section>

          {/* ───── سجل الحركات ───── */}
          <section className="od-card" aria-label="سجل حركات الطلب">
            <header><h3>تسلسل العملية</h3><span className="muted small">{o.events.length} حركة · من {String(o.events[0]?.created_at || '').slice(0, 19)} إلى {String(o.events[o.events.length - 1]?.created_at || '').slice(11, 19)}</span></header>
            <ol className="od-tl">
              {o.events.map((e, i) => {
                const [Icon, label] = EVENT[e.type] || [ReceiptText, e.type];
                return (
                  <li key={e.id} className={`ev-${e.type}`}>
                    <span className="dot" aria-hidden><Icon size={14} /></span>
                    <div>
                      <div className="top"><strong>{label}</strong><time dir="ltr" title={e.created_at}>{clockOf(e.created_at)}</time></div>
                      {e.type === 'payment' && e.data ? <span>{PAY_METHODS[e.data.method]} · {money(e.data.amount)}</span> : e.message ? <span>{e.message}</span> : null}
                      {e.type === 'sent' && e.data?.items && <small className="muted">{e.data.items.map((x) => `${x.qty}× ${x.name}`).join('، ')}</small>}
                      <small className="muted">{e.user_name ? `${e.user_name}${e.user_role ? ` · ${ROLE_LABELS[e.user_role] || ''}` : ''}` : o.source === 'online' ? 'الزبون' : ''}</small>
                      {i > 0 && <small className="od-since">+{spanOf(o.events[0].created_at, e.created_at)} من البداية · بعد {spanOf(o.events[i - 1].created_at, e.created_at)}</small>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
