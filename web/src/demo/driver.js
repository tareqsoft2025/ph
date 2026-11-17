// قاعدة بيانات SQLite داخل المتصفح (sql.js / WebAssembly) — تُحفظ في localStorage على هذا الجهاز
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import schema from '../../../backend/src/schema.sql?raw';

export const STORAGE_KEY = 'ph-demo-db-v5';
const SQL = await initSqlJs({ locateFile: () => wasmUrl });

function load() {
  try {
    const b64 = localStorage.getItem(STORAGE_KEY);
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function open() {
  const d = new SQL.Database(load() || undefined);
  d.exec(schema);
  return d;
}

const VER_KEY = `${STORAGE_KEY}:ver`;
const readVer = () => { try { return localStorage.getItem(VER_KEY) || ''; } catch { return ''; } };
let loadedVer = readVer();   // إصدار البيانات التي في ذاكرة هذا التبويب
let raw = open();
let dirty = false;
let frozen = false;

/** حفظ فوري بعد كل عملية كتابة (يُستدعى بعد اكتمال الطلب) */
export function saveIfDirty() {
  if (!dirty || frozen) return;
  dirty = false;
  try {
    const bytes = raw.export();
    raw.exec('PRAGMA foreign_keys = ON;');
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    localStorage.setItem(STORAGE_KEY, btoa(bin));
    loadedVer = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    localStorage.setItem(VER_KEY, loadedVer);
  } catch (e) {
    console.warn('تعذّر حفظ البيانات التجريبية', e);
  }
}

/** إعادة التحميل عندما يغيّر تبويب آخر البيانات */
export function reloadFromStorage() {
  try { raw.close(); } catch { /* ignore */ }
  raw = open();
  dirty = false;
  loadedVer = readVer();
}

/** قبل كل طلب: إن كان تبويب آخر قد حفظ بيانات أحدث نسحبها أولاً حتى لا نكتب فوقها بنسخة قديمة */
export function syncFromStorage() {
  const v = readVer();
  if (v && v !== loadedVer && !dirty) reloadFromStorage();
}

const norm = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

/** واجهة مطابقة لـ node:sqlite DatabaseSync بالقدر الذي يستخدمه الخادم */
export const db = {
  exec(sql) {
    raw.exec(sql);
    if (!/^\s*(BEGIN|SELECT|PRAGMA)/i.test(sql)) dirty = true;
  },
  prepare(sql) {
    return {
      get(...params) {
        const st = raw.prepare(sql);
        try {
          st.bind(norm(params));
          return st.step() ? st.getAsObject() : undefined;
        } finally {
          st.free();
        }
      },
      all(...params) {
        const st = raw.prepare(sql);
        const rows = [];
        try {
          st.bind(norm(params));
          while (st.step()) rows.push(st.getAsObject());
          return rows;
        } finally {
          st.free();
        }
      },
      run(...params) {
        raw.run(sql, norm(params));
        const changes = raw.getRowsModified();
        const lastInsertRowid = raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
        dirty = true;
        return { changes, lastInsertRowid };
      },
    };
  },
};

/** مسح كل البيانات التجريبية والبدء من جديد */
export function resetDemo() {
  frozen = true;
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(VER_KEY); } catch { /* ignore */ }
}
