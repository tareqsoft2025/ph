import { io } from 'socket.io-client';
import { Capacitor } from '@capacitor/core';

// في تطبيق الأندرويد يجب تحديد عنوان الخادم، وفي المتصفح نستخدم نفس العنوان
export const isNative = Capacitor.isNativePlatform();
// النسخة التجريبية: الخادم كاملاً يعمل داخل المتصفح (vite build --mode demo)
export const isDemo = import.meta.env.MODE === 'demo';
const demo = isDemo ? import('./demo/server.js') : null;

const safe = (fn, fallback = null) => {
  try { return fn(); } catch { return fallback; }
};

export function getServerUrl() {
  const saved = safe(() => localStorage.getItem('serverUrl'));
  if (saved) return saved.replace(/\/+$/, '');
  return '';
}
export function setServerUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//.test(u)) u = 'http://' + u;
  safe(() => (u ? localStorage.setItem('serverUrl', u) : localStorage.removeItem('serverUrl')));
  return u;
}
export const needsServerUrl = () => !isDemo && isNative && !getServerUrl();

// في النسخة التجريبية تُحفظ الجلسة لكل تبويب على حدة، ليعمل الكاشير والمطبخ في تبويبين معاً
const tokenStore = () => (isDemo ? sessionStorage : localStorage);
export const getToken = () => safe(() => tokenStore().getItem('token'));
export const setToken = (t) => safe(() => (t ? tokenStore().setItem('token', t) : tokenStore().removeItem('token')));

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, timeout = 15000 } = {}) {
  if (isDemo) {
    const { handle } = await demo;
    const { status, data } = await handle(method, path, body, getToken());
    if (status === 401 && path !== '/auth/login') onUnauthorized();
    if (status >= 400) throw Object.assign(new Error(data?.error || `خطأ ${status}`), { data, status });
    return data;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(getServerUrl() + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new Error('تعذّر الاتصال بالخادم، تحقق من الشبكة وعنوان الخادم');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/auth/login') onUnauthorized();
  if (!res.ok) throw Object.assign(new Error(data?.error || `خطأ ${res.status}`), { data, status: res.status });
  return data;
}

/** اختبار الاتصال بخادم معيّن */
export async function testServer(url) {
  const res = await fetch(url.replace(/\/+$/, '') + '/api/health');
  if (!res.ok) throw new Error('الخادم لا يستجيب');
  return res.json();
}

let socket = null;

// غلاف متزامن لناقل الأحداث التجريبي (يُحمَّل بشكل غير متزامن)
const pending = [];
let demoBus = null;
const demoSocket = {
  on(e, fn) { demoBus ? demoBus.on(e, fn) : pending.push(['on', e, fn]); return demoSocket; },
  off(e, fn) { demoBus ? demoBus.off(e, fn) : pending.push(['off', e, fn]); return demoSocket; },
  disconnect() {},
};
demo?.then(({ bus }) => {
  demoBus = bus;
  for (const [m, e, fn] of pending.splice(0)) bus[m](e, fn);
});

export async function resetDemoData() {
  const { resetDemo } = await demo;
  resetDemo();
}
export function connectSocket() {
  if (isDemo) {
    // يُستبدل لاحقاً بناقل الأحداث المحلي بعد تحميل الخادم التجريبي
    socket = demoSocket;
    return socket;
  }
  if (socket) socket.disconnect();
  socket = io(getServerUrl() || undefined, { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
  return socket;
}
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
export const getSocket = () => socket;
