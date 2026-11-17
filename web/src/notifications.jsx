// نظام الإشعارات: الجرس، اللوحة، التنبيهات المنبثقة، الصوت، وإشعارات الجهاز
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, CheckCheck, ChefHat, CircleCheckBig, CalendarOff, PackageX, X, Volume2, VolumeX, Smartphone, Trash2, Info,
  ReceiptText, ArrowLeft, ShieldAlert, QrCode,
} from 'lucide-react';
import { api, getSocket, isNative } from './api.js';
import { setupPush, pushActive } from './push.js';

const NotifContext = createContext(null);
export const useNotifications = () => useContext(NotifContext);

const ICONS = { order_new: ChefHat, order_ready: CircleCheckBig, bill_request: ReceiptText, leave_request: CalendarOff, leave_decided: CalendarOff, low_stock: PackageX, test: BellRing, attendance_alert: ShieldAlert, qr_request: QrCode, qr_request_taken: QrCode, online_confirm: QrCode, online_order: QrCode, qr_alert: ShieldAlert };
const TYPE_LABEL = { order_new: 'طلب جديد', order_ready: 'جاهز للتقديم', bill_request: 'طلب الحساب', leave_request: 'طلب إجازة', leave_decided: 'إجازة', low_stock: 'المخزون', test: 'تجربة', attendance_alert: 'تنبيه حضور', qr_request: 'طلب فتح طاولة', qr_request_taken: 'تم الاستلام', online_confirm: 'بانتظار التأكيد', online_order: 'طلب QR', qr_alert: 'تنبيه أمان' };
const ACTION = { order_new: 'شاشة المطبخ', order_ready: 'فتح الطلب', bill_request: 'تحصيل', leave_request: 'مراجعة', leave_decided: 'عرض', low_stock: 'المخزون', attendance_alert: 'التقارير', qr_request: 'استلام الطلب', qr_request_taken: 'عرض الطاولة', online_confirm: 'تأكيد الطلب', online_order: 'فتح الطلب', qr_alert: 'عرض' };
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// إشعارات تحتاج تصرفاً سريعاً: تبقى ظاهرة وتُكرَّر نغمتها وتومض في عنوان التبويب حتى لو كانت الصفحة في الخلفية
const PRIORITY = new Set(['qr_request', 'online_confirm', 'online_order', 'bill_request']);
let titleTimer = null; let baseTitle = '';
function flashTitle(text) {
  if (!document.hidden) return;
  if (!titleTimer) baseTitle = document.title;
  clearInterval(titleTimer);
  let on = false;
  titleTimer = setInterval(() => { document.title = (on = !on) ? `🔔 ${text}` : baseTitle; }, 1000);
  const stop = () => {
    if (document.hidden) return;
    clearInterval(titleTimer); titleTimer = null; document.title = baseTitle;
    document.removeEventListener('visibilitychange', stop);
  };
  document.addEventListener('visibilitychange', stop);
}

/** نغمة قصيرة: نغمتان صاعدتان للجاهز، ونغمة للطلب الجديد */
function chime(kind) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = chime.ctx || (chime.ctx = new Ctx());
    if (ctx.state === 'suspended') ctx.resume();
    const notes = kind === 'success' ? [784, 1047] : kind === 'warning' ? [523, 440] : [660, 880, 660];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.3);
    });
  } catch { /* لا يوجد صوت */ }
}

/** إشعار نظام التشغيل (المتصفح أو تطبيق الأندرويد) */
async function deviceNotify(n) {
  try {
    if (isNative) {
      if (pushActive()) return; // Firebase سيعرض الإشعار، فلا نكرره
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2e9), title: n.title, body: n.body || '' }] });
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      const sys = new Notification(n.title, { body: n.body || '', icon: './icon.svg', tag: `${n.type}-${n.title}`, lang: 'ar', dir: 'rtl', requireInteraction: PRIORITY.has(n.type) });
      sys.onclick = () => { window.focus(); sys.close(); };
    }
  } catch { /* غير مدعوم */ }
}

