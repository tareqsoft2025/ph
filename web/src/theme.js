// وضع المظهر: تلقائي / فاتح / داكن (يُحفظ على الجهاز)
const KEY = 'ph-theme';
const safe = (f, d = null) => { try { return f(); } catch { return d; } };
export const getTheme = () => safe(() => localStorage.getItem(KEY), null) || 'auto';
export function applyTheme(t = getTheme()) {
  const el = document.documentElement;
  if (t === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', t);
}
export function setTheme(t) { safe(() => localStorage.setItem(KEY, t)); applyTheme(t); }
export const nextTheme = (t) => ({ auto: 'light', light: 'dark', dark: 'auto' }[t] || 'auto');
