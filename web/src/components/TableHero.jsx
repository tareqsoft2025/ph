import { useMemo, useState } from 'react';
import {
  ArrowRight, Armchair, ShoppingBag, Bike, Users, Clock, UserRound, Phone, MapPin, ReceiptText, Minus, Plus, Sparkles, CircleCheck,
} from 'lucide-react';
import { useMoney, useNow, minutesSince } from '../lib.jsx';

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
            <rect x="-15" y="-11" width="30" height="22" rx="7" className="ta-seat" />
            <rect x="-13" y="-15" width="26" height="6" rx="3" className="ta-back" />
          </g>
        );
      })}
      {L.table.kind === 'round'
        ? <circle cx={L.table.cx} cy={L.table.cy} r={L.table.r} className="ta-table" fill="url(#tblWood)" />
        : <rect x={L.table.x} y={L.table.y} width={L.table.w} height={L.table.h} rx="14" className="ta-table" fill="url(#tblWood)" />}
      {/* أطباق أمام الكراسي المشغولة */}
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

/**
 * لوحة الطاولة أعلى شاشة الطلبات
 * @param {{ type: string, table?: any, order?: any, guests?: number, onGuests?: (n:number)=>void, guestsError?: string,
 *   customer?: {name?:string, phone?:string, address?:string}, onBack: ()=>void, children?: any }} props
 */
export default function TableHero({ type, table, order, guests, onGuests, guestsError, customer = {}, onBack, children }) {
  const money = useMoney();
  useNow(30000);
  const isTable = type === 'dine_in';
  const TypeIcon = isTable ? Armchair : type === 'delivery' ? Bike : ShoppingBag;
  const items = order ? order.items.filter((i) => i.status !== 'cancelled') : [];
  const ready = items.filter((i) => i.status === 'ready').length;
  const name = order?.customer_name || customer.name;
  const phone = order?.customer_phone || customer.phone;
  const g = order?.guests ?? guests;

  return (
    <header className={`thero thero-${type}`}>
      <div className="thero-glow" aria-hidden />
      <button className="thero-back" onClick={onBack}><ArrowRight size={16} /> الطاولات</button>

      <div className="thero-art">
        {isTable ? (
          <>
            <TableArt seats={table?.seats || 4} guests={Number(g) || 0} onPick={onGuests} occupied={!!order} />
            {onGuests && (
              <div className={`thero-guests ${guestsError ? 'invalid' : ''}`}>
                <button type="button" onClick={() => onGuests(Math.max(1, (Number(g) || 1) - 1))} aria-label="إنقاص"><Minus size={14} /></button>
                <span><Users size={14} aria-hidden /> {g || 0} أشخاص</span>
                <button type="button" onClick={() => onGuests((Number(g) || 0) + 1)} aria-label="زيادة"><Plus size={14} /></button>
              </div>
            )}
          </>
        ) : (
          <div className="thero-icon"><TypeIcon size={54} strokeWidth={1.5} /></div>
        )}
      </div>

      <div className="thero-info">
        <span className="thero-kicker">
          {isTable ? (order ? 'الطلبات الخاصة بـ' : 'طلب جديد على') : order ? 'طلب' : 'طلب جديد'}
        </span>
        <h1 className="thero-title">{isTable ? table?.name || order?.table_name || 'طاولة' : type === 'delivery' ? 'توصيل' : 'سفري'}</h1>
        <div className="thero-chips">
          {isTable && table?.area && <span className="tchip">{table.area}</span>}
          {isTable && <span className="tchip"><Armchair size={13} aria-hidden /> {table?.seats || '—'} مقاعد</span>}
          {order
            ? <span className="tchip live"><span className="pulse-dot" aria-hidden /> مشغولة منذ {minutesSince(order.created_at)} د</span>
            : isTable && <span className="tchip ok"><Sparkles size={13} aria-hidden /> متاحة الآن</span>}
          {order?.code && <span className="tchip mono" dir="ltr">{order.code}</span>}
        </div>
        <div className="thero-meta">
          {name && <span><UserRound size={14} aria-hidden /> {name}</span>}
          {phone && <span><Phone size={14} aria-hidden /> <bdi dir="ltr">{phone}</bdi></span>}
          {(order?.address || customer.address) && <span><MapPin size={14} aria-hidden /> {order?.address || customer.address}</span>}
          {order?.waiter_name && <span><Clock size={14} aria-hidden /> {order.waiter_name}</span>}
        </div>
        {guestsError && <span className="thero-err">{guestsError} — اضغط على الكراسي لتحديد العدد</span>}
      </div>

      <div className="thero-side">
        {order ? (
          <>
            <span className="thero-label">إجمالي الطاولة</span>
            <strong className="thero-total">{money(order.total)}</strong>
            <span className="thero-sub"><ReceiptText size={14} aria-hidden /> {items.length} صنف{ready ? ' · ' : ''}{ready ? <b className="thero-ready"><CircleCheck size={13} /> {ready} جاهز</b> : null}</span>
            {order.bill_requested_at && <span className="tchip warn">طُلب الحساب</span>}
          </>
        ) : (
          <>
            <span className="thero-label">اختر الأطباق من القائمة</span>
            <span className="thero-sub">ثم أرسل الطلب للمطبخ</span>
          </>
        )}
        {children}
      </div>
    </header>
  );
}
