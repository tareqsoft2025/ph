import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Armchair, ShoppingBag, Bike, Users, Clock, UserRound, Phone, MapPin, ReceiptText, Minus, Plus, Sparkles, BellRing,
} from 'lucide-react';
import { useMoney, useNow, minutesSince } from '../lib.jsx';

/** رقم يتحرك بسلاسة عند تغيّر قيمته */
export function useTween(target, ms = 380) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { from.current = target; setV(target); return undefined; }
    const a = from.current;
    if (a === target) return undefined;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const cur = a + (target - a) * (1 - (1 - p) ** 3);
      from.current = cur;
      setV(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
      else { from.current = target; setV(target); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
export function AnimatedMoney({ value }) {
  const money = useMoney();
  return <>{money(useTween(Number(value) || 0))}</>;
}

/** يحسب أماكن الكراسي حول الطاولة حسب عدد المقاعد */
function layout(seats) {
  const n = Math.max(1, Math.min(seats || 4, 12));
  const W = 260;
  const H = 200;
  const cx = W / 2;
  const cy = H / 2;
  const chairs = [];
  let table;
  if (n > 8) {
    const r = 58;
    table = { kind: 'round', cx, cy, r };
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      chairs.push({ x: cx + Math.cos(a) * (r + 26), y: cy + Math.sin(a) * (r + 26), rot: (a * 180) / Math.PI + 90 });
    }
  } else if (n > 4) {
    const top = Math.ceil(n / 2);
    const bottom = n - top;
    const w = Math.max(120, top * 42);
    table = { kind: 'rect', x: cx - w / 2, y: cy - 34, w, h: 68 };
    for (let i = 0; i < top; i++) chairs.push({ x: cx - w / 2 + (w / top) * (i + 0.5), y: cy - 34 - 22, rot: 0 });
    for (let i = 0; i < bottom; i++) chairs.push({ x: cx - w / 2 + (w / bottom) * (i + 0.5), y: cy + 34 + 22, rot: 180 });
  } else {
    const s = n <= 2 ? 70 : 92;
    table = { kind: 'rect', x: cx - s / 2, y: cy - s / 2, w: s, h: s };
    const pos = n <= 2
      ? [{ x: cx + s / 2 + 22, y: cy, rot: 90 }, { x: cx - s / 2 - 22, y: cy, rot: 270 }]
      : [{ x: cx, y: cy - s / 2 - 22, rot: 0 }, { x: cx + s / 2 + 22, y: cy, rot: 90 }, { x: cx, y: cy + s / 2 + 22, rot: 180 }, { x: cx - s / 2 - 22, y: cy, rot: 270 }];
    chairs.push(...pos.slice(0, n));
  }
  return { W, H, cx, cy, table, chairs };
}

/** رسم الطاولة والكراسي: الكراسي المضيئة = عدد الأشخاص، والنقر يحدد العدد */
export function TableArt({ seats, guests, onPick, occupied }) {
  const L = useMemo(() => layout(seats), [seats]);
  const [hover, setHover] = useState(null);
  const shown = hover ?? guests ?? 0;
  const editable = !!onPick;
  return (
    <svg className={`table-art ${occupied ? 'is-occupied' : ''}`} viewBox={`0 0 ${L.W} ${L.H}`} role="group" aria-label={`طاولة بـ ${seats} مقاعد، ${guests || 0} أشخاص`}>
      <defs>
        <radialGradient id="tblWood" cx="40%" cy="35%" r="75%">
          <stop offset="0%" stopColor="var(--ta-wood-hi)" />
          <stop offset="100%" stopColor="var(--ta-wood)" />
        </radialGradient>
      </defs>
      {L.chairs.map((c, i) => {
        const on = i < shown;
        return (
          <g
            key={i}
            className={`ta-chair ${on ? 'on' : ''} ${editable ? 'pick' : ''}`}
            transform={`translate(${c.x} ${c.y}) rotate(${c.rot})`}
            style={{ transitionDelay: `${i * 25}ms` }}
            {...(editable ? {
              role: 'button', tabIndex: 0, 'aria-label': `${i + 1} أشخاص`,
              onClick: () => onPick(i + 1), onMouseEnter: () => setHover(i + 1), onMouseLeave: () => setHover(null),
              onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i + 1); } },
            } : {})}
          >
            <rect x="-17" y="-13" width="34" height="26" rx="8" className="ta-seat" />
            <rect x="-15" y="-17" width="30" height="7" rx="3" className="ta-back" />
          </g>
        );
      })}
      {L.table.kind === 'round'
        ? <circle cx={L.table.cx} cy={L.table.cy} r={L.table.r} className="ta-table" fill="url(#tblWood)" />
        : <rect x={L.table.x} y={L.table.y} width={L.table.w} height={L.table.h} rx="14" className="ta-table" fill="url(#tblWood)" />}
      {L.chairs.slice(0, shown).map((c, i) => {
        const px = L.cx + (c.x - L.cx) * 0.62;
        const py = L.cy + (c.y - L.cy) * 0.62;
        return (
          <g key={`p${i}`} className="ta-plate" style={{ animationDelay: `${i * 40}ms` }}>
            <circle cx={px} cy={py} r="9" />
            <circle cx={px} cy={py} r="5" className="ta-plate-in" />
          </g>
        );
      })}
    </svg>
  );
}

