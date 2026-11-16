export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'العنصر غير موجود') => new HttpError(404, msg);

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** يلتقط الحقول المسموحة فقط من جسم الطلب */
export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** يبني جملة UPDATE من كائن */
export function updateSql(table, fields, id) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  return {
    sql: `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    params: [...keys.map((k) => normalize(fields[k])), id],
  };
}

export function normalize(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
