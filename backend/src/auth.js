import jwt from 'jsonwebtoken';
import { get } from './db.js';
import { rolePerms } from './perms.js';

const SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

export const ROLES = ['admin', 'manager', 'cashier', 'waiter', 'kitchen', 'staff'];

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

/** يتحقق من التوكن ويضع المستخدم في req.user */
export function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'انتهت الجلسة، سجّل الدخول مجدداً' });
  }
  const user = get('SELECT id, name, username, role, active FROM users WHERE id = ?', payload.id);
  if (!user || !user.active) return res.status(401).json({ error: 'الحساب غير مفعّل' });
  user.perms = rolePerms(user.role);
  req.user = user;
  // خارج try: أخطاء المسارات لا تتحول إلى "انتهت الجلسة"
  next();
}

/** يسمح فقط للأدوار المحددة (المدير العام مسموح دائماً) */
export function allow(...roles) {
  return (req, res, next) => {
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    res.status(403).json({ error: 'ليس لديك صلاحية لهذا الإجراء' });
  };
}