const SEGMENTS = [
  ['served', 'تم التقديم', (i) => i.status === 'served'],
  ['ready', 'جاهز', (i) => i.status === 'ready'],
  ['kitchen', 'في المطبخ', (i) => i.status === 'new' || i.status === 'preparing'],
  ['saved', 'لم يُرسل', (i) => i.status === 'pending'],
];

/** شريط تقدّم الطلب: كم صنف قُدّم / جاهز / في المطبخ / لم يُرسل */
function Progress({ items }) {
  const seg = SEGMENTS.map(([k, label, f]) => ({ k, label, n: items.filter(f).length })).filter((s) => s.n > 0);
  if (!seg.length) return null;
  return (
    <div className="tprog" role="img" aria-label={seg.map((s) => `${s.label} ${s.n}`).join('، ')}>
      <div className="tprog-bar">{seg.map((s) => <span key={s.k} className={`seg-${s.k}`} style={{ flexGrow: s.n }} />)}</div>
      <div className="tprog-legend">{seg.map((s) => <span key={s.k}><i className={`seg-${s.k}`} /> {s.label} {s.n}</span>)}</div>
    </div>
  );
}

/**
 * لوحة الطاولة أعلى شاشة الطلب (مدمجة لتبقي مساحة للقائمة والسلة)
 */
export default function TableHero({ type, table, order, guests, onGuests, guestsError, customer = {}, onBack }) {
  useNow(30000);
  const isTable = type === 'dine_in';
  const TypeIcon = isTable ? Armchair : type === 'delivery' ? Bike : ShoppingBag;
  const items = order ? order.items.filter((i) => i.status !== 'cancelled') : [];
  const name = order?.customer_name || customer.name;
  const phone = order?.customer_phone || customer.phone;
  const g = order?.guests ?? guests;

  return (
    <header className={`thero thero-${type}`}>
      <div className="thero-glow" aria-hidden />

      <div className="thero-art">
        {isTable
          ? <TableArt seats={table?.seats || 4} guests={Number(g) || 0} onPick={onGuests} occupied={!!order} />
          : <div className="thero-icon"><TypeIcon size={40} strokeWidth={1.5} /></div>}
      </div>

      <div className="thero-info">
        <span className="thero-kicker">{isTable ? (order ? 'الطلبات الخاصة بـ' : 'طلب جديد على') : order ? 'طلب' : 'طلب جديد'}</span>
        <h1 className="thero-title">{order?.event_name ? order.event_name : isTable ? table?.name || order?.table_name || 'طاولة' : type === 'delivery' ? 'توصيل' : 'سفري'}</h1>
        <div className="thero-chips">
          {isTable && table?.area && <span className="tchip">{table.area}</span>}
          {isTable && <span className="tchip"><Armchair size={12} aria-hidden /> {table?.seats || '—'} مقاعد</span>}
          {order
            ? <span className="tchip live"><span className="pulse-dot" aria-hidden /> {minutesSince(order.created_at)} د</span>
            : isTable && <span className="tchip ok"><Sparkles size={12} aria-hidden /> متاحة</span>}
          {order?.code && <span className="tchip mono" dir="ltr">{order.code}</span>}
          {order?.bill_requested_at && <span className="tchip warn"><BellRing size={12} aria-hidden /> طُلب الحساب</span>}
        </div>
        {(name || phone || order?.address || customer.address || order?.waiter_name) && (
          <div className="thero-meta">
            {name && <span><UserRound size={13} aria-hidden /> {name}</span>}
            {phone && <span><Phone size={13} aria-hidden /> <bdi dir="ltr">{phone}</bdi></span>}
            {(order?.address || customer.address) && <span><MapPin size={13} aria-hidden /> {order?.address || customer.address}</span>}
            {order?.waiter_name && <span><Clock size={13} aria-hidden /> {order.waiter_name}</span>}
          </div>
        )}
      </div>

      <div className="thero-side">
        <button className="thero-back" onClick={onBack}><ArrowRight size={15} /> الطاولات</button>
        {order ? (
          <>
            <span className="thero-label"><ReceiptText size={13} aria-hidden /> إجمالي الطاولة · {items.length} صنف</span>
            <strong className="thero-total"><AnimatedMoney value={order.total} /></strong>
            <Progress items={items} />
          </>
        ) : onGuests ? (
          <>
            <span className="thero-label">عدد الأشخاص — اضغط الكراسي أو الأزرار</span>
            <div className={`thero-guests ${guestsError ? 'invalid' : ''}`}>
              <button type="button" onClick={() => onGuests(Math.max(1, (Number(g) || 1) - 1))} aria-label="إنقاص"><Minus size={15} /></button>
              <span className="thero-guests-n"><Users size={15} aria-hidden /> {g || 0}</span>
              <button type="button" onClick={() => onGuests((Number(g) || 0) + 1)} aria-label="زيادة"><Plus size={15} /></button>
            </div>
            {guestsError && <span className="thero-err">{guestsError}</span>}
          </>
        ) : (
          <span className="thero-label">اختر الأطباق ثم أرسل الطلب للمطبخ</span>
        )}
      </div>
    </header>
  );
}
