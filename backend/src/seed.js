// بيانات أولية: المستخدمون، الفئات، الأصناف، الطاولات، المخزون
import bcrypt from 'bcryptjs';
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
    ['الموظف أحمد', 'waiter', '1234', 'waiter'],
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
    ['المشروبات', 'عصير ليمون بالنعناع', 'ليمون طازج مع أوراق النعناع والثلج', 12, 'drinks', [['بدون سكر', 0]], [['ليمون', 0.1], ['سكر', 0.03]]],
    ['المشروبات', 'كابتشينو', 'إسبريسو مع حليب مبخّر ورغوة كثيفة', 14, 'drinks', [['حليب شوفان', 3], ['شوت إضافي', 4]], [['قهوة', 0.018], ['حليب', 0.15]]],
    ['المشروبات', 'مياه', 'مياه معدنية باردة', 3, 'drinks', [], []],
    ['المشروبات', 'مشروب غازي', 'علبة باردة بنكهات متعددة', 5, 'drinks', [], []],
    ['الحلويات', 'كنافة', 'كنافة بالجبن', 22, 'dessert', [['آيس كريم', 5]], [['جبن شيدر', 0.05], ['سكر', 0.03]]],
    ['الحلويات', 'كيك الشوكولاتة', 'طبقات غنية من الشوكولاتة البلجيكية', 18, 'dessert', [], [['شوكولاتة', 0.05], ['دقيق', 0.05], ['حليب', 0.05]]],
  ];
  const images = { 'حمص': '🥣', 'سلطة سيزر': '🥗', 'بطاطس مقلية': '🍟', 'كبسة دجاج': '🍗', 'مندي لحم': '🍖', 'باستا ألفريدو': '🍝', 'برجر لحم': '🍔', 'برجر دجاج': '🍔', 'شاورما دجاج': '🌯', 'مشاوي مشكلة': '🍢', 'شيش طاووق': '🍢', 'كباب لحم': '🥙', 'عصير ليمون بالنعناع': '🍋', 'كابتشينو': '☕', 'مياه': '💧', 'مشروب غازي': '🥤', 'كنافة': '🍮', 'كيك الشوكولاتة': '🍰' };
  items.forEach(([c, name, desc, price, station, mods, recipe], i) => {
    const id = Number(run('INSERT INTO menu_items(category_id, name, description, price, image, station, sort) VALUES(?,?,?,?,?,?,?)',
      cat[c], name, desc, price, images[name] || null, station, i).lastInsertRowid);
    for (const [mn, mp] of mods) run('INSERT INTO modifiers(item_id, name, price) VALUES(?,?,?)', id, mn, mp);
    for (const [ingName, qty] of recipe) run('INSERT INTO recipes(item_id, ingredient_id, qty) VALUES(?,?,?)', id, ing[ingName], qty);
  });

  // تفصيل الوجبات ومكوناتها كما تظهر للزبون
  const info = {
    'حمص': ['حمص مهروس ناعم بالطحينة وعصير الليمون، يُقدَّم مع زيت زيتون بكر وبقدونس وحبات حمص كاملة وخبز ساخن.', ['حمص', 'طحينة', 'ليمون', 'ثوم', 'زيت زيتون', 'بقدونس']],
    'سلطة سيزر': ['خس روماني مقرمش مع شرائح دجاج مشوي ورقائق جبن بارميزان وخبز محمص، يُغطّى بصوص سيزر الكريمي.', ['خس روماني', 'دجاج مشوي', 'جبن بارميزان', 'خبز محمص', 'صوص سيزر']],
    'بطاطس مقلية': ['شرائح بطاطس ذهبية مقرمشة من الخارج وطرية من الداخل، مع ملح البحر وصوص كاتشب.', ['بطاطس', 'زيت نباتي', 'ملح']],
    'كبسة دجاج': ['نصف دجاجة متبّلة تُطهى ببطء مع أرز بسمتي وبهارات الكبسة، وتُقدَّم مع سلطة وصلصة حارة.', ['دجاج', 'أرز بسمتي', 'بصل', 'طماطم', 'بهارات الكبسة', 'لوز محمص']],
    'مندي لحم': ['لحم غنم طري مطهو على الطريقة اليمنية فوق أرز المندي المدخّن بنكهة الفحم.', ['لحم غنم', 'أرز مندي', 'بهارات المندي', 'سمن']],
    'باستا ألفريدو': ['باستا فيتوتشيني بصوص كريمة وجبن بارميزان مع قطع دجاج مشوي وفطر.', ['باستا فيتوتشيني', 'كريمة طبخ', 'دجاج', 'جبن بارميزان', 'فطر', 'ثوم']],
    'برجر لحم': ['قطعة لحم بقري 150 غ مشوية على الجمر في خبز برجر طازج مع جبن شيدر وخس وطماطم وصوص خاص.', ['لحم بقري 150 غ', 'خبز برجر', 'جبن شيدر', 'خس', 'طماطم', 'صوص خاص']],
    'برجر دجاج': ['صدر دجاج متبّل ومقرمش في خبز برجر مع خس ومخلل وصوص الثوم.', ['صدر دجاج', 'خبز برجر', 'خس', 'مخلل', 'صوص الثوم']],
    'شاورما دجاج': ['شرائح دجاج متبّلة تُشوى على السيخ، تُلَفّ بخبز الصاج مع ثوم ومخلل وبطاطس.', ['دجاج', 'خبز صاج', 'صوص الثوم', 'مخلل', 'بطاطس']],
    'مشاوي مشكلة': ['تشكيلة من الكباب وشيش الطاووق والأوصال مشوية على الفحم، مع أرز وسلطة وخبز.', ['كباب لحم', 'شيش طاووق', 'أوصال', 'أرز', 'سلطة', 'خبز']],
    'كنافة': ['كنافة ناعمة بالجبن الطري تُخبز حتى تتذهّب وتُسقى بالقطر الدافئ.', ['كنافة', 'جبن', 'قطر', 'فستق حلبي']],
    'كيك الشوكولاتة': ['طبقات من كيك الشوكولاتة الغنية مع كريمة الشوكولاتة البلجيكية.', ['شوكولاتة بلجيكية', 'دقيق', 'حليب', 'بيض', 'كاكاو']],
  };
  for (const [name, [details, comps]] of Object.entries(info)) run('UPDATE menu_items SET details = ?, components = ? WHERE name = ?', details, JSON.stringify(comps), name);

  seedHr();

  for (let i = 1; i <= 10; i++) run('INSERT INTO dining_tables(name, seats, area) VALUES(?,?,?)', `طاولة ${i}`, i % 3 === 0 ? 6 : 4, 'الصالة');
  for (let i = 1; i <= 4; i++) run('INSERT INTO dining_tables(name, seats, area) VALUES(?,?,?)', `ت ${i}`, 4, 'الجلسات الخارجية');
  for (let i = 1; i <= 3; i++) run('INSERT INTO dining_tables(name, seats, area) VALUES(?,?,?)', `VIP ${i}`, 8, 'العائلات');
}

