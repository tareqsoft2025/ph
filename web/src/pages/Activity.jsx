import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogIn, ReceiptText, Banknote, Ban, Percent, Send, ArrowRightLeft, BellRing, UtensilsCrossed, Package, Wallet,
  Settings, Building2, QrCode, ShieldCheck, KeyRound, IdCard, CalendarOff, Fingerprint, HandCoins, CalendarDays, ChefHat, History, Search, Activity as ActivityIcon,
} from 'lucide-react';
import { api } from '../api.js';
import { useData, useMoney, Loading, Empty, PageHead, ROLE_LABELS, PAY_METHODS, todayStr, timeOf } from '../lib.jsx';

const CATEGORIES = [
  ['', 'كل العمليات'], ['order', 'الطلبات'], ['kitchen', 'المطبخ'], ['shift', 'الورديات'], ['item', 'الأصناف'], ['menu', 'القائمة'],
  ['stock', 'المخزون'], ['employee', 'الموظفون'], ['attendance', 'الحضور'], ['leave', 'الإجازات'], ['payroll', 'الرواتب'],
  ['qr', 'طلبات QR'], ['event', 'فعاليات المؤسسات'], ['reservation', 'الحجوزات'], ['user', 'المستخدمون'], ['permissions', 'الصلاحيات'], ['settings', 'الإعدادات'], ['auth', 'الدخول'],
];


