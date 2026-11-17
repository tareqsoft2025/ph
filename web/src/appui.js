// واجهة التطبيق (APK): شكل مختلف تماماً للجوال — تلقائي داخل التطبيق، وقابل للتجربة من المتصفح
import { isNative } from './api.js';

const KEY = 'ph-appui';
const safe = (f, d = null) => { try { return f(); } catch { return d; } };
export const isAppUi = () => isNative || safe(() => localStorage.getItem(KEY)) === '1';
export function applyAppUi() { document.documentElement.dataset.ui = isAppUi() ? 'app' : 'web'; }
export function setAppUi(on) { safe(() => (on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY))); applyAppUi(); }
/** نبضة اهتزاز خفيفة عند اللمس (إن كانت مدعومة) */
export const tick = (ms = 8) => safe(() => navigator.vibrate?.(ms));