/** موظفون ومستندات وسجل حضور لآخر أسبوعين (بيانات تجريبية) */
function seedHr() {
  const p2 = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  const uid = (u) => get('SELECT id FROM users WHERE username = ?', u)?.id ?? null;

  // [الحساب، الاسم، الوظيفة، القسم، الراتب، البدلات، بداية الدوام، نهاية الدوام، الجنسية]
  const staff = [
    ['manager', 'خالد العتيبي', 'مدير الفرع', 'الإدارة', 9000, 2000, '09:00', '18:00', 'سعودي'],
    ['cashier', 'سارة القحطاني', 'كاشير', 'الصالة', 4500, 800, '12:00', '21:00', 'سعودية'],
    ['waiter', 'أحمد محمود', 'موظف', 'الصالة', 3200, 600, '12:00', '21:00', 'مصري'],
    ['kitchen', 'رامي حداد', 'رئيس الطهاة', 'المطبخ', 7000, 1200, '10:00', '19:00', 'لبناني'],
    [null, 'محمد إقبال', 'طباخ', 'المطبخ', 3500, 500, '10:00', '19:00', 'باكستاني'],
    [null, 'جون سانتوس', 'عامل نظافة', 'الخدمات', 2200, 400, '08:00', '17:00', 'فلبيني'],
  ];
  const ids = [];
  staff.forEach(([u, name, job, dept, sal, allow, ws, we, nat], i) => {
    const id = Number(run(`INSERT INTO employees(user_id, name, job_title, department, phone, nationality, national_id, hire_date, contract_end,
      basic_salary, allowances, work_start, work_end, weekly_off, annual_leave_days, emergency_contact)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      u ? uid(u) : null, name, job, dept, `05${p2(10 + i)}${String(1234567 + i * 1111).slice(0, 7)}`, nat, String(2400000000 + i * 1357913),
      fmt(addDays(-400 - i * 60)), fmt(addDays(i === 4 ? 20 : 300 + i * 30)), sal, allow, ws, we, i % 2 ? '5' : '6', 21, `قريب: 0500000${100 + i}`).lastInsertRowid);
    ids.push(id);
    run("INSERT INTO employee_documents(employee_id, doc_type, title, number, expiry_date) VALUES(?, 'id', ?, ?, ?)",
      id, nat.startsWith('سعودي') ? 'الهوية الوطنية' : 'الإقامة', String(2400000000 + i * 1357913), fmt(addDays(i === 2 ? 12 : 200 + i * 40)));
    run("INSERT INTO employee_documents(employee_id, doc_type, title, expiry_date) VALUES(?, 'health', 'الشهادة الصحية', ?)",
      id, fmt(addDays(i === 5 ? -3 : 90 + i * 20)));
  });

  // سجل حضور لآخر 14 يوماً
  ids.forEach((id, i) => {
    const e = get('SELECT * FROM employees WHERE id = ?', id);
    const off = e.weekly_off.split(',').map(Number);
    const [sh, sm] = e.work_start.split(':').map(Number);
    const [eh] = e.work_end.split(':').map(Number);
    for (let d = 14; d >= 1; d--) {
      const day = addDays(-d);
      if (off.includes(day.getDay())) continue;
      if ((i + d) % 11 === 0) continue; // غياب أحياناً
      const late = (i * 7 + d * 5) % 23 > 17 ? 12 + ((i + d) % 25) : (d % 4);
      const inMin = sh * 60 + sm + late;
      const outMin = eh * 60 + ((i + d) % 3) * 10;
      const ds = fmt(day);
      const ci = `${ds} ${p2(Math.floor(inMin / 60))}:${p2(inMin % 60)}:00`;
      const co = `${ds} ${p2(Math.floor(outMin / 60))}:${p2(outMin % 60)}:00`;
      run("INSERT INTO attendance(employee_id, date, check_in, check_out, status, late_minutes, worked_minutes, source) VALUES(?,?,?,?, 'present', ?, ?, 'seed')",
        id, ds, ci, co, late > 10 ? late : 0, outMin - inMin);
    }
  });

  run("INSERT INTO leaves(employee_id, type, start_date, end_date, days, reason, status) VALUES(?, 'annual', ?, ?, 3, 'سفر عائلي', 'pending')",
    ids[2], fmt(addDays(10)), fmt(addDays(12)));
  run("INSERT INTO leaves(employee_id, type, start_date, end_date, days, reason, status) VALUES(?, 'sick', ?, ?, 1, 'مراجعة طبية', 'approved')",
    ids[4], fmt(addDays(-6)), fmt(addDays(-6)));
}