/** وصف عربي مقروء لكل عملية */
export function describe(a, money) {
  const d = a.details || {};
  const code = a.order_code ? ` ${a.order_code}` : '';
  const name = a.entity_name || d.name || d.title || '';
  const M = {
    'auth.login': [LogIn, 'تسجيل دخول'],
    'order.create': [ReceiptText, `إنشاء طلب${code}`],
    'order.add_items': [ReceiptText, `إضافة ${d.count || ''} صنف للطلب${code}`],
    'order.send': [Send, `إرسال الطلب${code} للمطبخ`],
    'order.cancel_item': [Ban, `إلغاء ${d.qty || ''}× ${d.name || 'صنف'} من الطلب${code}`],
    'order.discount': [Percent, `خصم ${d.type === 'percent' ? `${d.value}%` : money(d.value)} على الطلب${code}`],
    'order.pay': [Banknote, `تحصيل${code}: ${(d.payments || []).map((p) => `${PAY_METHODS[p.method]} ${money(p.amount)}`).join(' + ')}${d.change ? ` · باقي ${money(d.change)}` : ''}`],
    'order.cancel': [Ban, `إلغاء الطلب${code}${d.reason ? `: ${d.reason}` : ''}`],
    'order.move_table': [ArrowRightLeft, `نقل الطلب${code} لطاولة أخرى`],
    'order.request_bill': [BellRing, `طلب الحساب للطلب${code}`],
    'kitchen.ready': [ChefHat, `الطلب${code} جاهز`],
    'order.confirm': [QrCode, `تأكيد طلب QR${code}${d.table ? ` على ${d.table}` : ''} وإرساله للمطبخ${d.items ? ` (${d.items} صنف)` : ''}`],
    'order.reject': [Ban, `رفض طلب QR${code}${d.reason ? `: ${d.reason}` : ''}`],
    'qr.request_open': [BellRing, `${name || d.name || 'طاولة'}: الزبون يطلب فتح الطلب بالـ QR`],
    'qr.table_open': [QrCode, `فتح ${name || d.name || 'الطاولة'} لطلب QR${d.answered_request ? ' (استلام طلب الزبون)' : ''}${d.minutes ? ` · ${d.minutes >= 60 ? `${+(d.minutes / 60).toFixed(1)} ساعة` : `${d.minutes} د`}` : ''}`],
    'qr.request_bill': [ReceiptText, `الزبون طلب الحساب${code}${d.method ? ` · ${({ cash: 'نقداً', wallet: 'محفظة', bank: 'بنك', jawwalpay: 'جوال بي' })[d.method]}` : ''}${d.name ? ` · ${d.name}` : ''}${d.phone ? ` · ${d.phone}` : ''}${d.total ? ` · ${money(d.total)}` : ''}`],
    'qr.cancel_bill': [Ban, `الزبون ألغى طلب الحساب${code}`],
    'event.create': [Building2, `إنشاء فعالية مؤسسة «${d.name || ''}»${d.mode ? ` (${({ selected: 'قائمة محددة', full: 'قائمة كاملة', cap: 'سقف سعر' })[d.mode]})` : ''}`],
    'event.update': [Building2, `تعديل فعالية «${d.name || ''}»`],
    'event.pause': [Building2, `إيقاف الطلب لفعالية «${d.name || ''}»`],
    'event.resume': [Building2, `تفعيل الطلب لفعالية «${d.name || ''}»`],
    'event.delete': [Building2, 'حذف فعالية'],
    'event.rotate_token': [Building2, `تغيير رمز QR لفعالية «${d.name || ''}»`],
    'event.settle': [Banknote, `تحصيل من المؤسسة «${d.name || ''}»: ${d.settled} طلب · ${money(d.total)} (${PAY_METHODS[d.method]})`],
    'event.order': [Building2, `طلب موظف مؤسسة «${d.event || ''}»${code}${d.place ? ` · ${d.place}` : ''} · ${d.customer || ''} · ${d.items || ''} صنف · ${money(d.total)}${d.needs_confirm ? ' · بانتظار الاعتماد' : ''}`],
    'qr.table_close': [QrCode, `إغلاق ${name || d.name || 'الطاولة'} لطلب QR`],
    'qr.order': [QrCode, `${d.added ? 'إضافة' : 'طلب'} من الزبون عبر QR${code}${d.table ? ` · ${d.table}` : ''} · ${d.items || ''} صنف · ${money(d.total)}${d.customer ? ` · ${d.customer}` : ''}${d.needs_confirm ? ' · بانتظار التأكيد' : ''}${d.waiter ? ` · المسؤول: ${d.waiter}` : ''}`],
    'settings.table_qr_rotate': [QrCode, `تغيير رمز QR لـ ${d.name || ''}`],
    'shift.open': [Wallet, 'فتح وردية'],
    'shift.close': [Wallet, `إغلاق وردية · النقد ${money(d.closing)} (المتوقع ${money(d.expected)})`],
    'item.create': [UtensilsCrossed, `إضافة صنف ${name}`],
    'item.price_change': [UtensilsCrossed, `تغيير سعر ${name} من ${money(d.from)} إلى ${money(d.to)}`],
    'item.delete': [UtensilsCrossed, `حذف صنف ${name}`],
    'item.available': [UtensilsCrossed, `تفعيل ${name}`],
    'item.unavailable': [UtensilsCrossed, `إيقاف ${name} (نفد)`],
    'menu.category_create': [UtensilsCrossed, `إضافة فئة ${name}`],
    'menu.category_update': [UtensilsCrossed, `تعديل فئة ${name}`],
    'menu.category_delete': [UtensilsCrossed, 'حذف فئة'],
    'stock.purchase': [Package, `استلام ${d.qty} ${d.unit || ''} ${d.name || ''}`],
    'stock.waste': [Package, `تالف ${Math.abs(d.qty)} ${d.unit || ''} ${d.name || ''}`],
    'stock.adjust': [Package, `تسوية جرد ${d.name || ''} (${d.qty > 0 ? '+' : ''}${d.qty})`],
    'stock.ingredient_create': [Package, `إضافة مادة ${name}`],
    'settings.update': [Settings, 'تعديل الإعدادات'],
    'settings.table_create': [Settings, `إضافة ${name}`],
    'settings.table_delete': [Settings, 'حذف طاولة'],
    'user.create': [ShieldCheck, `إنشاء مستخدم ${name}`],
    'user.update': [ShieldCheck, `تعديل المستخدم ${name}${d.role ? ` (الدور: ${ROLE_LABELS[d.role]})` : ''}${d.password_changed ? ' · تغيير كلمة المرور' : ''}${d.active === 0 || d.active === false ? ' · تعطيل' : ''}`],
    'user.permissions': [KeyRound, `تخصيص صلاحيات ${d.name || name}${d.after?.grants?.length ? ` · +${d.after.grants.length}` : ''}${d.after?.denies?.length ? ` · −${d.after.denies.length}` : ''}`],
    'permissions.update': [KeyRound, d.reset ? `إعادة صلاحيات ${ROLE_LABELS[d.role]} للافتراضي` : `تعديل صلاحيات ${ROLE_LABELS[d.role]}${d.added?.length ? ` · +${d.added.length}` : ''}${d.removed?.length ? ` · −${d.removed.length}` : ''}`],
    'employee.create': [IdCard, `إضافة الموظف ${name}`],
    'employee.update': [IdCard, `تعديل ملف ${name}`],
    'employee.terminated': [IdCard, `إنهاء خدمة ${name}`],
    'employee.active': [IdCard, `إعادة ${name} للعمل`],
    'employee.document_add': [IdCard, `إضافة مستند "${d.title}" لـ ${a.entity_name || ''}`],
    'employee.document_delete': [IdCard, `حذف مستند "${d.title}" من ${a.entity_name || ''}`],
    'attendance.manual': [Fingerprint, `تسجيل حضور يدوي لـ ${name} (${d.date})`],
    'leave.request': [CalendarOff, `طلب إجازة ${d.days} يوم لـ ${name}`],
    'leave.approved': [CalendarOff, `اعتماد إجازة ${name}`],
    'leave.rejected': [CalendarOff, `رفض إجازة ${name}`],
    'payroll.bonus': [HandCoins, `مكافأة ${money(d.amount)} لـ ${name}`],
    'payroll.deduction': [HandCoins, `خصم ${money(d.amount)} من ${name}`],
    'payroll.advance': [HandCoins, `سلفة ${money(d.amount)} لـ ${name}`],
    'reservation.create': [CalendarDays, `حجز باسم ${d.name}`],
    'reservation.seated': [CalendarDays, 'حضور حجز'],
    'reservation.cancelled': [CalendarDays, 'إلغاء حجز'],
    'reservation.no_show': [CalendarDays, 'حجز لم يحضر'],
    'reservation.update': [CalendarDays, 'تعديل حجز'],
  };
  return M[a.action] || [History, a.action];
}

