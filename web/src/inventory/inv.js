// أدوات مشتركة لشاشات المخازن
export const KIND = {
  in: { label: 'وارد', tone: 'in' },
  out: { label: 'صادر', tone: 'out' },
  waste: { label: 'تالف', tone: 'waste' },
};
export const MOVE_LABEL = { purchase: 'وارد', sale: 'بيع', waste: 'تالف', adjust: 'جرد / تسوية', issue: 'صرف', return: 'مرتجع للمورد' };
export const MOVE_TONE = { purchase: 'in', sale: 'out', issue: 'out', return: 'out', waste: 'waste', adjust: 'adj' };
export const WASTE_REASONS = ['انتهاء الصلاحية', 'تلف / فساد', 'سوء تخزين', 'خطأ في التحضير', 'سقوط / انسكاب', 'عينة / تجربة', 'أخرى'];
export const ISSUE_REASONS = ['تحضير داخلي', 'ضيافة', 'عينات وتجارب', 'استخدام تشغيلي', 'تحويل لفرع آخر', 'أخرى'];
export const STORAGE = { 'مبرد': '❄️', 'مجمد': '🧊', 'جاف': '📦' };

export const fmtQty = (n) => (Math.round(Number(n || 0) * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
/** عدد الأيام المتبقية على تاريخ (بالتوقيت المحلي) */
export function daysLeft(date) {
  if (!date) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${String(date).slice(0, 10)}T00:00`).getTime() - t.getTime()) / 864e5);
}
export const expiryTone = (d) => (d == null ? 'none' : d < 0 ? 'expired' : d <= 2 ? 'critical' : d <= 7 ? 'soon' : 'ok');
export const expiryText = (d) => (d == null ? 'بلا صلاحية' : d < 0 ? `منتهية منذ ${-d} ${-d === 1 ? 'يوم' : 'أيام'}` : d === 0 ? 'تنتهي اليوم' : d === 1 ? 'تنتهي غداً' : `بعد ${d} يوماً`);
export const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dstr(d); };
export const addDaysStr = (date, n) => { const d = new Date(`${date}T00:00`); d.setDate(d.getDate() + n); return dstr(d); };
