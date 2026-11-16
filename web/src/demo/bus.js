// بديل لـ Socket.io: ناقل أحداث داخل الصفحة
const listeners = new Map();

export const ALL_EVENTS = ['orders', 'kitchen', 'tables', 'menu', 'inventory', 'shift', 'reservations', 'settings'];

function fire(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { fn(payload); } catch (e) { console.error(e); }
  }
}

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return bus;
  },
  off(event, fn) {
    listeners.get(event)?.delete(fn);
    return bus;
  },
  // تأجيل بسيط حتى يكتمل الطلب الحالي قبل إعادة الجلب
  emit(event, payload) {
    setTimeout(() => fire(event, payload), 0);
  },
  disconnect() {},
};