export async function devicePermission() {
  if (isNative) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const p = await LocalNotifications.checkPermissions();
    return p.display;
  }
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function requestDevicePermission() {
  if (isNative) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    return (await LocalNotifications.requestPermissions()).display;
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

export function NotificationsProvider({ user, children }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [sound, setSound] = useState(safeGet('notifSound') !== '0');
  const [push, setPush] = useState({ state: isNative ? 'pending' : 'unsupported' });
  const enablePush = useCallback(async () => {
    setPush({ state: 'pending' });
    const r = await setupPush(navigate).catch((e) => ({ state: 'denied', detail: e?.message }));
    setPush(r);
    return r;
  }, [navigate]);
  useEffect(() => { if (isNative) enablePush(); }, [user.id]); // eslint-disable-line
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const lastId = useRef(null);       // آخر إشعار عُرض (null = لم يُحمَّل بعد، فلا نعرض القديم)
  const active = useRef(new Set());  // الإشعارات الظاهرة الآن

  const dismiss = useCallback((id) => { active.current.delete(id); setToasts((t) => t.filter((x) => x.id !== id)); }, []);

  // عرض الإشعارات الجديدة فوراً (مصدرها الحدث اللحظي، ومعها فحص دوري كشبكة أمان)
  const present = useCallback((list) => {
    const max = list.reduce((m, r) => Math.max(m, r.id), 0);
    if (lastId.current === null) { lastId.current = max; return; }
    const fresh = list.filter((r) => r.id > lastId.current && !r.read_at).sort((a, b) => a.id - b.id);
    lastId.current = Math.max(lastId.current, max);
    for (const r of fresh) {
      const id = Math.random();
      const hot = PRIORITY.has(r.type);
      active.current.add(id);
      setToasts((t) => [...t.slice(-3), { ...r, id, hot }]);
      setTimeout(() => dismiss(id), hot ? 60000 : 8000);
      if (soundRef.current) {
        chime(r.level);
        if (hot) { let k = 0; const iv = setInterval(() => { if (!active.current.has(id) || ++k > 3) { clearInterval(iv); return; } chime(r.level); }, 6000); }
      }
      if (navigator.vibrate) navigator.vibrate(hot ? [200, 100, 200, 100, 300] : r.level === 'success' ? [80, 60, 80] : 120);
      if (hot) flashTitle(r.title);
      deviceNotify(r);
    }
  }, [dismiss]);

  const load = useCallback(async () => {
    try {
      const d = await api('/notifications');
      setRows(d.rows);
      setUnread(d.unread);
      present(d.rows);
    } catch { /* ignore */ }
  }, [present]);

  useEffect(() => {
    lastId.current = null;
    load();
    const s = getSocket();
    // الحدث اللحظي يجلب القائمة فوراً فيظهر الإشعار في نفس اللحظة
    const onNotify = (n) => { if (n?.user_ids?.includes(user.id)) load(); };
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', vis);
    const poll = setInterval(load, 15000);   // شبكة أمان إن انقطع الاتصال اللحظي
    if (s) { s.on('notify', onNotify); s.on('connect', load); s.on('notifications', load); }
    return () => {
      document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', vis); clearInterval(poll);
      if (s) { s.off('notify', onNotify); s.off('connect', load); s.off('notifications', load); }
    };
  }, [user.id, load]);

  const markRead = useCallback(async (ids) => {
    await api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }).catch(() => {});
    load();
  }, [load]);

  const clearRead = useCallback(async () => {
    await api('/notifications', { method: 'DELETE' }).catch(() => {});
    load();
  }, [load]);

  const toggleSound = () => { const v = !sound; setSound(v); safeSet('notifSound', v ? '1' : '0'); if (v) chime('info'); };

  const open = (n) => {
    if (!n.read_at && n.id) markRead([n.id]);
    if (n.link) navigate(n.link);
  };

  return (
    <NotifContext.Provider value={{ rows, unread, markRead, clearRead, open, sound, toggleSound, reload: load, push, enablePush }}>
      {children}
      <PermNudge />
      <div className="ntoasts" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div key={t.id} className={`ntoast ntoast-${t.level} ${t.hot ? 'ntoast-hot' : ''}`} role={t.hot ? 'alert' : 'status'}>
              <span className="ntoast-icon" aria-hidden><Icon size={20} /></span>
              <div className="ntoast-body">
                <span className="ntoast-kicker">{TYPE_LABEL[t.type] || 'إشعار'} · الآن</span>
                <strong>{t.title}</strong>
                {t.body && <span>{t.body}</span>}
                {t.link && ACTION[t.type] && (
                  <button className="ntoast-action" onClick={() => { dismiss(t.id); navigate(t.link); }}>
                    {ACTION[t.type]} <ArrowLeft size={14} aria-hidden />
                  </button>
                )}
              </div>
              <button className="icon-btn ntoast-close" onClick={() => dismiss(t.id)} aria-label="إغلاق"><X size={16} /></button>
              <span className="ntoast-timer" aria-hidden style={t.hot ? { animationDuration: '60s' } : undefined} />
            </div>
          );
        })}
      </div>
    </NotifContext.Provider>
  );
}

function dayGroup(ts) {
  const d = new Date(ts.replace(' ', 'T')); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - d) / 864e5);
  return diff === 0 ? 'اليوم' : diff === 1 ? 'أمس' : 'أقدم';
}

