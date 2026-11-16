import { ensureSeed } from './seed.js';

if (!ensureSeed()) console.log('البيانات موجودة مسبقاً');
