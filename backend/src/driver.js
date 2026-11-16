// مشغّل قاعدة البيانات (Node). في النسخة التجريبية على المتصفح يُستبدل هذا الملف بـ web/src/demo/driver.js
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'restaurant.db');

if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
