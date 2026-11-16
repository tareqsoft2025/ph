import { useEffect, useRef, useState } from 'react';
import { api, getSocket } from '../api.js';
import { useData, useAction, useNow, minutesSince, Loading, Empty, STATIONS, ORDER_TYPES } from '../lib.jsx';
import { Bell, BellOff, CircleCheck, Clock, StickyNote, Check } from 'lucide-react';

/** تنبيه صوتي قصير عند وصول طلب جديد */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch { /* ignore */ }
}

export default function Kitchen() {
  const [station, setStation] = useState('');
  const [sound, setSound] = useState(true);
  const { data, loading, reload } = useData(`/kitchen${station ? `?station=${station}` : ''}`, ['kitchen'], [station]);
  const [run] = useAction();
  const known = useRef(null);
  useNow(15000);

  // صوت عند وصول طلب لم يكن موجوداً
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.flatMap((o) => o.items.filter((i) => i.status === 'new').map((i) => i.id)));
    if (known.current && sound && [...ids].some((id) => !known.current.has(id))) beep();
    known.current = ids;
  }, [data, sound]);

  useEffect(() => {
    const s = getSocket();
    s?.on('connect', reload);
    return () => s?.off('connect', reload);
  }, [reload]);

  const setItem = (id, status) => run(() => api(`/kitchen/items/${id}`, { method: 'PATCH', body: { status } }));
  const bump = (orderId, status) => run(() => api(`/kitchen/orders/${orderId}/bump`, { method: 'POST', body: { status } }));
  const next = { new: 'preparing', preparing: 'ready', ready: 'served' };

  return (
    <div className="kds">
      <div className="kds-bar">
        <div className="seg">
          <button className={!station ? 'active' : ''} onClick={() => setStation('')}>الكل</button>
          {Object.entries(STATIONS).map(([k, v]) => (
            <button key={k} className={station === k ? 'active' : ''} onClick={() => setStation(k)}>{v}</button>
          ))}
        </div>
        <label className="switch"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> {sound ? <Bell size={16} /> : <BellOff size={16} />} تنبيه صوتي</label>
      </div>
      {loading ? <Loading /> : !data?.length ? <Empty icon={CircleCheck} text="لا توجد طلبات قيد التحضير" /> : (
        <div className="kds-grid">
          {data.map((o) => {
            const mins = minutesSince(o.sent_at);
            const allReady = o.items.every((i) => i.status === 'ready');
            const level = allReady ? 'done' : mins >= 20 ? 'late' : mins >= 10 ? 'warn' : '';
            return (
              <article key={o.order_id} className={`ticket ${level}`}>
                <header>
                  <strong>#{o.number}</strong>
                  <span>{o.table_name || ORDER_TYPES[o.type]}</span>
                  <span className="t-timer"><Clock size={15} aria-hidden /> {mins} د</span>
                </header>
                {o.notes && <div className="ticket-note"><StickyNote size={15} aria-hidden /> {o.notes}</div>}
                <ul>
                  {o.items.map((i) => (
                    <li key={i.id} className={`k-item k-${i.status}`} onClick={() => setItem(i.id, next[i.status])} role="button" tabIndex={0}>
                      <span className="k-qty">{i.qty}</span>
                      <span className="k-name">
                        {i.name}
                        {i.modifiers.length > 0 && <small>{i.modifiers.map((m) => m.name).join('، ')}</small>}
                        {i.notes && <small className="note"><StickyNote size={13} aria-hidden /> {i.notes}</small>}
                      </span>
                      <span className="k-state">{i.status === 'new' ? 'جديد' : i.status === 'preparing' ? 'يُحضّر' : 'جاهز'}</span>
                    </li>
                  ))}
                </ul>
                <footer>
                  {o.items.some((i) => i.status === 'new') && <button className="btn" onClick={() => bump(o.order_id, 'preparing')}>بدء التحضير</button>}
                  {!allReady && <button className="btn btn-ok" onClick={() => bump(o.order_id, 'ready')}><Check size={17} /> الطلب جاهز</button>}
                  {allReady && <span className="muted">بانتظار التقديم</span>}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
