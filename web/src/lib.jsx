import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, getSocket } from './api.js';

export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export const ROLE_LABELS = {
  admin: 'المدير العام', manager: 'مدير الفرع', cashier: 'كاشير', waiter: 'نادل', kitchen: 'المطبخ',
};
export const ORDER_TYPES = { dine_in: 'صالة', takeaway: 'سفري', delivery: 'توصيل' };
export const PAY_METHODS = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة' };
export const STATIONS = { kitchen: 'المطبخ', grill: 'المشويات', drinks: 'المشروبات', dessert: 'الحلويات' };
export const ITEM_STATUS = {
  pending: 'لم يُرسل', new: 'جديد', preparing: 'قيد التحضير', ready: 'جاهز', served: 'تم التقديم', cancelled: 'ملغى',
};

export function useMoney() {
  const { settings } = useApp();
  return useCallback((n) => `${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${settings?.currency || ''}`, [settings]);
}

export const can = (user, ...roles) => !!user && (user.role === 'admin' || roles.includes(user.role));

/** جلب بيانات مع إعادة الجلب عند أحداث لحظية */
export function useData(path, events = [], deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const d = await api(pathRef.current);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setData(null); setLoading(true); reload(); }, [path, ...deps]); // eslint-disable-line

  useEffect(() => {
    const s = getSocket();
    if (!s || !events.length) return;
    const h = () => reload();
    events.forEach((e) => s.on(e, h));
    s.on('connect', h);
    return () => { events.forEach((e) => s.off(e, h)); s.off('connect', h); };
  }, [events.join(',')]); // eslint-disable-line

  return { data, error, loading, reload, setData };
}

// ───── إشعارات ─────
export const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastHost({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

/** تنفيذ إجراء مع إظهار الخطأ */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      toast(e.message, 'err');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Empty({ icon = '📭', text }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><p>{text}</p></div>;
}

export function Loading() {
  return <div className="loading"><span className="spinner" /> جارِ التحميل…</div>;
}

export function PageHead({ title, children, sub }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}

/** الوقت المنقضي بالدقائق منذ تاريخ محلي "YYYY-MM-DD HH:MM:SS" */
export function minutesSince(ts) {
  if (!ts) return 0;
  const d = new Date(ts.replace(' ', 'T'));
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
}

export function useNow(interval = 30000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), interval);
    return () => clearInterval(t);
  }, [interval]);
}

export const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const timeOf = (ts) => (ts ? ts.slice(11, 16) : '');
