// بديل مبسّط لـ jsonwebtoken في النسخة التجريبية (البيانات محلية على الجهاز فقط)
const enc = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const dec = (s) => JSON.parse(decodeURIComponent(escape(atob(s))));

export function sign(payload) {
  return 'demo.' + enc({ ...payload, iat: Date.now() });
}
export function verify(token) {
  if (typeof token !== 'string' || !token.startsWith('demo.')) throw new Error('invalid token');
  return dec(token.slice(5));
}
export default { sign, verify };
