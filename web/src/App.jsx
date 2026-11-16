import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
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

// عناصر القائمة الجانبية مع الأدوار المسموح لها
const NAV = [
  { to: '/dashboard', label: 'الرئيسية', icon: '🏠', roles: ['manager'] },
  { to: '/pos', label: 'نقطة البيع', icon: '🧾', roles: ['cashier', 'waiter', 'manager'] },
  { to: '/tables', label: 'الطاولات', icon: '🪑', roles: ['cashier', 'waiter', 'manager'] },
  { to: '/orders', label: 'الطلبات', icon: '📋', roles: ['cashier', 'waiter', 'manager'] },
  { to: '/kitchen', label: 'شاشة المطبخ', icon: '👨‍🍳', roles: ['kitchen', 'manager'] },
  { to: '/reservations', label: 'الحجوزات', icon: '📅', roles: ['cashier', 'waiter', 'manager'] },
  { to: '/shifts', label: 'الورديات', icon: '💵', roles: ['cashier', 'manager'] },
  { to: '/menu', label: 'قائمة الطعام', icon: '🍽️', roles: ['manager'] },
  { to: '/inventory', label: 'المخزون', icon: '📦', roles: ['manager', 'kitchen'] },
  { to: '/customers', label: 'العملاء', icon: '👥', roles: ['cashier', 'manager'] },
  { to: '/reports', label: 'التقارير', icon: '📊', roles: ['manager'] },
  { to: '/users', label: 'المستخدمون', icon: '🔐', roles: ['manager'] },
  { to: '/settings', label: 'الإعدادات', icon: '⚙️', roles: ['manager'] },
];

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

  const nav = NAV.filter((n) => can(user, ...n.roles));
  const home = HOME[user.role];

  return (
    <AppContext.Provider value={{ user, settings, setSettings, logout }}>
      <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
        <aside className="sidebar">
          <div className="brand">
            <img src="./icon.svg" alt="" width="36" height="36" />
            <div>
              <strong>{settings?.restaurant_name}</strong>
              <small>نظام إدارة المطعم</small>
            </div>
          </div>
          <nav>
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className="nav-link">
                <span className="nav-icon" aria-hidden>{n.icon}</span>{n.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="me">
              <div className="avatar">{user.name.slice(0, 1)}</div>
              <div><strong>{user.name}</strong><small>{ROLE_LABELS[user.role]}</small></div>
            </div>
            <button className="btn btn-ghost btn-block" onClick={logout}>تسجيل الخروج</button>
          </div>
        </aside>
        <div className="scrim" onClick={() => setMenuOpen(false)} />
        <main className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="القائمة">☰</button>
            <strong className="topbar-title">{settings?.restaurant_name}</strong>
            <span className={`conn ${online ? 'on' : 'off'}`} title={getServerUrl() || 'الخادم'}>
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
