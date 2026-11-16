import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ReceiptText, Armchair, ClipboardList, ChefHat, CalendarDays, Wallet,
  UtensilsCrossed, Package, Users as UsersIcon, ChartColumn, ShieldCheck, Settings as SettingsIcon, LogOut, Menu as MenuIcon, Wifi, WifiOff,
} from 'lucide-react';
import {
  api, connectSocket, disconnectSocket, getToken, setToken, needsServerUrl, setUnauthorizedHandler, getServerUrl,
} from './api.js';
import { AppContext, ROLE_LABELS, can, Loading } from './lib.jsx';
import Login from './pages/Login.jsx';
import ServerSetup from './pages/ServerSetup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Pos from './pages/Pos.jsx';
import Tables from './pages/Tables.jsx';
import Orders from './pages/Orders.jsx';
import Kitchen from './pages/Kitchen.jsx';
import MenuAdmin from './pages/MenuAdmin.jsx';
import Inventory from './pages/Inventory.jsx';
import Reservations from './pages/Reservations.jsx';
import Shifts from './pages/Shifts.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';
import Customers from './pages/Customers.jsx';
import Settings from './pages/Settings.jsx';

// عناصر القائمة الجانبية مع الأدوار المسموح لها، مجمّعة في أقسام
const NAV = [
  { group: 'العمليات اليومية', items: [
    { to: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, roles: ['manager'] },
    { to: '/pos', label: 'نقطة البيع', icon: ReceiptText, roles: ['cashier', 'waiter', 'manager'] },
    { to: '/tables', label: 'الطاولات', icon: Armchair, roles: ['cashier', 'waiter', 'manager'] },
    { to: '/orders', label: 'الطلبات', icon: ClipboardList, roles: ['cashier', 'waiter', 'manager'] },
    { to: '/kitchen', label: 'شاشة المطبخ', icon: ChefHat, roles: ['kitchen', 'manager'] },
    { to: '/reservations', label: 'الحجوزات', icon: CalendarDays, roles: ['cashier', 'waiter', 'manager'] },
    { to: '/shifts', label: 'الورديات', icon: Wallet, roles: ['cashier', 'manager'] },
  ] },
  { group: 'الإدارة', items: [
    { to: '/menu', label: 'قائمة الطعام', icon: UtensilsCrossed, roles: ['manager'] },
    { to: '/inventory', label: 'المخزون', icon: Package, roles: ['manager', 'kitchen'] },
    { to: '/customers', label: 'العملاء', icon: UsersIcon, roles: ['cashier', 'manager'] },
    { to: '/reports', label: 'التقارير', icon: ChartColumn, roles: ['manager'] },
    { to: '/users', label: 'المستخدمون', icon: ShieldCheck, roles: ['manager'] },
    { to: '/settings', label: 'الإعدادات', icon: SettingsIcon, roles: ['manager'] },
  ] },
];
const ALL_NAV = NAV.flatMap((g) => g.items);

const HOME = { admin: '/dashboard', manager: '/dashboard', cashier: '/pos', waiter: '/tables', kitchen: '/kitchen' };

export default function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [booting, setBooting] = useState(true);
  const [serverMissing, setServerMissing] = useState(needsServerUrl());
  const [online, setOnline] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const logout = useCallback(() => {
    setToken(null);
    disconnectSocket();
    setUser(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(logout), [logout]);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const startSession = useCallback(async () => {
    const [me, s] = await Promise.all([api('/auth/me'), api('/settings')]);
    const sock = connectSocket();
    sock.on('connect', () => setOnline(true));
    sock.on('disconnect', () => setOnline(false));
    sock.on('settings', () => api('/settings').then(setSettings).catch(() => {}));
    setSettings(s);
    setUser(me);
  }, []);

  useEffect(() => {
    if (serverMissing) { setBooting(false); return; }
    if (!getToken()) { setBooting(false); return; }
    startSession().catch(() => setToken(null)).finally(() => setBooting(false));
  }, [serverMissing, startSession]);

  if (booting) return <div className="center-screen"><Loading /></div>;
  if (serverMissing) return <ServerSetup onDone={() => setServerMissing(false)} />;
  if (!user) {
    return (
      <Login
        onLogin={async (token) => { setToken(token); await startSession(); }}
        onChangeServer={() => setServerMissing(true)}
      />
    );
  }

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => can(user, ...n.roles)) })).filter((g) => g.items.length);
  const home = HOME[user.role];
  const current = ALL_NAV.find((n) => location.pathname.startsWith(n.to));

  return (
    <AppContext.Provider value={{ user, settings, setSettings, logout }}>
      <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
        <aside className="sidebar" aria-label="القائمة الرئيسية">
          <div className="brand">
            <span className="brand-mark" aria-hidden><UtensilsCrossed size={20} strokeWidth={2.2} /></span>
            <div className="brand-text">
              <strong>{settings?.restaurant_name}</strong>
              <small>نظام إدارة المطعم</small>
            </div>
          </div>
          <nav>
            {groups.map((g) => (
              <div key={g.group} className="nav-group">
                <span className="nav-group-label">{g.group}</span>
                {g.items.map((n) => (
                  <NavLink key={n.to} to={n.to} className="nav-link">
                    <n.icon size={19} strokeWidth={1.8} aria-hidden />
                    <span>{n.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="me">
              <div className="avatar" aria-hidden>{user.name.slice(0, 1)}</div>
              <div className="me-text"><strong>{user.name}</strong><small>{ROLE_LABELS[user.role]}</small></div>
              <button className="icon-btn" onClick={logout} aria-label="تسجيل الخروج" title="تسجيل الخروج"><LogOut size={18} /></button>
            </div>
          </div>
        </aside>
        <div className="scrim" onClick={() => setMenuOpen(false)} />
        <main className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="فتح القائمة"><MenuIcon size={22} /></button>
            <div className="topbar-title">
              {current && <current.icon size={20} strokeWidth={1.8} aria-hidden />}
              <span>{current?.label || settings?.restaurant_name}</span>
            </div>
            <span className={`conn ${online ? 'on' : 'off'}`} title={getServerUrl() || 'الخادم'}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              {online ? 'متصل' : 'غير متصل'}
            </span>
          </header>
          <div className="content">
            <Routes>
              <Route path="/" element={<Navigate to={home} replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/pos/:orderId?" element={<Pos />} />
              <Route path="/tables" element={<Tables />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/kitchen" element={<Kitchen />} />
              <Route path="/reservations" element={<Reservations />} />
              <Route path="/shifts" element={<Shifts />} />
              <Route path="/menu" element={<MenuAdmin />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/users" element={<Users />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to={home} replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </AppContext.Provider>
  );
}
