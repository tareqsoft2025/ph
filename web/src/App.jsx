import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Radio, Building2, MessageCircle, ArrowLeftRight, Calculator, ReceiptText, Armchair, ClipboardList, ChefHat, CalendarDays, Wallet,
  UtensilsCrossed, Package, Users as UsersIcon, ChartColumn, IdCard, Fingerprint, CalendarOff, Banknote, HandCoins, History, KeyRound, ShieldCheck, Settings as SettingsIcon, LogOut, Menu as MenuIcon, Wifi, WifiOff, Smartphone, Sun, Moon, SunMoon, Ellipsis, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import {
  api, connectSocket, disconnectSocket, getToken, setToken, needsServerUrl, setUnauthorizedHandler, getServerUrl,
} from './api.js';
import { AppContext, ROLE_LABELS, has, Loading } from './lib.jsx';
import { NotificationsProvider, NotificationBell } from './notifications.jsx';
import ApkDownload from './components/ApkDownload.jsx';
import AttendanceGate from './components/AttendanceGate.jsx';
import { teardownPush } from './push.js';
import { getTheme, setTheme, nextTheme } from './theme.js';
import Login from './pages/Login.jsx';
import CustomerOrder, { NoQr } from './pages/CustomerOrder.jsx';
import ServerSetup from './pages/ServerSetup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Live from './pages/Live.jsx';
import Home from './pages/Home.jsx';
import Events from './pages/Events.jsx';
import Chat from './pages/Chat.jsx';
import Transfers from './pages/Transfers.jsx';
import Expenses from './pages/Expenses.jsx';
import AppShell from './components/AppShell.jsx';
import { isAppUi, setAppUi } from './appui.js';
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
    { to: '/live', label: 'المتابعة المباشرة', icon: Radio, perms: ['reports.view'] },
    { to: '/cashier', label: 'الكاشير', icon: Banknote, perms: ['payments.collect'] },
    { to: '/transfers', label: 'تدقيق التحويلات', icon: ArrowLeftRight, perms: ['transfers.audit'] },
    { to: '/tables', label: 'الطاولات', icon: Armchair, perms: ['tables.view', 'pos.create'] },
    { to: '/orders', label: 'الطلبات', icon: ClipboardList, perms: ['orders.view', 'pos.create', 'payments.collect'] },
    { to: '/kitchen', label: 'شاشة المطبخ', icon: ChefHat, perms: ['kitchen.view', 'kitchen.update'] },
    { to: '/events', label: 'فعاليات المؤسسات', icon: Building2, perms: ['events.manage'] },
    { to: '/chat', label: 'محادثات الزبائن', icon: MessageCircle, perms: ['chat.reply'] },
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
    { to: '/expenses', label: 'المصاريف', icon: Calculator, perms: ['expenses.record', 'expenses.manage'] },
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
  const [theme, setThemeState] = useState(getTheme());
  const [rail, setRail] = useState(() => { try { return localStorage.getItem('ph-rail') === '1'; } catch { return false; } });
  const toggleRail = () => setRail((r) => { try { localStorage.setItem('ph-rail', r ? '0' : '1'); } catch { /* */ } return !r; });
  const cycleTheme = () => { const t = nextTheme(theme); setTheme(t); setThemeState(t); };

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

  // صفحة الطلب العامة للزبائن: بلا تسجيل دخول
  if ((location.pathname.startsWith('/t/') || location.pathname.startsWith('/e/') || location.pathname === '/order')) return <Routes><Route path="/t/:token" element={<CustomerOrder />} /><Route path="/e/:token" element={<CustomerOrder kind="event" />} /><Route path="*" element={<NoQr />} /></Routes>;
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
  // شريط التنقل السفلي للجوال: أهم 4 صفحات مسموحة للمستخدم + «المزيد»
  const QUICK = ['/tables', '/orders', '/kitchen', '/cashier', '/dashboard', '/attendance'];
  const quick = QUICK.map((to) => ALL_NAV.find((n) => n.to === to)).filter((n) => n && allowed(user, n)).slice(0, 4);
  const focusMode = location.pathname.startsWith('/pos');
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : SunMoon;
  const themeLabel = { auto: 'المظهر: تلقائي', light: 'المظهر: فاتح', dark: 'المظهر: داكن' }[theme];
  const appUi = isAppUi();
  const homeTo = appUi ? '/home' : home;
  const allowedItems = ALL_NAV.filter((n) => allowed(user, n));
  const routes = (
    <Routes>
      <Route path="/" element={<Navigate to={homeTo} replace />} />
      <Route path="/home" element={<Home items={allowedItems} groups={groups} />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/live" element={<Live />} />
      <Route path="/events" element={<Events />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/transfers" element={<Transfers />} />
      <Route path="/expenses" element={<Expenses />} />
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
      <Route path="*" element={<Navigate to={homeTo} replace />} />
    </Routes>
  );
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'مساء النور';

  return (
    <AppContext.Provider value={{ user, settings, setSettings, logout }}>
      <NotificationsProvider user={user}>
      <AttendanceGate>
      {appUi ? (
        <AppShell user={user} settings={settings} groups={groups} allowed={allowedItems} current={current} online={online} themeIcon={ThemeIcon} themeLabel={themeLabel} cycleTheme={cycleTheme} logout={logout} focusMode={focusMode}>
          {routes}
        </AppShell>
      ) : (
      <div className={`shell ${menuOpen ? 'menu-open' : ''} ${rail ? 'rail' : ''} ${focusMode ? 'focus' : ''} ${location.pathname.startsWith('/kitchen') ? 'route-kitchen' : ''}`}>
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
                  <NavLink key={n.to} to={n.to} className="nav-link" title={n.label}>
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
              <button className="icon-btn rail-toggle" onClick={() => { setAppUi(true); window.location.hash = '#/home'; window.location.reload(); }} aria-label="عرض بشكل التطبيق" title="عرض بشكل التطبيق (للجوال)"><Smartphone size={18} /></button>
              <button className="icon-btn rail-toggle" onClick={toggleRail} aria-label={rail ? 'توسيع القائمة' : 'تصغير القائمة'} title={rail ? 'توسيع القائمة' : 'تصغير القائمة'}>{rail ? <PanelRightOpen size={18} /> : <PanelRightClose size={18} />}</button>
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
              <small className="topbar-greet">{greet}، {user.name.split(' ')[0]}</small>
            </div>
            <button className="icon-btn" onClick={cycleTheme} aria-label={themeLabel} title={themeLabel}><ThemeIcon size={19} /></button>
            <span className={`conn ${online ? 'on' : 'off'}`} title={getServerUrl() || 'الخادم'}>
              {online ? <Wifi size={14} /> : <WifiOff size={14} />}
              <span className="conn-label">{online ? 'متصل' : 'غير متصل'}</span>
            </span>
            <ApkDownload />
            <NotificationBell />
            <button className="icon-btn logout-btn" onClick={() => { if (window.confirm('تسجيل الخروج؟')) logout(); }} aria-label="تسجيل الخروج" title="تسجيل الخروج"><LogOut size={19} /></button>
          </header>
          <div className="content">{routes}</div>
        </main>
        {!focusMode && (
          <nav className="bottom-nav" aria-label="التنقل السريع">
            {quick.map((n) => (
              <NavLink key={n.to} to={n.to} className="bn-item"><n.icon size={22} strokeWidth={1.8} aria-hidden /><span>{n.label}</span></NavLink>
            ))}
            <button className="bn-item" onClick={() => setMenuOpen(true)}><Ellipsis size={22} aria-hidden /><span>المزيد</span></button>
          </nav>
        )}
      </div>
      )}
      </AttendanceGate>
      </NotificationsProvider>
    </AppContext.Provider>
  );
}
