// بيانات أولية: المستخدمون، الفئات، الأصناف، الطاولات، المخزون
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { get, run, tx } from './db.js';

export function ensureSeed() {
  if (get('SELECT id FROM users LIMIT 1')) return false;
  tx(seed);
  console.log('🌱 تم إنشاء البيانات الأولية (admin / admin123)');
  return true;
}

function seed() {
  const users = [
    ['المدير العام', 'admin', 'admin123', 'admin'],
    ['مدير الفرع', 'manager', '1234', 'manager'],
    ['الكاشير', 'cashier', '1234', 'cashier'],
    ['النادل أحمد', 'waiter', '1234', 'waiter'],
    ['المطبخ', 'kitchen', '1234', 'kitchen'],
  ];
  for (const [name, username, pass, role] of users) {
    run('INSERT INTO users(name, username, password_hash, role) VALUES(?,?,?,?)', name, username, bcrypt.hashSync(pass, 10), role);
  }

  const ing = {};
  const ingredients = [
    ['دجاج', 'كغ', 20, 5, 18], ['لحم بقري', 'كغ', 15, 4, 40], ['خبز برجر', 'حبة', 100, 30, 1],
    ['خبز صاج', 'حبة', 150, 40, 0.5], ['جبن شيدر', 'كغ', 5, 1, 30], ['بطاطس', 'كغ', 25, 8, 5],
    ['أرز', 'كغ', 30, 10, 6], ['خس', 'كغ', 5, 2, 8], ['طماطم', 'كغ', 8, 3, 6],
    ['حليب', 'لتر', 20, 5, 5], ['قهوة', 'كغ', 3, 1, 80], ['ليمون', 'كغ', 6, 2, 7],
    ['سكر', 'كغ', 10, 3, 4], ['شوكولاتة', 'كغ', 3, 1, 45], ['دقيق', 'كغ', 20, 5, 3],
  ];
  for (const [name, unit, stock, min, cost] of ingredients) {
    ing[name] = Number(run('INSERT INTO ingredients(name, unit, stock, min_stock, cost_per_unit) VALUES(?,?,?,?,?)', name, unit, stock, min, cost).lastInsertRowid);
  }

  const cats = [
    ['المقبلات', '🥗'], ['الوجبات الرئيسية', '🍛'], ['البرجر والساندويتش', '🍔'],
    ['المشويات', '🍢'], ['المشروبات', '🥤'], ['الحلويات', '🍰'],
  ];
  const cat = {};
  cats.forEach(([name, icon], i) => {
    cat[name] = Number(run('INSERT INTO categories(name, icon, sort) VALUES(?,?,?)', name, icon, i).lastInsertRowid);
  });

  // [الفئة، الاسم، الوصف، السعر، القسم، الإضافات، الوصفة]
  const items = [
    ['المقبلات', 'حمص', 'حمص بالطحينة وزيت الزيتون', 14, 'kitchen', [], []],
    ['المقبلات', 'سلطة سيزر', 'خس، دجاج مشوي، صوص سيزر', 22, 'kitchen', [['دجاج إضافي', 6]], [['خس', 0.15], ['دجاج', 0.08]]],
    ['المقبلات', 'بطاطس مقلية', 'بطاطس مقرمشة', 10, 'kitchen', [['حجم كبير', 4], ['جبن', 3]], [['بطاطس', 0.25]]],
    ['الوجبات الرئيسية', 'كبسة دجاج', 'أرز بسمتي مع نصف دجاجة', 35, 'kitchen', [['دجاج كامل', 15]], [['دجاج', 0.5], ['أرز', 0.3]]],
    ['الوجبات الرئيسية', 'مندي لحم', 'لحم طري مع أرز المندي', 55, 'kitchen', [], [['لحم بقري', 0.35], ['أرز', 0.3]]],
    ['الوجبات الرئيسية', 'باستا ألفريدو', 'باستا بصوص الكريمة والدجاج', 32, 'kitchen', [], [['دجاج', 0.15], ['حليب', 0.1]]],
    ['البرجر والساندويتش', 'برجر لحم', 'لحم بقري 150غ مع الخضار', 28, 'grill', [['جبن إضافي', 3], ['لحم مضاعف', 12], ['بدون بصل', 0]], [['لحم بقري', 0.15], ['خبز برجر', 1], ['جبن شيدر', 0.02], ['خس', 0.02], ['طماطم', 0.03]]],
    ['البرجر والساندويتش', 'برجر دجاج', 'صدر دجاج مقرمش', 25, 'grill', [['جبن إضافي', 3], ['حار', 0]], [['دجاج', 0.15], ['خبز برجر', 1], ['خس', 0.02]]],
    ['البرجر والساندويتش', 'شاورما دجاج', 'ساندويتش شاورما بخبز الصاج', 12, 'grill', [['ثوم إضافي', 0], ['بطاطس داخل', 2]], [['دجاج', 0.1], ['خبز صاج', 1]]],
    ['المشويات', 'مشاوي مشكلة', 'كباب، شيش طاووق، أوصال', 65, 'grill', [], [['لحم بقري', 0.2], ['دجاج', 0.2]]],
    ['المشويات', 'شيش طاووق', 'دجاج متبل على الفحم', 38, 'grill', [], [['دجاج', 0.3]]],
    ['المشويات', 'كباب لحم', 'كباب لحم على الفحم', 42, 'grill', [], [['لحم بقري', 0.3]]],
    ['المشروبات', 'عصير ليمون بالنعناع', 'طازج', 12, 'drinks', [['بدون سكر', 0]], [['ليمون', 0.1], ['سكر', 0.03]]],
    ['المشروبات', 'كابتشينو', '', 14, 'drinks', [['حليب شوفان', 3], ['شوت إضافي', 4]], [['قهوة', 0.018], ['حليب', 0.15]]],
    ['المشروبات', 'مياه', '', 3, 'drinks', [], []],
    ['المشروبات', 'مشروب غازي', '', 5, 'drinks', [], []],
    ['الحلويات', 'كنافة', 'كنافة بالجبن', 22, 'dessert', [['آيس كريم', 5]], [['جبن شيدر', 0.05], ['سكر', 0.03]]],
    ['الحلويات', 'كيك الشوكولاتة', '', 18, 'dessert', [], [['شوكولاتة', 0.05], ['دقيق', 0.05], ['حليب', 0.05]]],
  ];
  items.forEach(([c, name, desc, price, station, mods, recipe], i) => {
    const id = Number(run('INSERT INTO menu_items(category_id, name, description, price, station, sort) VALUES(?,?,?,?,?,?)',
      cat[c], name, desc, price, station, i).lastInsertRowid);
    for (const [mn, mp] of mods) run('INSERT INTO modifiers(item_id, name, price) VALUES(?,?,?)', id, mn, mp);
    for (const [ingName, qty] of recipe) run('INSERT INTO recipes(item_id, ingredient_id, qty) VALUES(?,?,?)', id, ing[ingName], qty);
  });

  for (let i = 1; i <= 10; i++) run('INSERT INTO dining_tables(name, seats, area) VALUES(?,?,?)', `طاولة ${i}`, i % 3 === 0 ? 6 : 4, 'الصالة');
  for (let i = 1; i <= 4; i++) run('INSERT INTO dining_tables(name, seats, area) VALUES(?,?,?)', `ت ${i}`, 4, 'الجلسات الخارجية');
  for (let i = 1; i <= 3; i++) run('INSERT INTO dining_tables(name, seats, area) VALUES(?,?,?)', `VIP ${i}`, 8, 'العائلات');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!ensureSeed()) console.log('البيانات موجودة مسبقاً');
}
