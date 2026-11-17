// الصلاحيات القابلة للتخصيص لكل دور
import { get, all, run } from './db.js';

/** كل الصلاحيات مع وصفها وتجميعها */
export const PERMISSIONS = [
  { key: 'pos.create', group: 'الطلبات', label: 'إنشاء الطلبات وإضافة الأصناف وإرسالها للمطبخ' },
  { key: 'orders.view', group: 'الطلبات', label: 'عرض كل الطلبات' },
  { key: 'orders.cancel_item', group: 'الطلبات', label: 'إلغاء صنف بعد إرساله للمطبخ' },
  { key: 'orders.cancel', group: 'الطلبات', label: 'إلغاء طلب كامل' },
  { key: 'orders.discount', group: 'الطلبات', label: 'تطبيق الخصومات' },
  { key: 'orders.move', group: 'الطلبات', label: 'نقل الطلب لطاولة أخرى' },
  { key: 'tables.view', group: 'الطلبات', label: 'عرض الطاولات' },
  { key: 'reservations.manage', group: 'الطلبات', label: 'إدارة الحجوزات' },

  { key: 'payments.collect', group: 'الكاشير', label: 'تحصيل الدفعات وإغلاق الطلبات' },
  { key: 'payments.view_all', group: 'الكاشير', label: 'عرض تحصيلات كل الكاشير (بدونها يرى الكاشير تحصيلاته فقط)' },
  { key: 'shifts.manage', group: 'الكاشير', label: 'فتح وإغلاق الورديات' },
  { key: 'customers.view', group: 'الكاشير', label: 'عرض العملاء' },

  { key: 'kitchen.view', group: 'المطبخ', label: 'عرض شاشة المطبخ' },
  { key: 'kitchen.update', group: 'المطبخ', label: 'تحديث حالة التحضير (ويستقبل إشعار الطلبات الجديدة)' },
  { key: 'menu.availability', group: 'المطبخ', label: 'إيقاف / تفعيل صنف نفد' },

  { key: 'menu.manage', group: 'الإدارة', label: 'إدارة قائمة الطعام والأسعار' },
  { key: 'inventory.view', group: 'الإدارة', label: 'عرض المخزون' },
  { key: 'inventory.receive', group: 'الإدارة', label: 'تسجيل استلام بضاعة وتالف' },
  { key: 'inventory.manage', group: 'الإدارة', label: 'إدارة المخزون والجرد' },
  { key: 'reports.view', group: 'الإدارة', label: 'عرض التقارير ولوحة التحكم' },
  { key: 'settings.manage', group: 'الإدارة', label: 'تعديل الإعدادات والطاولات' },
  { key: 'activity.view', group: 'الإدارة', label: 'عرض سجل الحركات' },
  { key: 'users.manage', group: 'الإدارة', label: 'إدارة المستخدمين' },
  { key: 'events.manage', group: 'الإدارة', label: 'فعاليات المؤسسات: إنشاء QR للمؤسسة وتحديد قائمتها وكشف حسابها' },

  { key: 'hr.employees', group: 'الموارد البشرية', label: 'ملفات الموظفين ومستنداتهم' },
  { key: 'hr.attendance', group: 'الموارد البشرية', label: 'إدارة حضور الفريق' },
  { key: 'hr.leaves', group: 'الموارد البشرية', label: 'اعتماد الإجازات' },
  { key: 'hr.payroll', group: 'الموارد البشرية', label: 'الرواتب' },
];
export const ALL_KEYS = PERMISSIONS.map((p) => p.key);
export const ROLES_EDITABLE = ['manager', 'cashier', 'waiter', 'kitchen', 'staff'];

/** الصلاحيات الافتراضية لكل دور */
export const DEFAULTS = {
  manager: ALL_KEYS.filter((k) => !['users.manage', 'kitchen.update'].includes(k)),
  cashier: ['orders.view', 'tables.view', 'payments.collect', 'shifts.manage', 'customers.view', 'orders.discount', 'orders.cancel', 'orders.cancel_item', 'reservations.manage', 'kitchen.view'],
  waiter: ['pos.create', 'tables.view', 'orders.move', 'reservations.manage', 'kitchen.view'],
  kitchen: ['kitchen.view', 'kitchen.update', 'menu.availability', 'inventory.view', 'inventory.receive'],
  staff: [], // الحضور والإجازات متاحة للجميع
};

/** صلاحيات الدور (المخصّصة أو الافتراضية) */
export function rolePerms(role) {
  if (role === 'admin') return ALL_KEYS;
  const row = get('SELECT perms FROM role_permissions WHERE role = ?', role);
  if (row) {
    try { return JSON.parse(row.perms).filter((k) => ALL_KEYS.includes(k)); } catch { /* fallthrough */ }
  }
  return DEFAULTS[role] || [];
}

export function setRolePerms(role, perms) {
  const clean = [...new Set(perms)].filter((k) => ALL_KEYS.includes(k));
  run('INSERT INTO role_permissions(role, perms) VALUES(?, ?) ON CONFLICT(role) DO UPDATE SET perms = excluded.perms', role, JSON.stringify(clean));
  return clean;
}

export function resetRolePerms(role) {
  run('DELETE FROM role_permissions WHERE role = ?', role);
}

export const hasPerm = (user, key) => !!user && (user.role === 'admin' || (user.perms || rolePerms(user.role)).includes(key));

/** يسمح بالمرور إذا امتلك المستخدم أياً من الصلاحيات */
export function need(...keys) {
  return (req, res, next) => {
    if (req.user.role === 'admin' || keys.some((k) => req.user.perms.includes(k))) return next();
    res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' });
  };
}

/** المستخدمون الذين يملكون صلاحية (لاستهداف الإشعارات) */
export function usersWithPerm(key, { includeAdmin = false } = {}) {
  return all('SELECT id, role FROM users WHERE active = 1')
    .filter((u) => (u.role === 'admin' ? includeAdmin : rolePerms(u.role).includes(key)))
    .map((u) => u.id);
}
