import { io } from 'socket.io-client';
import { Capacitor } from '@capacitor/core';

// في تطبيق الأندرويد يجب تحديد عنوان الخادم، وفي المتصفح نستخدم نفس العنوان
export const isNative = Capacitor.isNativePlatform();

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
export const needsServerUrl = () => isNative && !getServerUrl();

export const getToken = () => safe(() => localStorage.getItem('token'));
export const setToken = (t) => safe(() => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token')));

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, timeout = 15000 } = {}) {
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
  if (!res.ok) throw new Error(data?.error || `خطأ ${res.status}`);
  return data;
}

/** اختبار الاتصال بخادم معيّن */
export async function testServer(url) {
  const res = await fetch(url.replace(/\/+$/, '') + '/api/health');
  if (!res.ok) throw new Error('الخادم لا يستجيب');
  return res.json();
}

let socket = null;
export function connectSocket() {
  if (socket) socket.disconnect();
  socket = io(getServerUrl() || undefined, { auth: { token: getToken() }, transports: ['websocket', 'polling'] });
  return socket;
}
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
export const getSocket = () => socket;
