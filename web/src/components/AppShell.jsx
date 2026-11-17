import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { House, Ellipsis, ArrowRight, Sun, Moon, SunMoon, LogOut, Monitor, UtensilsCrossed, X, Wifi, WifiOff } from 'lucide-react';
import { ROLE_LABELS } from '../lib.jsx';
import { NotificationBell } from '../notifications.jsx';
import { NAV_ICON } from '../pages/Home.jsx';
import { isNative } from '../api.js';
import { setAppUi, tick } from '../appui.js';

/** شاشة افتتاحية قصيرة عند فتح التطبيق */
function Splash({ name }) {
  const [gone, setGone] = useState(() => { try { return sessionStorage.getItem('ph-splash') === '1'; } catch { return false; } });
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (gone) return undefined;
    const a = setTimeout(() => setOut(true), 1100);
    const b = setTimeout(() => { setGone(true); try { sessionStorage.setItem('ph-splash', '1'); } catch { /* */ } }, 1500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [gone]);
  if (gone) return null;
  return (
    <div className={`ap-splash ${out ? 'out' : ''}`} aria-hidden>
      <span className="ap-splash-mark"><UtensilsCrossed size={42} strokeWidth={2} /></span>
      <strong>{name || 'مطعمي'}</strong>
      <i />
    </div>
  );
}

/**
 * إطار تطبيق الجوال: رأس متدرج + شريط تنقل عائم بمؤشر منزلق + ورقة «المزيد»
 */
export default function AppShell({ user, settings, groups, allowed, current, online, themeIcon: ThemeIcon, themeLabel, cycleTheme, logout, focusMode, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [location.pathname]);

  // اهتزاز خفيف عند لمس الأزرار والبلاط
  useEffect(() => {
    const h = (e) => { if (e.target.closest?.('button, a, .hm-tile')) tick(6); };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  const QUICK = ['/tables', '/orders', '/kitchen', '/cashier', '/live', '/dashboard', '/attendance'];
  const nav = useMemo(() => {
    const items = QUICK.map((to) => allowed.find((n) => n.to === to)).filter(Boolean).slice(0, 3);
    return [{ to: '/home', label: 'الرئيسية', icon: House }, ...items.map((n) => ({ ...n, icon: NAV_ICON[n.to] || n.icon }))];
  }, [allowed]);
  const idx = nav.findIndex((n) => location.pathname === n.to || (n.to !== '/home' && location.pathname.startsWith(n.to)));
  const total = nav.length + 1;                       // + زر «المزيد»
  const isRoot = location.pathname === '/home' || nav.some((n) => location.pathname === n.to);
  const title = location.pathname === '/home' ? (settings?.restaurant_name || 'مطعمي') : (current?.label || (location.pathname.startsWith('/pos') ? 'الطلب' : settings?.restaurant_name));

  return (
    <div className="ap">
      <Splash name={settings?.restaurant_name} />
      <header className="ap-top">
        {isRoot
          ? <button className="ap-avatar" onClick={() => setMore(true)} aria-label="القائمة والحساب">{user.name.slice(0, 1)}</button>
          : <button className="ap-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/home'))} aria-label="رجوع"><ArrowRight size={22} /></button>}
        <div className="ap-title"><strong>{title}</strong>{location.pathname === '/home' && <small>{ROLE_LABELS[user.role]}</small>}</div>
        <span className={`ap-conn ${online ? 'on' : 'off'}`} title={online ? 'متصل' : 'غير متصل'}>{online ? <Wifi size={14} /> : <WifiOff size={14} />}</span>
        <button className="ap-icon" onClick={cycleTheme} aria-label={themeLabel}><ThemeIcon size={19} /></button>
        <NotificationBell />
      </header>

      <main className="ap-content"><div className="ap-page" key={location.pathname}>{children}</div></main>

      {!focusMode && (
        <nav className="ap-nav" style={{ '--n': total, '--i': idx < 0 ? total - 1 : idx }} aria-label="التنقل">
          <span className={`ap-ind ${idx < 0 ? 'none' : ''}`} aria-hidden />
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className="ap-nav-item" end={n.to === '/home'}>
              <n.icon size={23} strokeWidth={1.9} aria-hidden /><span>{n.label}</span>
            </NavLink>
          ))}
          <button className={`ap-nav-item ${more ? 'active' : ''}`} onClick={() => setMore(true)} aria-label="المزيد"><Ellipsis size={23} aria-hidden /><span>المزيد</span></button>
        </nav>
      )}

      {more && (
        <div className="ap-sheet-wrap" onClick={() => setMore(false)}>
          <section className="ap-sheet" role="dialog" aria-modal="true" aria-label="القائمة" onClick={(e) => e.stopPropagation()}>
            <span className="ap-grab" aria-hidden />
            <header>
              <span className="ap-avatar lg" aria-hidden>{user.name.slice(0, 1)}</span>
              <div><strong>{user.name}</strong><small>{ROLE_LABELS[user.role]} · {settings?.restaurant_name}</small></div>
              <button className="ap-icon" onClick={() => setMore(false)} aria-label="إغلاق"><X size={20} /></button>
            </header>
            <div className="ap-sheet-body">
              {groups.map((g) => (
                <div key={g.group}>
                  <h3>{g.group}</h3>
                  <div className="ap-grid">
                    {g.items.map((n) => {
                      const Icon = NAV_ICON[n.to] || n.icon;
                      return <NavLink key={n.to} to={n.to} className="ap-cell"><span><Icon size={20} aria-hidden /></span><em>{n.label}</em></NavLink>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <footer>
              <button className="ap-act" onClick={cycleTheme}><ThemeIcon size={18} /> {themeLabel}</button>
              {!isNative && <button className="ap-act" onClick={() => { setAppUi(false); window.location.reload(); }}><Monitor size={18} /> واجهة الويب</button>}
              <button className="ap-act danger" onClick={() => { if (window.confirm('تسجيل الخروج؟')) logout(); }}><LogOut size={18} /> خروج</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
