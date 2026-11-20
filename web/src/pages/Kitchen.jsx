import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Armchair, ShoppingBag, Bike, StickyNote, Flame, Check, HandPlatter, Maximize, Minimize, Users, ChefHat, QrCode, Volume2, VolumeX, Settings2, Undo2,
  History, Wifi, WifiOff, Timer, TriangleAlert, Building2, ArrowDown, Plus, Minus, Sparkles,
} from 'lucide-react';
import { api } from '../api.js';
import { useData, useNow, useApp, has, Loading, STATIONS, timeOf } from '../lib.jsx';

const LANES = [
  { k: 'new', label: 'جديدة', action: 'ابدأ التحضير', next: 'preparing', icon: Flame, empty: 'لا طلبات جديدة' },
  { k: 'preparing', label: 'قيد التحضير', action: 'جاهز للتقديم', next: 'ready', icon: Check, empty: 'لا شيء قيد التحضير' },
  { k: 'ready', label: 'جاهزة للتقديم', action: 'تم التسليم', next: 'served', icon: HandPlatter, empty: 'لا طلبات بانتظار التقديم' },
];
const LANE_NAME = { preparing: 'قيد التحضير', ready: 'جاهزة للتقديم', served: 'المُسلَّمة' };
const TYPE_ICON = { dine_in: Armchair, takeaway: ShoppingBag, delivery: Bike };
const TYPE_LABEL = { dine_in: 'صالة', takeaway: 'تيك وي', delivery: 'توصيل' };
const NEXT_ITEM = { new: 'preparing', preparing: 'ready', ready: 'served' };
const FROM = { preparing: ['new'], ready: ['new', 'preparing'], served: ['ready'] };
const SCALES = [0.9, 1, 1.15, 1.3, 1.5];
const CACHE_KEY = 'ph-kds-cache';

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const toMs = (ts) => (ts ? new Date(String(ts).replace(' ', 'T')).getTime() : Date.now());
const fmtSec = (sec) => {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` : `${m}:${String(sec % 60).padStart(2, '0')}`;
};

/** نغمتان قصيرتان تنبّهان الطباخين بطلب جديد (WebAudio بلا ملفات) */
let audioCtx = null;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    [[880, 0], [1175, 0.18]].forEach(([f, t]) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      const t0 = audioCtx.currentTime + t;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.start(t0); o.stop(t0 + 0.55);
    });
  } catch { /* الصوت غير مدعوم */ }
}

/** شاشة المطبخ (KDS): مصمَّمة للشاشات الكبيرة، تعرض الطلبات لحظياً وتحتفظ بآخر حالة عند تحديث الصفحة */
export default function Kitchen() {
  const { user } = useApp();
  const canAct = has(user, 'kitchen.update');
  const [station, setStation] = useState(() => ls.get('ph-kds-station', ''));
  const [lane, setLane] = useState('new');
  const [tv, setTv] = useState(() => ls.get('ph-kds-tv', false));
  const [scale, setScale] = useState(() => ls.get('ph-kds-scale', 1));
  const [sound, setSound] = useState(() => ls.get('ph-kds-sound', true));
  const [warnMin, setWarnMin] = useState(() => ls.get('ph-kds-warn', 10));
  const [lateMin, setLateMin] = useState(() => ls.get('ph-kds-late', 20));
  const [panel, setPanel] = useState(null);                   // null | 'settings' | 'recent'
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(null);
  const [recent, setRecent] = useState(() => ls.get('ph-kds-recent', []));
  const [lastOk, setLastOk] = useState(Date.now());
  const [fresh, setFresh] = useState(new Set());
  const [unlocked, setUnlocked] = useState(() => !(window.AudioContext || window.webkitAudioContext) || audioCtx?.state === 'running');
  useNow(1000);

  const { data, error, reload } = useData(`/kitchen${station ? `?station=${station}` : ''}`, ['kitchen'], [station]);

  // آخر لقطة محفوظة: تظهر فوراً عند تحديث الصفحة قبل وصول البيانات الجديدة
  const cached = useMemo(() => { const c = ls.get(CACHE_KEY, null); return c && c.station === station && Date.now() - c.at < 6 * 3600e3 ? c.data : null; }, [station]); // eslint-disable-line
  const list = data ?? cached ?? [];
  const showingCache = !data && !!cached;

  useEffect(() => { if (data) { setLastOk(Date.now()); ls.set(CACHE_KEY, { at: Date.now(), station, data }); } }, [data]); // eslint-disable-line
  useEffect(() => { ls.set('ph-kds-station', station); }, [station]);
  // شبكة أمان: تحديث كل 8 ثوانٍ حتى لو انقطع الاتصال اللحظي
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 8000);
    return () => clearInterval(t);
  }, [reload]);

  // الطلبات الجديدة: إبراز + نغمة (بدون نغمة عند أول تحميل أو بعد تحديث الصفحة)
  const seen = useRef(cached ? new Set(cached.map((o) => o.order_id)) : null);
  useEffect(() => {
    if (!data) return undefined;
    const ids = new Set(data.map((o) => o.order_id));
    if (seen.current) {
      const added = [...ids].filter((id) => !seen.current.has(id));
      if (added.length) {
        setFresh((f) => new Set([...f, ...added]));
        if (sound) chime();
        const t = setTimeout(() => setFresh((f) => new Set([...f].filter((x) => !added.includes(x)))), 9000);
        seen.current = ids;
        return () => clearTimeout(t);
      }
    }
    seen.current = ids;
    return undefined;
  }, [data]); // eslint-disable-line

  // فتح الصوت: المتصفح يشترط ضغطة واحدة على الصفحة
  useEffect(() => {
    if (unlocked) return undefined;
    // بعد اكتمال الضغطة (لا قبلها) حتى لا يتحرك الزر تحت إصبع الطباخ
    const h = () => { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* */ } setTimeout(() => setUnlocked(true), 0); };
    window.addEventListener('click', h, { once: true });
    return () => window.removeEventListener('click', h);
  }, [unlocked]);

  // وضع الشاشة الكبيرة: يخفي القوائم ويُبقي الشاشة مضاءة
  useEffect(() => {
    document.body.classList.toggle('kds-focus', tv);
    ls.set('ph-kds-tv', tv);
    let lock = null;
    const grab = async () => { try { if (tv && 'wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch { /* */ } };
    grab();
    document.addEventListener('visibilitychange', grab);
    return () => { document.body.classList.remove('kds-focus'); document.removeEventListener('visibilitychange', grab); lock?.release?.().catch(() => {}); };
  }, [tv]);
  const toggleFull = async () => {
    try { if (!document.fullscreenElement) { setTv(true); await document.documentElement.requestFullscreen?.(); } else { await document.exitFullscreen(); } } catch { /* غير مدعوم */ }
  };

  const level = useCallback((o, k) => {
    if (k === 'ready') {
      const sec = Math.max(0, Math.floor((Date.now() - Math.max(...o.items.map((i) => toMs(i.ready_at || i.sent_at)))) / 1000));
      return { sec, lv: sec >= 6 * 60 ? 'late' : sec >= 3 * 60 ? 'warn' : 'ok', pct: Math.min(100, (sec / (6 * 60)) * 100) };
    }
    const sec = Math.max(0, Math.floor((Date.now() - toMs(o.sent_at)) / 1000));
    return { sec, lv: sec >= lateMin * 60 ? 'late' : sec >= warnMin * 60 ? 'warn' : 'ok', pct: Math.min(100, (sec / (lateMin * 60)) * 100) };
  }, [warnMin, lateMin]);

  const byLane = useMemo(() => {
    const g = { new: [], preparing: [], ready: [] };
    list.forEach((o) => g[o.stage]?.push(o));
    return g;
  }, [list]);

  const stats = useMemo(() => {
    const active = [...byLane.new, ...byLane.preparing];
    const secs = active.map((o) => level(o, o.stage).sec);
    return { late: active.filter((o) => level(o, o.stage).lv === 'late').length, avg: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : 0, oldest: secs.length ? Math.max(...secs) : 0 };
  }, [byLane, level, list]); // eslint-disable-line

  // ملخص الكميات المطلوب تحضيرها (لم تجهز بعد)
  const allDay = useMemo(() => {
    const m = new Map();
    list.forEach((o) => o.items.forEach((i) => { if (i.status === 'ready') return; m.set(i.name, (m.get(i.name) || 0) + i.qty); }));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);

  const flash = (u) => { setUndo(u); clearTimeout(flash.t); flash.t = setTimeout(() => setUndo(null), 9000); };
  const patch = (id, status) => api(`/kitchen/items/${id}`, { method: 'PATCH', body: { status } });

  const bump = async (o, status) => {
    if (!canAct || busy) return;
    const moved = o.items.filter((i) => FROM[status].includes(i.status));
    setBusy(true);
    try {
      await api(`/kitchen/orders/${o.order_id}/bump`, { method: 'POST', body: { status } });
      const where = o.table_name || o.event_name || o.code;
      if (status === 'served') {
        const rec = { order_id: o.order_id, code: o.code, where, at: Date.now(), items: moved.map((i) => ({ id: i.id, name: i.name, qty: i.qty })) };
        setRecent((r) => { const n = [rec, ...r].slice(0, 10); ls.set('ph-kds-recent', n); return n; });
      }
      flash({ text: `${where} ← ${LANE_NAME[status]}`, restore: async () => { await Promise.all(moved.map((i) => patch(i.id, i.status))); if (status === 'served') setRecent((r) => { const n = r.filter((x) => x.order_id !== o.order_id); ls.set('ph-kds-recent', n); return n; }); } });
    } catch (e) { void e; } finally { setBusy(false); reload(); }
  };
  const setItem = async (i) => {
    if (!canAct || busy || !NEXT_ITEM[i.status]) return;
    setBusy(true);
    try { await patch(i.id, NEXT_ITEM[i.status]); } catch { /* */ } finally { setBusy(false); reload(); }
  };
  const doUndo = async () => { const u = undo; setUndo(null); if (!u) return; setBusy(true); try { await u.restore(); } catch { /* */ } finally { setBusy(false); reload(); } };
  const recall = async (rec) => {
    setBusy(true);
    try { await Promise.all(rec.items.map((i) => patch(i.id, 'ready'))); setRecent((r) => { const n = r.filter((x) => x.order_id !== rec.order_id); ls.set('ph-kds-recent', n); return n; }); setPanel(null); }
    catch { /* */ } finally { setBusy(false); reload(); }
  };

  const now = new Date();
  const total = list.length;
  const age = Math.floor((Date.now() - lastOk) / 1000);
  const online = !error && age < 45;
  const setPref = (k, v, set) => { set(v); ls.set(k, v); };

  return (
    <div className={`kd ${tv ? 'tv' : ''}`} style={{ '--kz': scale }}>
      <header className="kd-top">
        <div className="kd-brand">
          <span className="kd-mark" aria-hidden><ChefHat size="1.4em" strokeWidth={2} /></span>
          <div><h1>المطبخ</h1><span className={`kd-conn ${online ? 'ok' : 'off'}`}>{online ? <Wifi size="1em" aria-hidden /> : <WifiOff size="1em" aria-hidden />}{online ? `متصل · تحديث قبل ${age}ث` : showingCache || error ? 'انقطع الاتصال · يعرض آخر حالة' : 'جارِ الاتصال…'}</span></div>
        </div>

        <nav className="kd-stations" aria-label="الأقسام">
          <button className={!station ? 'on' : ''} onClick={() => setStation('')}>كل الأقسام</button>
          {Object.entries(STATIONS).map(([k, v]) => <button key={k} className={station === k ? 'on' : ''} onClick={() => setStation(k)}>{v}</button>)}
        </nav>

        <div className="kd-stats" role="tablist" aria-label="المراحل">
          {LANES.map((l) => (
            <button key={l.k} role="tab" aria-selected={lane === l.k} className={`kd-stat st-${l.k} ${lane === l.k ? 'on' : ''}`} onClick={() => setLane(l.k)}>
              <b>{byLane[l.k].length}</b><span>{l.label}</span>
            </button>
          ))}
          <div className={`kd-stat st-late ${stats.late ? 'hot' : ''}`} title="طلبات تجاوزت زمن التحضير المسموح"><b>{stats.late}</b><span>متأخرة</span></div>
          <div className="kd-stat st-avg" title="متوسط انتظار الطلبات الحالية"><b dir="ltr">{fmtSec(stats.avg)}</b><span>متوسط الانتظار</span></div>
        </div>

        <div className="kd-tools">
          <div className="kd-clock" dir="ltr"><b>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</b><small>{now.toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
          {!unlocked && sound && <span className="kd-unlock">اضغط في أي مكان لتفعيل الصوت</span>}
          <button className={`kd-ib ${sound ? 'on' : ''} ${!unlocked && sound ? 'needs' : ''}`} onClick={() => { setPref('ph-kds-sound', !sound, setSound); if (!sound) chime(); }} aria-pressed={sound} title={sound ? 'إيقاف نغمة الطلب الجديد' : 'تفعيل نغمة الطلب الجديد'}>{sound ? <Volume2 size="1.3em" /> : <VolumeX size="1.3em" />}</button>
          <button className={`kd-ib ${panel === 'recent' ? 'on' : ''}`} onClick={() => setPanel(panel === 'recent' ? null : 'recent')} title="آخر ما سُلِّم (للاسترجاع)"><History size="1.3em" />{recent.length > 0 && <i>{recent.length}</i>}</button>
          <button className={`kd-ib ${panel === 'settings' ? 'on' : ''}`} onClick={() => setPanel(panel === 'settings' ? null : 'settings')} title="إعدادات الشاشة"><Settings2 size="1.3em" /></button>
          <button className="kd-ib wide" onClick={toggleFull} title="شاشة كبيرة ملء الشاشة">{document.fullscreenElement ? <Minimize size="1.3em" /> : <Maximize size="1.3em" />}</button>
          {tv && !document.fullscreenElement && <button className="kd-ib" onClick={() => setTv(false)} title="إظهار القوائم">✕</button>}
        </div>

        {panel === 'settings' && (
          <div className="kd-pop" role="dialog" aria-label="إعدادات الشاشة">
            <h3>إعدادات الشاشة</h3>
            <div className="kd-row"><span>حجم الخط</span>
              <div className="kd-step"><button onClick={() => setPref('ph-kds-scale', SCALES[Math.max(0, SCALES.indexOf(scale) - 1)] ?? 1, setScale)} aria-label="تصغير"><Minus size="1.1em" /></button><b>{Math.round(scale * 100)}%</b><button onClick={() => setPref('ph-kds-scale', SCALES[Math.min(SCALES.length - 1, SCALES.indexOf(scale) + 1)] ?? 1, setScale)} aria-label="تكبير"><Plus size="1.1em" /></button></div></div>
            <div className="kd-row"><span>تنبيه التأخير بعد (دقيقة)</span>
              <div className="kd-step"><button onClick={() => setPref('ph-kds-warn', Math.max(1, warnMin - 1), setWarnMin)}><Minus size="1.1em" /></button><b>{warnMin}</b><button onClick={() => setPref('ph-kds-warn', Math.min(lateMin - 1, warnMin + 1), setWarnMin)}><Plus size="1.1em" /></button></div></div>
            <div className="kd-row"><span>اعتبار الطلب متأخراً بعد (دقيقة)</span>
              <div className="kd-step"><button onClick={() => setPref('ph-kds-late', Math.max(warnMin + 1, lateMin - 1), setLateMin)}><Minus size="1.1em" /></button><b>{lateMin}</b><button onClick={() => setPref('ph-kds-late', Math.min(90, lateMin + 1), setLateMin)}><Plus size="1.1em" /></button></div></div>
            <label className="kd-row"><span>إخفاء القوائم (وضع الشاشة الكبيرة)</span><input type="checkbox" checked={tv} onChange={(e) => setTv(e.target.checked)} /></label>
            <p className="kd-hint">تُحفظ هذه الإعدادات على هذا الجهاز. للشاشة الكبيرة: فعّل «ملء الشاشة» ثم اترك الصفحة مفتوحة، وتبقى مضاءة وتتجدد وحدها.</p>
          </div>
        )}
        {panel === 'recent' && (
          <div className="kd-pop" role="dialog" aria-label="آخر ما سُلِّم">
            <h3>آخر ما سُلِّم</h3>
            {!recent.length ? <p className="kd-hint">لا توجد طلبات مسلَّمة في هذه الجلسة.</p> : recent.map((r) => (
              <div key={`${r.order_id}-${r.at}`} className="kd-rec"><div><strong>{r.where}</strong><small dir="ltr">{r.code} · {timeOf(new Date(r.at).toISOString())}</small><span>{r.items.map((i) => `${i.qty}× ${i.name}`).join('، ')}</span></div>
                {canAct && <button className="btn btn-sm" onClick={() => recall(r)} disabled={busy}><Undo2 size={14} /> استرجاع</button>}</div>
            ))}
          </div>
        )}
      </header>


      {!data && !cached && !error ? <Loading /> : total === 0 ? (
        <div className="kd-calm">
          <span className="kd-calm-ico" aria-hidden><Sparkles size="2.4em" /></span>
          <h2>المطبخ هادئ</h2>
          <p>ستظهر الطلبات هنا لحظة وصولها من الصالة أو التيك وي أو الزبائن.</p>
        </div>
      ) : (
        <div className="kd-lanes" style={{ gridTemplateColumns: LANES.map((l) => `minmax(15em, ${byLane[l.k].length === 0 ? 0.6 : Math.min(3, 1 + (byLane[l.k].length - 1) / 3)}fr)`).join(' ') }}>
          {LANES.map((l) => (
            <Lane key={l.k} l={l} orders={byLane[l.k]} shown={lane === l.k} level={level} fresh={fresh} canAct={canAct} busy={busy} onBump={bump} onItem={setItem} multiStation={!station} />
          ))}
        </div>
      )}

      {allDay.length > 0 && (
        <footer className="kd-allday" aria-label="ملخص الكميات المطلوبة">
          <span className="kd-allday-l"><Timer size="1.1em" aria-hidden /> للتحضير الآن</span>
          <div className="kd-allday-row">{allDay.map(([name, qty]) => <span key={name} className="kd-chip"><b>{qty}</b>{name}</span>)}</div>
        </footer>
      )}

      {undo && <div className="kd-undo" role="status"><span>{undo.text}</span><button onClick={doUndo}><Undo2 size="1.1em" /> تراجع</button></div>}
    </div>
  );
}

function Lane({ l, orders, shown, level, fresh, canAct, busy, onBump, onItem, multiStation }) {
  const body = useRef(null);
  const [more, setMore] = useState(false);
  const check = useCallback(() => { const el = body.current; if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 24); }, []);
  useEffect(() => { check(); const t = setTimeout(check, 300); window.addEventListener('resize', check); return () => { clearTimeout(t); window.removeEventListener('resize', check); }; }, [orders.length, check]);
  return (
    <section className={`kd-lane ln-${l.k} ${shown ? 'shown' : ''}`} aria-label={l.label}>
      <header className="kd-lane-head"><span className="kd-dot" aria-hidden /><h2>{l.label}</h2><b>{orders.length}</b></header>
      <div className="kd-lane-body" ref={body} onScroll={check}>
        {!orders.length && <div className="kd-lane-empty">{l.empty}</div>}
        {orders.map((o) => <Ticket key={o.order_id} o={o} l={l} lv={level(o, l.k)} isNew={fresh.has(o.order_id)} canAct={canAct} busy={busy} onBump={onBump} onItem={onItem} multiStation={multiStation} />)}
      </div>
      {more && <button className="kd-more" onClick={() => body.current?.scrollBy({ top: body.current.clientHeight * 0.8, behavior: 'smooth' })}><ArrowDown size="1.1em" /> المزيد</button>}
    </section>
  );
}

function Ticket({ o, l, lv, isNew, canAct, busy, onBump, onItem, multiStation }) {
  const TypeIcon = TYPE_ICON[o.type] || ShoppingBag;
  const where = o.table_name || (o.event_name ? `${o.event_name}${o.place ? ` · ${o.place}` : ''}` : TYPE_LABEL[o.type]);
  const online = o.source === 'online';
  const items = o.items;
  return (
    <article className={`kd-t lv-${lv.lv} ${isNew ? 'is-new' : ''}`}>
      <header className="kd-t-head">
        <div className="kd-t-where">
          <span className="kd-t-ico" aria-hidden>{o.event_name ? <Building2 size="1.2em" /> : <TypeIcon size="1.2em" />}</span>
          <div><strong>{where}</strong><small>{o.type !== 'dine_in' && o.customer_name ? `${TYPE_LABEL[o.type]} · ${o.customer_name}` : TYPE_LABEL[o.type]}</small></div>
        </div>
        <div className="kd-t-time" title={l.k === 'ready' ? 'منذ أن جهز' : 'منذ الإرسال للمطبخ'}>
          <b dir="ltr">{fmtSec(lv.sec)}</b>
          {lv.lv === 'late' && <TriangleAlert size="1em" aria-hidden />}
        </div>
        <i className="kd-sla" style={{ '--p': `${lv.pct}%` }} aria-hidden />
        {isNew && <span className="kd-newtag">جديد</span>}
      </header>
      <div className="kd-t-meta">
        <span dir="ltr" className="kd-code">{o.code}</span>
        <span>{online ? <><QrCode size="1em" aria-hidden /> طلب الزبون</> : (o.sent_by_name || o.waiter_name || '—')}</span>
        {o.guests ? <span><Users size="1em" aria-hidden /> {o.guests}</span> : null}
        <span dir="ltr">{timeOf(o.sent_at)}</span>
      </div>
      {o.notes && <div className="kd-t-note"><StickyNote size="1.1em" aria-hidden /> {o.notes}</div>}
      <ul className="kd-items">
        {items.map((i) => (
          <li key={i.id}>
            <button className={`kd-item si-${i.status}`} onClick={() => onItem(i)} disabled={!canAct || busy} aria-label={`${i.qty} ${i.name}، اضغط لتغيير الحالة`}>
              <span className="kd-qty">{i.qty}</span>
              <span className="kd-iname">
                <strong>{i.name}</strong>
                {i.modifiers.length > 0 && <span className="kd-mods">{i.modifiers.map((m) => <em key={m.id}>{m.name}</em>)}</span>}
                {i.notes && <span className="kd-inote"><StickyNote size="1em" aria-hidden /> {i.notes}</span>}
              </span>
              {multiStation && STATIONS[i.station] && <span className={`kd-stn s-${i.station}`}>{STATIONS[i.station]}</span>}
              <span className="kd-state" aria-hidden>{i.status === 'ready' ? <Check size="1.2em" /> : i.status === 'preparing' ? <Flame size="1.1em" /> : <span className="kd-pip" />}</span>
            </button>
          </li>
        ))}
      </ul>
      <footer className="kd-t-foot">
        <button className={`kd-go go-${l.k}`} onClick={() => onBump(o, l.next)} disabled={!canAct || busy}><l.icon size="1.3em" /> {canAct ? l.action : 'عرض فقط'}</button>
      </footer>
    </article>
  );
}
