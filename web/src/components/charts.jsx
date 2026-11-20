import { useId, useState } from 'react';

/** منحنى مساحي صغير (Sparkline) مع نقطة نهاية نابضة */
export function Spark({ values, height = 56, tone = 'var(--primary)' }) {
  const id = useId().replace(/:/g, '');
  const w = 240;
  if (!values.length || Math.max(...values) <= 0) return <div className="spark-empty" style={{ height }}>لا بيانات بعد</div>;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, height - 6 - (v / max) * (height - 14)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label="اتجاه المبيعات" style={{ height }}>
      <defs>
        <linearGradient id={`sg${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity=".35" /><stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${height} L0 ${height} Z`} fill={`url(#sg${id})`} />
      <path d={line} fill="none" stroke={tone} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="4" fill={tone} className="spark-dot" />
    </svg>
  );
}

/** حلقة نسبة مئوية */
export function Ring({ value, size = 84, stroke = 9, tone = 'var(--primary)', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, value));
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-arc" />
      </svg>
      <span className="ring-in">{children}</span>
    </span>
  );
}

/** أعمدة رأسية مع تمييز العمود الأخير وتلميح عند المرور */
export function Columns({ rows, fmt, height = 190 }) {
  const [hi, setHi] = useState(null);
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="cols2" style={{ height }} role="img" aria-label="المبيعات حسب اليوم">
      {rows.map((r, i) => {
        const h = Math.max(2, (r.value / max) * 100);
        return (
          <div key={r.key} className={`col2 ${r.current ? 'now' : ''} ${hi === i ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} onFocus={() => setHi(i)} onBlur={() => setHi(null)} tabIndex={0}>
            <span className="col2-tip">{fmt(r.value)}{r.sub ? <small>{r.sub}</small> : null}</span>
            <span className="col2-bar" style={{ height: `${h}%`, animationDelay: `${i * 45}ms` }} />
            <span className="col2-l">{r.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** دائرة توزيع (Donut) مع وسيلة إيضاح */
export function Donut({ rows, fmt, size = 150 }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const r0 = size / 2 - 12;
  const c = 2 * Math.PI * r0;
  let acc = 0;
  const palette = ['#0b6b3a', '#d98a3d', '#2563eb', '#a855f7', '#e0562c', '#0e7490', '#64748b'];
  if (!total) return <div className="spark-empty" style={{ height: size }}>لا بيانات بعد</div>;
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="توزيع المبيعات">
        <circle cx={size / 2} cy={size / 2} r={r0} fill="none" stroke="var(--surface-2)" strokeWidth="18" />
        {rows.map((r, i) => {
          const len = (r.value / total) * c;
          const el = <circle key={r.label} cx={size / 2} cy={size / 2} r={r0} fill="none" stroke={palette[i % palette.length]} strokeWidth="18" strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="donut-seg" style={{ animationDelay: `${i * 90}ms` }} />;
          acc += len;
          return el;
        })}
        <text x="50%" y="48%" textAnchor="middle" className="donut-n">{rows.length}</text>
        <text x="50%" y="62%" textAnchor="middle" className="donut-l">بند</text>
      </svg>
      <ul className="donut-legend">
        {rows.slice(0, 6).map((r, i) => (
          <li key={r.label}><i style={{ background: palette[i % palette.length] }} aria-hidden /><span>{r.label}</span><b>{Math.round((r.value / total) * 100)}%</b><small>{fmt(r.value)}</small></li>
        ))}
      </ul>
    </div>
  );
}
