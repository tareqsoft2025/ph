import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ReceiptText, Armchair, ClipboardList, ChefHat, CalendarDays, Wallet,
  UtensilsCrossed, Package, Users as UsersIcon, ChartColumn, IdCard, Fingerprint, CalendarOff, Banknote, HandCoins, History, KeyRound, ShieldCheck, Settings as SettingsIcon, LogOut, Menu as MenuIcon, Wifi, WifiOff,
} from 'lucide-react';
import {
  api, connectSocket, disconnectSocket, getToken, setToken, needsServerUrl, setUnauthorizedHandler, getServerUrl,
} from './api.js';
import { AppContext, ROLE_LABELS, has, Loading } from './lib.jsx';
import { NotificationsProvider, NotificationBell } from './notifications.jsx';
import ApkDownload from './components/ApkDownload.jsx';
import AttendanceGate from './components/AttendanceGate.jsx';
import { teardownPush } from './push.js';
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
import Employees from './pages/Employees.jsx';
import EmployeeProfile from './pages/EmployeeProfile.jsx';
import Attendance from './pages/Attendance.jsx';
import Leaves from './pages/Leaves.jsx';
import Payroll from './pages/Payroll.jsx';
import Cashier from './pages/Cashier.jsx';
import Activity from './pages/Activity.jsx';
import Permissions from './pages/Permissions.jsx';

// عناصر القائمة الجانبية مع الصلاحيات المطلوبة (يكفي امتلاك واحدة)
const NAV = [
  { group: 'العمليات اليومية', items: [
    { to: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, perms: ['reports.view'] },
    { to: '/cashier', label: 'الكاشير', icon: Banknote, perms: ['payments.collect'] },
    { to: '/tables', label: 'الطاولات', icon: Armchair, perms: ['tables.view', 'pos.create'] },
    { to: '/orders', label: 'الطلبات', icon: ClipboardList, perms: ['orders.view', 'pos.create', 'payments.collect'] },
    { to: '/kitchen', label: 'شاشة المطبخ', icon: ChefHat, perms: ['kitchen.view', 'kitchen.update'] },
    { to: '/reservations', label: 'الحجوزات', icon: CalendarDays, perms: ['reservations.manage'] },
    { to: '/shifts', label: 'الورديات', icon: Wallet, perms: ['shifts.manage', 'reports.view'] },
  ] },
  { group: 'الموارد البشرية', items: [
    { to: '/attendance', label: 'الحضور والانصراف', icon: Fingerprint, perms: ['*'] },
    { to: '/leaves', label: 'الإجازات', icon: CalendarOff, perms: ['*'] },
    { to: '/employees', label: 'الموظفون', icon: IdCard, perms: ['hr.employees'] },
    { to: '/payroll', label: 'الرواتب', icon: HandCoins, perms: ['hr.payroll'] },
  ] },
  { group: 'الإدارة', items: [
    { to: '/menu', label: 'قائمة الطعام', icon: UtensilsCrossed, perms: ['menu.manage'] },
    { to: '/inventory', label: 'المخزون', icon: Package, perms: ['inventory.view', 'inventory.receive', 'inventory.manage'] },
    { to: '/customers', label: 'العملاء', icon: UsersIcon, perms: ['customers.view'] },
    { to: '/reports', label: 'التقارير', icon: ChartColumn, perms: ['reports.view'] },
    { to: '/activity', label: 'سجل الحركات', icon: History, perms: ['activity.view'] },
    { to: '/users', label: 'المستخدمون', icon: ShieldCheck, perms: ['users.manage'] },
    { to: '/permissions', label: 'الصلاحيات', icon: KeyRound, perms: ['__admin'] },
    { to: '/settings', label: 'الإعدادات', icon: SettingsIcon, perms: ['settings.manage'] },
  ] },
];
const ALL_NAV = NAV.flatMap((g) => g.items);
const allowed = (user, n) => n.perms.includes('*') || (n.perms.includes('__admin') ? user.role === 'admin' : has(user, ...n.perms));

// الصفحة الرئيسية المفضلة لكل دور (إن كانت مسموحة)
// صفحة الطلب تُفتح من الطاولة دائماً (/pos?type=dine_in&table=..)
const PREFERRED = { admin: '/dashboard', manager: '/dashboard', cashier: '/cashier', waiter: '/tables', kitchen: '/kitchen', staff: '/attendance' };

export default function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [booting, setBooting] = useState(true);
  const [serverMissing, setServerMissing] = useState(needsServerUrl());
  const [online, setOnline] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const logout = useCallback(async () => {
    await teardownPush();
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
    // تحديث الصلاحيات فوراً عند تعديلها من المدير
    sock.on('permissions', () => api('/auth/me').then(setUser).catch(() => {}));
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

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => allowed(user, n)) })).filter((g) => g.items.length);
  const pref = ALL_NAV.find((n) => n.to === PREFERRED[user.role]);
  const home = pref && allowed(user, pref) ? pref.to : (groups[0]?.items[0]?.to || '/attendance');
  const current = ALL_NAV.find((n) => location.pathname.startsWith(n.to));

  return (
    <AppContext.Provider value={{ user, settings, setSettings, logout }}>
      <NotificationsProvider user={user}>
      <AttendanceGate>
      <div className={`shell ${menuOpen ? 'menu-open' : ''} ${location.pathname.startsWith('/kitchen') ? 'route-kitchen' : ''}`}>
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
              <span className="conn-label">{online ? 'متصل' : 'غير متصل'}</span>
            </span>
            <ApkDownload />
            <NotificationBell />
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
              <Route path="/employees" element={<Employees />} />
              <Route path="/employees/:id" element={<EmployeeProfile />} />
              <Route path="/attendance" element={<Attendance />} />
              <Route path="/leaves" element={<Leaves />} />
              <Route path="/payroll" element={<Payroll />} />
              <Route path="/cashier" element={<Cashier />} />
              <Route path="/activity" element={<Activity />} />
              <Route path="/permissions" element={<Permissions />} />
              <Route path="*" element={<Navigate to={home} replace />} />
            </Routes>
          </div>
        </main>
      </div>
      </AttendanceGate>
      </NotificationsProvider>
    </AppContext.Provider>
  );
}
