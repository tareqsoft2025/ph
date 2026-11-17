import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Armchair, ShoppingBag, Bike, Clock, StickyNote, Flame, Check, HandPlatter, Maximize, Minimize, Send, Users,
  CircleCheck, ChefHat, Layers,
} from 'lucide-react';
import { api } from '../api.js';
import { useData, useAction, useNow, Loading, STATIONS, ROLE_LABELS, timeOf } from '../lib.jsx';

const LANES = [
  { k: 'new', label: 'طلبات جديدة', action: 'ابدأ التحضير', next: 'preparing', icon: Flame },
  { k: 'preparing', label: 'قيد التحضير', action: 'جاهز للتقديم', next: 'ready', icon: Check },
  { k: 'ready', label: 'جاهزة للتقديم', action: 'تم التسليم', next: 'served', icon: HandPlatter },
];
const TYPE_ICON = { dine_in: Armchair, takeaway: ShoppingBag, delivery: Bike };
const TYPE_LABEL = { dine_in: 'صالة', takeaway: 'سفري', delivery: 'توصيل' };
const NEXT_ITEM = { new: 'preparing', preparing: 'ready', ready: 'served' };

function elapsed(ts) {
  if (!ts) return { sec: 0, text: '0:00' };
  const sec = Math.max(0, Math.floor((Date.now() - new Date(ts.replace(' ', 'T')).getTime()) / 1000));
  const m = Math.floor(sec / 60);
  return { sec, text: m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}س` : `${m}:${String(sec % 60).padStart(2, '0')}` };
}

export default function Kitchen() {
  const [station, setStation] = useState('');
  const [lane, setLane] = useState('new');
  const [focus, setFocus] = useState(false);
  const { data, loading, reload } = useData(`/kitchen${station ? `?station=${station}` : ''}`, ['kitchen'], [station]);
  const [run, busy] = useAction();
  const seen = useRef(null);
  const [fresh, setFresh] = useState(new Set());
  useNow(1000);

  // إبراز التذاكر الجديدة لبضع ثوانٍ
  useEffect(() => {
    if (!data) return undefined;
    const ids = new Set(data.map((o) => o.order_id));
    if (seen.current) {
      const added = [...ids].filter((id) => !seen.current.has(id));
      if (added.length) {
        setFresh((f) => new Set([...f, ...added]));
        const t = setTimeout(() => setFresh((f) => new Set([...f].filter((x) => !added.includes(x)))), 6000);
        seen.current = ids;
        return () => clearTimeout(t);
      }
    }
    seen.current = ids;
    return undefined;
  }, [data]);

  // وضع ملء الشاشة
  useEffect(() => {
    document.body.classList.toggle('kds-focus', focus);
    return () => document.body.classList.remove('kds-focus');
  }, [focus]);
  useEffect(() => {
    const h = () => { if (!document.fullscreenElement) setFocus(false); };
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  const toggleFocus = async () => {
    const next = !focus;
    setFocus(next);
    try {
      if (next && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else if (!next && document.fullscreenElement) await document.exitFullscreen();
    } catch { /* غير مدعوم */ }
  };

  const byLane = useMemo(() => {
    const g = { new: [], preparing: [], ready: [] };
    (data || []).forEach((o) => g[o.stage]?.push(o));
    return g;
  }, [data]);

  // ملخص الكميات المطلوب تحضيرها
  const allDay = useMemo(() => {
    const m = new Map();
    (data || []).forEach((o) => o.items.forEach((i) => {
      if (i.status === 'ready') return;
      m.set(i.name, (m.get(i.name) || 0) + i.qty);
    }));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  // بعد الضغط على مرحلة الطلب تُحدَّث الشاشة فوراً دون انتظار الحدث اللحظي
  const bump = async (o, status) => { await run(() => api(`/kitchen/orders/${o.order_id}/bump`, { method: 'POST', body: { status } })); reload(); };
  const setItem = async (i) => { await run(() => api(`/kitchen/items/${i.id}`, { method: 'PATCH', body: { status: NEXT_ITEM[i.status] } })); reload(); };

  const now = new Date();

  return (
    <div className={`kds ${focus ? 'focus' : ''}`}>
      <header className="kds-top">
        <div className="kds-title">
          <span className="kds-mark" aria-hidden><ChefHat size={22} /></span>
          <div>
            <h1>شاشة المطبخ</h1>
            <span className="muted small">{(data || []).length} طلب نشط من كل الطاولات</span>
          </div>
        </div>
        <div className="kds-controls">
          <div className="seg">
            <button className={!station ? 'active' : ''} onClick={() => setStation('')}>كل الأقسام</button>
            {Object.entries(STATIONS).map(([k, v]) => (
              <button key={k} className={station === k ? 'active' : ''} onClick={() => setStation(k)}>{v}</button>
            ))}
          </div>
          <span className="kds-clock" dir="ltr">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          <button className="btn btn-sm" onClick={toggleFocus} aria-pressed={focus}>
            {focus ? <><Minimize size={16} /> خروج</> : <><Maximize size={16} /> ملء الشاشة</>}
          </button>
        </div>
      </header>

      {allDay.length > 0 && (
        <div className="kds-allday" aria-label="ملخص الكميات المطلوبة">
          <span className="kds-allday-label"><Layers size={15} aria-hidden /> المطلوب تحضيره</span>
          {allDay.map(([name, qty]) => <span key={name} className="kds-chip"><b>{qty}</b> {name}</span>)}
        </div>
      )}

      <div className="kds-lane-tabs seg seg-lg">
        {LANES.map((l) => (
          <button key={l.k} className={lane === l.k ? 'active' : ''} onClick={() => setLane(l.k)}>
            {l.label} <span className="lane-count">{byLane[l.k].length}</span>
          </button>
        ))}
      </div>

      {loading ? <Loading /> : (
        <div className="kds-lanes">
          {LANES.map((l) => (
            <section key={l.k} className={`kds-lane lane-${l.k} ${lane === l.k ? 'shown' : ''}`} aria-label={l.label}>
              <header className="lane-head">
                <span className="lane-dot" aria-hidden />
                <h2>{l.label}</h2>
                <span className="lane-count">{byLane[l.k].length}</span>
              </header>
              <div className="lane-body">
                {!byLane[l.k].length && (
                  <div className="lane-empty"><CircleCheck size={22} aria-hidden /><span>{l.k === 'new' ? 'لا طلبات جديدة' : l.k === 'preparing' ? 'لا شيء قيد التحضير' : 'لا طلبات بانتظار التقديم'}</span></div>
                )}
                {byLane[l.k].map((o) => {
                  const el = elapsed(o.sent_at);
                  const level = l.k === 'ready' ? 'done' : el.sec >= 20 * 60 ? 'late' : el.sec >= 10 * 60 ? 'warn' : 'ok';
                  const TypeIcon = TYPE_ICON[o.type];
                  return (
                    <article key={o.order_id} className={`kt kt-${level} ${fresh.has(o.order_id) ? 'kt-fresh' : ''}`}>
                      <header className="kt-head">
                        <div className="kt-where">
                          <TypeIcon size={20} aria-hidden />
                          <strong>{o.type === 'dine_in' ? o.table_name : TYPE_LABEL[o.type]}</strong>
                          {o.type !== 'dine_in' && o.customer_name && <span className="kt-cust">{o.customer_name}</span>}
                        </div>
                        <span className="kt-timer" title="منذ الإرسال للمطبخ"><Clock size={14} aria-hidden /> <span dir="ltr">{el.text}</span></span>
                      </header>
                      <div className="kt-meta">
                        <span className="kt-code" dir="ltr">{o.code}</span>
                        <span className="kt-by"><Send size={13} aria-hidden /> {o.sent_by_name || (o.source === 'online' ? 'الزبون (رابط الطلب)' : '—')}{o.sent_by_role ? ` · ${ROLE_LABELS[o.sent_by_role]}` : ''}</span>
                        {o.guests ? <span className="kt-by"><Users size={13} aria-hidden /> {o.guests}</span> : null}
                        <span className="kt-by" dir="ltr">{timeOf(o.sent_at)}</span>
                      </div>
                      {o.notes && <div className="kt-note"><StickyNote size={14} aria-hidden /> {o.notes}</div>}
                      <ul className="kt-items">
                        {o.items.map((i) => (
                          <li key={i.id}>
                            <button className={`kt-item ki-${i.status}`} onClick={() => setItem(i)} disabled={busy} aria-label={`${i.qty} ${i.name}، اضغط لتغيير الحالة`}>
                              <span className="ki-qty">{i.qty}</span>
                              <span className="ki-name">
                                {i.name}
                                {i.modifiers.length > 0 && <span className="ki-mods">{i.modifiers.map((m) => <span key={m.id}>{m.name}</span>)}</span>}
                                {i.notes && <span className="ki-note"><StickyNote size={12} aria-hidden /> {i.notes}</span>}
                              </span>
                              <span className="ki-state" aria-hidden>{i.status === 'ready' ? <Check size={16} /> : i.status === 'preparing' ? <Flame size={15} /> : null}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <footer className="kt-foot">
                        <button className={`btn btn-block ${l.k === 'preparing' ? 'btn-ok' : l.k === 'new' ? 'btn-primary' : ''}`} onClick={() => bump(o, l.next)} disabled={busy}>
                          <l.icon size={17} /> {l.action}
                        </button>
                      </footer>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
