import { useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { WEEKDAYS } from '../lib.jsx';

export const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
};
export const shortDay = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const pctOf = (a, b) => (b > 0 ? (a / b) * 100 : 0);

/** نسبة التغيّر عن الفترة السابقة. invert: الارتفاع سيّئ (تكاليف) */
export function Delta({ cur, prev, invert = false, show = true }) {
  if (!show) return null;
  if (!prev) return cur !== 0 ? <span className="rp-delta new">جديد</span> : <span className="rp-delta flat"><Minus size={12} aria-hidden /> —</span>;
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(p) < 0.5) return <span className="rp-delta flat"><Minus size={12} aria-hidden /> ثابت</span>;
  const up = p > 0;
  const good = invert ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  return <span className={`rp-delta ${good ? 'good' : 'bad'}`} title="مقارنة بالفترة السابقة المماثلة"><Icon size={13} aria-hidden /> {Math.abs(p) >= 100 ? Math.round(Math.abs(p)) : Math.abs(p).toFixed(1)}%</span>;
}

/** منحنى المبيعات: الفترة الحالية مقابل السابقة (متقطع) مع تلميح عند المرور */
export function Trend({ series, prev, money, compare }) {
  const ref = useRef(null);
  const [hi, setHi] = useState(null);
  const W = 640;
  const H = 230;
  const pad = { l: 8, r: 8, t: 14, b: 26 };
  const n = series.length;
  const all = [...series.map((s) => s.total), ...(compare ? prev.map((s) => s.total) : [])];
  const max = Math.max(...all, 1);
  const x = (i) => pad.l + (n > 1 ? (i * (W - pad.l - pad.r)) / (n - 1) : (W - pad.l - pad.r) / 2);
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = (arr) => arr.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s.total).toFixed(1)}`).join(' ');
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const move = (e) => {
    const b = ref.current.getBoundingClientRect();
    const rel = (e.clientX - b.left) / b.width; // يمين→يسار في RTL: نعكس
    const dir = getComputedStyle(ref.current).direction === 'rtl' ? 1 - rel : rel;
    setHi(Math.max(0, Math.min(n - 1, Math.round(dir * (n - 1)))));
  };
  const step = Math.max(1, Math.ceil(n / 7));
  const h = hi != null ? series[hi] : null;
  const ph = hi != null && compare ? prev[hi] : null;
  return (
    <div className="rp-trend">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => setHi(null)} role="img" aria-label="منحنى المبيعات اليومية" style={{ direction: 'ltr' }}>
        <defs><linearGradient id="rpTrendG" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity=".28" /><stop offset="100%" stopColor="var(--primary)" stopOpacity="0" /></linearGradient></defs>
        {ticks.map((t, i) => <g key={i}><line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="rp-grid" /><text x={W - pad.r} y={y(t) - 4} textAnchor="end" className="rp-tick">{compact(t)}</text></g>)}
        {n > 1 && <path d={`${path(series)} L${x(n - 1)} ${H - pad.b} L${x(0)} ${H - pad.b} Z`} fill="url(#rpTrendG)" />}
        {compare && n > 1 && <path d={path(prev)} className="rp-prev" vectorEffect="non-scaling-stroke" />}
        <path d={path(series)} className="rp-cur" vectorEffect="non-scaling-stroke" />
        {series.map((s, i) => (i % step === 0 || i === n - 1) && <text key={s.day} x={x(i)} y={H - 8} textAnchor="middle" className="rp-tick">{shortDay(s.day)}</text>)}
        {hi != null && <g><line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={H - pad.b} className="rp-cross" /><circle cx={x(hi)} cy={y(h.total)} r="5" className="rp-pt" /></g>}
      </svg>
      {h && (
        <div className="rp-tip" style={{ insetInlineStart: `${n > 1 ? (hi / (n - 1)) * 100 : 50}%` }}>
          <b>{h.day}</b><span>{money(h.total)} · {h.orders} طلب</span>
          {ph && <small>السابقة ({ph.day}): {money(ph.total)}</small>}
        </div>
      )}
      <div className="rp-legend"><span><i className="cur" /> الفترة الحالية</span>{compare && <span><i className="prev" /> الفترة السابقة</span>}</div>
    </div>
  );
}

/** أشرطة أفقية: صف = {label, value, sub?, color?} */
export function HBars({ rows, fmt, total, empty = 'لا بيانات في هذه الفترة' }) {
  if (!rows.length) return <p className="rp-empty">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
  return (
    <ul className="rp-hbars">
      {rows.map((r, i) => (
        <li key={`${r.label}${i}`}>
          <div className="top"><span className="lbl">{r.label}{r.sub ? <small>{r.sub}</small> : null}</span><b>{fmt(r.value)}</b>{sum > 0 && <em>{Math.round((r.value / sum) * 100)}%</em>}</div>
          <div className="track"><i style={{ width: `${(r.value / max) * 100}%`, background: r.color || undefined }} /></div>
        </li>
      ))}
    </ul>
  );
}

/** أعمدة عمودية بسيطة: rows = [{label, value, sub}] */
export function Cols({ rows, fmt, height = 150, hot }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="rp-cols" style={{ height }} role="img">
      {rows.map((r, i) => (
        <div key={i} className={`c ${hot === i ? 'hot' : ''}`} title={`${r.label} — ${fmt(r.value)}${r.sub ? ` · ${r.sub}` : ''}`}>
          <span className="v" style={{ height: `${Math.max(r.value > 0 ? 3 : 0, (r.value / max) * 100)}%` }} />
          <span className="l">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

/** خريطة حرارية: أيام الأسبوع × ساعات اليوم */
export function Heatmap({ heat, money }) {
  if (!heat.length) return <p className="rp-empty">لا بيانات في هذه الفترة</p>;
  const hrs = heat.map((h) => h.hour);
  const lo = Math.min(...hrs);
  const hi = Math.max(...hrs);
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const map = new Map(heat.map((h) => [`${h.dow}-${h.hour}`, h]));
  const max = Math.max(...heat.map((h) => h.total), 1);
  return (
    <div className="rp-heat" style={{ '--cols': hours.length }}>
      <div className="hdr"><span />{hours.map((h) => <span key={h}>{h}</span>)}</div>
      {WEEKDAYS.map((d, dow) => (
        <div className="row" key={dow}>
          <span className="d">{d}</span>
          {hours.map((h) => {
            const c = map.get(`${dow}-${h}`);
            const a = c ? Math.max(0.12, c.total / max) : 0;
            return <span key={h} className={`cell ${c ? 'on' : ''}`} style={c ? { '--a': a } : undefined} title={c ? `${d} ${h}:00 — ${money(c.total)} · ${c.orders} طلب` : `${d} ${h}:00`} />;
          })}
        </div>
      ))}
    </div>
  );
}

/** ملخص التنزيل CSV (يدعم العربية في Excel عبر BOM) */
export function downloadCsv(name, sections) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [];
  sections.forEach(([title, head, rows]) => {
    lines.push(esc(title));
    lines.push(head.map(esc).join(','));
    rows.forEach((r) => lines.push(r.map(esc).join(',')));
    lines.push('');
  });
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
