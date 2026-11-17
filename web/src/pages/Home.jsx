import { useNavigate } from 'react-router-dom';
import { Building2, Armchair, Banknote, ChefHat, ClipboardList, Radio, LayoutDashboard, Fingerprint, CalendarOff, IdCard, HandCoins, UtensilsCrossed, Package, Users as UsersIcon, ChartColumn, History, ShieldCheck, KeyRound, Settings as SettingsIcon, CalendarDays, Wallet, ArrowLeft, Bell, Sparkles } from 'lucide-react';
import { useApp, useData, useMoney, has, ROLE_LABELS } from '../lib.jsx';
import { useNotifications } from '../notifications.jsx';
import { AnimatedMoney } from '../components/TableHero.jsx';

// لون وتدرج لكل وحدة
const TILE = {
  '/live': ['#ef4444', '#f97316'], '/events': ['#0369a1', '#38bdf8'], '/dashboard': ['#0b6b3a', '#34c27a'], '/cashier': ['#b87333', '#e0a46a'], '/tables': ['#0b6b3a', '#2fa36a'],
  '/orders': ['#2563eb', '#60a5fa'], '/kitchen': ['#ea580c', '#fbbf24'], '/reservations': ['#7c3aed', '#a78bfa'], '/shifts': ['#0f766e', '#2dd4bf'],
  '/attendance': ['#7c3aed', '#c084fc'], '/leaves': ['#db2777', '#f472b6'], '/employees': ['#0369a1', '#38bdf8'], '/payroll': ['#a16207', '#facc15'],
  '/menu': ['#c2410c', '#fb923c'], '/inventory': ['#475569', '#94a3b8'], '/customers': ['#0e7490', '#22d3ee'], '/reports': ['#4338ca', '#818cf8'],
  '/activity': ['#334155', '#64748b'], '/users': ['#15803d', '#4ade80'], '/permissions': ['#9d174d', '#f472b6'], '/settings': ['#374151', '#9ca3af'],
};
export const NAV_ICON = {
  '/events': Building2, '/live': Radio, '/dashboard': LayoutDashboard, '/cashier': Banknote, '/tables': Armchair, '/orders': ClipboardList, '/kitchen': ChefHat, '/reservations': CalendarDays,
  '/shifts': Wallet, '/attendance': Fingerprint, '/leaves': CalendarOff, '/employees': IdCard, '/payroll': HandCoins, '/menu': UtensilsCrossed, '/inventory': Package,
  '/customers': UsersIcon, '/reports': ChartColumn, '/activity': History, '/users': ShieldCheck, '/permissions': KeyRound, '/settings': SettingsIcon,
};

/** الشاشة الرئيسية لتطبيق الجوال: ترحيب + مؤشرات حيّة + بلاط الوصول السريع */
export default function Home({ items, groups }) {
  const { user, settings } = useApp();
  const navigate = useNavigate();
  const money = useMoney();
  const notif = useNotifications();
  const live = useData(has(user, 'reports.view') ? '/live' : null, ['orders', 'kitchen', 'tables'], []);
  const tables = useData(!has(user, 'reports.view') && has(user, 'tables.view', 'pos.create') ? '/tables' : null, ['tables', 'orders'], []);
  const kitchen = useData(has(user, 'kitchen.view') ? '/kitchen' : null, ['kitchen'], []);
  const open = useData(has(user, 'payments.collect') ? '/orders?status=open' : null, ['orders'], []);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'مساء النور';
  const date = new Date().toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' });

  // شارات حيّة على البلاط
  const ready = (tables.data || []).reduce((a, t) => a + (t.ready_items || 0), 0);
  const bills = (open.data || []).filter((o) => o.bill_requested_at).length;
  const badge = {
    '/tables': ready || (live.data?.stages?.ready ?? 0),
    '/kitchen': (kitchen.data || []).length,
    '/cashier': bills || (live.data?.kpis.bills ?? 0),
    '/orders': (open.data || []).length,
    '/live': live.data ? live.data.kpis.late + live.data.kpis.confirms + live.data.kpis.bills : 0,
  };

  const chips = [];
  if (live.data) {
    const k = live.data.kpis;
    chips.push(['مبيعات اليوم', <AnimatedMoney key="s" value={k.sales_today} />], ['طلبات مفتوحة', k.open_orders], ['الإشغال', `${k.tables ? Math.round((k.occupied / k.tables) * 100) : 0}%`]);
  } else {
    if (tables.data) chips.push(['طاولات مشغولة', tables.data.filter((t) => t.status === 'occupied').length], ['جاهز للتقديم', ready]);
    if (open.data) chips.push(['بانتظار الدفع', open.data.length], ['طلبوا الحساب', bills]);
    if (kitchen.data) chips.push(['تذاكر المطبخ', kitchen.data.length]);
  }
  const unread = (notif.rows || []).filter((n) => !n.read_at).slice(0, 3);

  return (
    <div className="hm">
      <section className="hm-hero">
        <div className="hm-orn" aria-hidden />
        <div className="hm-hello">
          <small>{date}</small>
          <h1>{greet}، <b>{user.name.split(' ')[0]}</b> <span aria-hidden>👋</span></h1>
          <p><Sparkles size={13} aria-hidden /> {settings?.restaurant_name} · {ROLE_LABELS[user.role]}</p>
        </div>
        {chips.length > 0 && (
          <div className="hm-chips">
            {chips.slice(0, 3).map(([label, v]) => <div key={label} className="hm-chip"><strong>{v}</strong><span>{label}</span></div>)}
          </div>
        )}
      </section>

      {unread.length > 0 && (
        <section className="hm-notes" aria-label="إشعارات جديدة">
          {unread.map((n) => (
            <button key={n.id} className="hm-note" onClick={() => notif.open(n)}>
              <span className="hm-note-ico" aria-hidden><Bell size={16} /></span>
              <span className="hm-note-t"><strong>{n.title}</strong>{n.body && <small>{n.body}</small>}</span>
              <ArrowLeft size={16} aria-hidden />
            </button>
          ))}
        </section>
      )}

      {groups.map((g) => (
        <section key={g.group} className="hm-group">
          <h2>{g.group}</h2>
          <div className="hm-tiles">
            {g.items.map((n, i) => {
              const Icon = NAV_ICON[n.to] || n.icon;
              const [c1, c2] = TILE[n.to] || ['#0b6b3a', '#34c27a'];
              const b = badge[n.to];
              return (
                <button key={n.to} className="hm-tile" style={{ '--c1': c1, '--c2': c2, animationDelay: `${i * 40}ms` }} onClick={() => navigate(n.to)}>
                  <span className="hm-ico"><Icon size={24} strokeWidth={1.9} aria-hidden /></span>
                  <strong>{n.label}</strong>
                  {b > 0 && <span className="hm-badge">{b}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