export const tone = (action) => (/cancel|delete|waste|terminated|rejected|unavailable/.test(action) ? 'err'
  : /pay|ready|approved|create|open|available/.test(action) ? 'ok'
    : /discount|price|permissions|role|adjust/.test(action) ? 'warn' : 'info');

function dayLabel(d) {
  const t = todayStr();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const ys = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  return d === t ? 'اليوم' : d === ys ? 'أمس' : d;
}

export default function Activity() {
  const money = useMoney();
  const navigate = useNavigate();
  const users = useData('/users');
  const [f, setF] = useState({ category: '', user_id: '', from: '', to: '', q: '' });
  const [rows, setRows] = useState([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const qs = (extra = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v !== '' && v != null)).toString();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      api(`/audit?${qs()}`).then((d) => { if (alive) { setRows(d.rows); setMore(d.more); } }).catch(() => {}).finally(() => alive && setLoading(false));
    }, f.q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [f.category, f.user_id, f.from, f.to, f.q]); // eslint-disable-line

  const loadMore = async () => {
    const d = await api(`/audit?${qs({ before: rows[rows.length - 1]?.id })}`);
    setRows((r) => [...r, ...d.rows]);
    setMore(d.more);
  };

  const groups = [];
  rows.forEach((r) => {
    const day = r.created_at.slice(0, 10);
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push(r);
  });

  return (
    <div>
      <PageHead title="سجل الحركات" sub="كل عملية في النظام: من نفّذها، ماذا فعل، ومتى" />
      <div className="filters">
        <label className="search-field">
          <Search size={17} aria-hidden />
          <input type="search" placeholder="بحث بكود الطلب أو الاسم" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="بحث" />
        </label>
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="نوع العملية">
          {CATEGORIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })} aria-label="المستخدم">
          <option value="">كل المستخدمين</option>
          {(users.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="من" />
        <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="إلى" />
      </div>

      {loading ? <Loading /> : !rows.length ? <Empty icon={ActivityIcon} text="لا توجد حركات مطابقة" /> : (
        <div className="activity">
          {groups.map((g) => (
            <section key={g.day} className="act-day">
              <h3 className="act-day-title">{dayLabel(g.day)}</h3>
              <ol className="act-list">
                {g.items.map((a) => {
                  const [Icon, text] = describe(a, money);
                  return (
                    <li key={a.id} className={`act act-${tone(a.action)}`}>
                      <span className="act-icon" aria-hidden><Icon size={16} /></span>
                      <div className="act-body">
                        <p>{text}</p>
                        <small className="muted">
                          {a.user_name || (/^qr\./.test(a.action) || a.action === 'event.order' || ['order.send', 'order.add_items', 'order.create'].includes(a.action) ? 'الزبون (QR)' : 'النظام')}{a.user_role ? ` · ${ROLE_LABELS[a.user_role]}` : ''}
                          {a.order_code && <> · <button className="link-btn small" onClick={() => navigate(`/pos/${a.entity_id}`)}>فتح الطلب</button></>}
                          {a.entity === 'table' && /^qr\./.test(a.action) && <> · <button className="link-btn small" onClick={() => navigate(`/tables?table=${a.entity_id}`)}>عرض الطاولة</button></>}
                        </small>
                      </div>
                      <time dir="ltr">{timeOf(a.created_at)}</time>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {more && <button className="btn btn-block" onClick={loadMore}>عرض المزيد</button>}
        </div>
      )}
    </div>
  );
}