function ago(ts) {
  const d = new Date(ts.replace(' ', 'T'));
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 1) return 'الآن';
  if (m < 60) return `منذ ${m} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `منذ ${h} س`;
  return ts.slice(0, 10);
}

/** زر الجرس ولوحة الإشعارات */
export function NotificationBell() {
  const { rows, unread, markRead, clearRead, open, sound, toggleSound, push, enablePush } = useNotifications();
  const [show, setShow] = useState(false);
  const [tab, setTab] = useState('all');
  const [perm, setPerm] = useState('default');
  const ref = useRef(null);

  useEffect(() => { devicePermission().then(setPerm).catch(() => setPerm('unsupported')); }, [show]);
  useEffect(() => {
    if (!show) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setShow(false); };
    const k = (e) => e.key === 'Escape' && setShow(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [show]);

  return (
    <div className="nbell" ref={ref}>
      <button className={`icon-btn nbell-btn ${unread ? 'has' : ''}`} onClick={() => setShow(!show)} aria-label={`الإشعارات${unread ? `، ${unread} غير مقروءة` : ''}`} aria-expanded={show}>
        {unread ? <BellRing size={20} /> : <Bell size={20} />}
        {unread > 0 && <span className="nbell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {show && (
        <div className="npanel" role="dialog" aria-label="الإشعارات">
          <header className="npanel-head">
            <strong>الإشعارات</strong>
            <div className="row gap-s">
              <button className="icon-btn" onClick={toggleSound} aria-label={sound ? 'كتم الصوت' : 'تشغيل الصوت'} title={sound ? 'الصوت مفعّل' : 'الصوت مكتوم'}>
                {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              {unread > 0 && <button className="btn btn-sm btn-ghost" onClick={() => markRead()}><CheckCheck size={16} /> قراءة الكل</button>}
            </div>
          </header>
          {perm === 'default' && (
            <button className="npanel-perm" onClick={async () => setPerm(await requestDevicePermission())}>
              <Smartphone size={18} aria-hidden />
              <span><strong>فعّل إشعارات الجهاز</strong><small>لتصلك التنبيهات حتى لو كانت الصفحة في الخلفية</small></span>
            </button>
          )}
          {perm === 'denied' && <p className="npanel-note">إشعارات الجهاز محظورة. يمكنك السماح بها من إعدادات المتصفح أو التطبيق.</p>}
          {isNative && push.state === 'denied' && (
            <button className="npanel-perm" onClick={enablePush}>
              <BellRing size={18} aria-hidden />
              <span><strong>تفعيل الإشعارات الفورية</strong><small>لتصلك الطلبات الجاهزة حتى والتطبيق مغلق</small></span>
            </button>
          )}
          <div className="npanel-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>الكل</button>
            <button role="tab" aria-selected={tab === 'unread'} className={tab === 'unread' ? 'active' : ''} onClick={() => setTab('unread')}>
              غير المقروءة {unread > 0 && <span className="npanel-tab-count">{unread}</span>}
            </button>
          </div>
          <div className="npanel-list">
            {(() => {
              const list = rows.filter((n) => tab === 'all' || !n.read_at);
              if (!list.length) {
                return <div className="empty"><span className="empty-icon" aria-hidden><Bell size={24} /></span><p>{tab === 'unread' ? 'لا توجد إشعارات غير مقروءة' : 'لا توجد إشعارات'}</p></div>;
              }
              const groups = [];
              list.forEach((n) => {
                const g = dayGroup(n.created_at);
                if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, items: [] });
                groups[groups.length - 1].items.push(n);
              });
              return groups.map(({ g, items }) => (
                <div key={g} className="ngroup">
                  <div className="ngroup-title">{g}</div>
                  {items.map((n) => {
                    const Icon = ICONS[n.type] || Info;
                    return (
                      <button key={n.id} className={`nitem nitem-${n.level} ${n.read_at ? '' : 'unread'}`} onClick={() => { open(n); setShow(false); }}>
                        <span className="nitem-icon" aria-hidden><Icon size={18} /></span>
                        <span className="nitem-text">
                          <span className="nitem-top"><span className="nitem-type">{TYPE_LABEL[n.type] || 'إشعار'}</span><small>{ago(n.created_at)}</small></span>
                          <strong>{n.title}</strong>
                          {n.body && <span>{n.body}</span>}
                        </span>
                        {!n.read_at && <span className="nitem-dot" aria-label="غير مقروء" />}
                      </button>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
          {rows.some((n) => n.read_at) && (
            <footer className="npanel-foot"><button className="btn btn-sm btn-ghost" onClick={clearRead}><Trash2 size={15} /> حذف المقروءة</button></footer>
          )}
        </div>
      )}
    </div>
  );
}

/** دعوة لتفعيل إشعارات المتصفح (تصل والصفحة في تبويب آخر) */
function PermNudge() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (isNative || safeGet('notifAsk') === '1') return;
    devicePermission().then((p) => setShow(p === 'default')).catch(() => {});
  }, []);
  if (!show) return null;
  const later = () => { safeSet('notifAsk', '1'); setShow(false); };
  return (
    <div className="perm-nudge" role="region" aria-label="تفعيل الإشعارات">
      <BellRing size={20} aria-hidden />
      <span>فعّل إشعارات المتصفح ليصلك كل طلب وطلب QR فوراً حتى والصفحة في تبويب آخر.</span>
      <button className="btn btn-primary btn-sm" onClick={async () => { await requestDevicePermission(); later(); }}>تفعيل</button>
      <button className="icon-btn" onClick={later} aria-label="لاحقاً"><X size={16} /></button>
    </div>
  );
}
