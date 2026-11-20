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
  // [الاسم، الوحدة، الرصيد، الحد الأدنى، التكلفة، المجموعة، التخزين، المستهدف، المورد، الصلاحية بالأيام]
  const ingredients = [
    ['دجاج', 'كغ', 20, 5, 18, 'لحوم ودواجن', 'مبرد', 40, 0, 4], ['لحم بقري', 'كغ', 15, 4, 40, 'لحوم ودواجن', 'مبرد', 30, 0, 5], ['خبز برجر', 'حبة', 100, 30, 1, 'مخبوزات', 'جاف', 200, 1, 5],
    ['خبز صاج', 'حبة', 150, 40, 0.5, 'مخبوزات', 'جاف', 300, 1, 4], ['جبن شيدر', 'كغ', 5, 1, 30, 'ألبان وبيض', 'مبرد', 10, 2, 45], ['بطاطس', 'كغ', 25, 8, 5, 'خضار وفواكه', 'جاف', 50, 3, 14],
    ['أرز', 'كغ', 30, 10, 6, 'مواد جافة', 'جاف', 60, 2, 365], ['خس', 'كغ', 5, 2, 8, 'خضار وفواكه', 'مبرد', 10, 3, 5], ['طماطم', 'كغ', 8, 3, 6, 'خضار وفواكه', 'مبرد', 15, 3, 6],
    ['حليب', 'لتر', 20, 5, 5, 'ألبان وبيض', 'مبرد', 40, 2, 7], ['قهوة', 'كغ', 0.9, 1, 80, 'مشروبات', 'جاف', 6, 2, 180], ['ليمون', 'كغ', 6, 2, 7, 'خضار وفواكه', 'مبرد', 12, 3, 14],
    ['سكر', 'كغ', 10, 3, 4, 'مواد جافة', 'جاف', 20, 2, 540], ['شوكولاتة', 'كغ', 3, 1, 45, 'مواد جافة', 'جاف', 6, 2, 240], ['دقيق', 'كغ', 20, 5, 3, 'مواد جافة', 'جاف', 40, 2, 180],
    ['زيت قلي', 'لتر', 25, 8, 6, 'مواد جافة', 'جاف', 50, 2, 300], ['صلصة الثوم', 'كغ', 1, 1.5, 14, 'صلصات وتوابل', 'مبرد', 8, 2, 20], ['علب تغليف', 'حبة', 120, 150, 0.35, 'تغليف ومستهلكات', 'جاف', 800, 2, null],
  ];
  const sup = [['مزرعة الوادي للدواجن واللحوم', '0501110001', 'أبو سعود'], ['مخبز النخبة', '0502220002', 'م. خالد'], ['شركة الخير للمواد الغذائية', '0503330003', 'قسم المبيعات'], ['سوق الخضار المركزي', '0504440004', 'أبو ياسر']]
    .map(([n, p, c]) => Number(run('INSERT INTO suppliers(name, phone, contact) VALUES(?,?,?)', n, p, c).lastInsertRowid));
  for (const [name, unit, stock, min, cost, cat, storage, par, si, life] of ingredients) {
    ing[name] = Number(run('INSERT INTO ingredients(name, unit, stock, min_stock, cost_per_unit, category, storage, par_level, supplier_id, shelf_life_days) VALUES(?,?,?,?,?,?,?,?,?,?)', name, unit, stock, min, cost, cat, storage, par, sup[si], life).lastInsertRowid);
  }
  seedInventory(ingredients, ing, sup);

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


/** مخزون تجريبي واقعي: دفعتان لكل مادة بتواريخ صلاحية، استلامات من الموردين، واستهلاك وتالف وصرف لآخر 14 يوماً بأرصدة متسقة */
function seedInventory(ingredients, ing, sup) {
  const pad = (n) => String(n).padStart(2, '0');
  const dayStr = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  let seedN = 7;
  const rnd = () => { seedN = (seedN * 9301 + 49297) % 233280; return seedN / 233280; };
  const kitchen = get("SELECT id FROM users WHERE username = 'kitchen'")?.id || 1;
  const admin = get("SELECT id FROM users WHERE username = 'admin'")?.id || 1;
  // حالات توضّح التنبيهات: [المادة] → [المتبقي في الدفعة القديمة، يوم انتهاء القديمة، يوم انتهاء الجديدة]
  const special = { 'خس': [1.2, -1, 3], 'حليب': [6, 2, 6], 'دجاج': [5, 1, 3], 'طماطم': [2, 2, 5], 'لحم بقري': [4, 3, 4], 'صلصة الثوم': [1, 4, 18] };
  const receipts = {};
  const rec = (supId, off, inv) => {
    const key = `${supId}:${off}`;
    if (!receipts[key]) receipts[key] = Number(run('INSERT INTO stock_receipts(supplier_id, invoice_no, received_at, user_id, created_at) VALUES(?,?,?,?,?)', supId, `${inv}-${1000 + Object.keys(receipts).length * 37}`, dayStr(off), admin, `${dayStr(off)} 09:15:00`).lastInsertRowid);
    return receipts[key];
  };
  const moves = [];
  const wasteReasons = ['انتهاء الصلاحية', 'تلف / فساد', 'سوء تخزين', 'خطأ في التحضير', 'سقوط / انسكاب'];
  const issueReasons = ['ضيافة', 'تحضير داخلي', 'عينات وتجارب'];
  for (const [name, unit, stock, min, cost, , , , si, life] of ingredients) {
    const id = ing[name];
    const supId = sup[si];
    const sp = special[name];
    const leftA = sp ? sp[0] : Math.round(stock * 0.3 * 100) / 100;
    const leftB = Math.round((stock - leftA) * 1000) / 1000;
    // الاستهلاك على 14 يوماً
    const daily = Math.max(stock * 0.045, min * 0.25);
    const rows = [];
    for (let d = 13; d >= 0; d--) {
      const q = Math.round(daily * (0.6 + rnd() * 0.9) * 100) / 100;
      rows.push({ off: -d, type: 'sale', qty: -q, time: `${pad(12 + Math.floor(rnd() * 9))}:${pad(Math.floor(rnd() * 60))}:${pad(Math.floor(rnd() * 60))}` });
    }
    for (let k = 0; k < (life && life < 10 ? 3 : 1); k++) {
      const q = Math.round(Math.min(stock * 0.08, 0.6) * (0.5 + rnd()) * 100) / 100;
      if (q > 0) rows.push({ off: -(1 + Math.floor(rnd() * 11)), type: 'waste', qty: -q, reason: wasteReasons[Math.floor(rnd() * wasteReasons.length)], time: `${pad(10 + Math.floor(rnd() * 10))}:${pad(Math.floor(rnd() * 60))}:00` });
    }
    if (rnd() > 0.55) rows.push({ off: -(1 + Math.floor(rnd() * 9)), type: 'issue', qty: -Math.round(Math.max(0.2, daily * 0.5) * 100) / 100, reason: issueReasons[Math.floor(rnd() * 3)], time: '16:30:00' });
    const out = rows.reduce((a, r) => a - r.qty, 0);
    // رصيد افتتاحي يغطي ما صُرف قبل أول استلام في الكشف
    const before = rows.filter((r) => r.off < -8 || (r.off === -8 && r.time < '09:15:00')).reduce((a, r) => a - r.qty, 0);
    const opening = Math.round(before * 1000) / 1000;
    if (opening > 0) rows.push({ off: -14, type: 'adjust', qty: opening, reason: 'رصيد افتتاحي', time: '08:00:00' });
    // الدفعة القديمة وصلت قبل 8 أيام، والجديدة قبل يومين
    const inA = Math.round((leftA + (out - opening) * 0.75) * 1000) / 1000;
    const inB = Math.round((leftB + (out - opening) * 0.25) * 1000) / 1000;
    const expA = life ? dayStr(sp ? sp[1] : -8 + Math.round(life * 0.7)) : null;
    const expB = life ? dayStr(sp ? sp[2] : -2 + life) : null;
    const bA = Number(run('INSERT INTO stock_batches(ingredient_id, receipt_id, supplier_id, qty_in, qty_left, unit_cost, received_at, expiry_date) VALUES(?,?,?,?,?,?,?,?)', id, rec(supId, -8, 'INV'), supId, inA, leftA, cost, dayStr(-8), expA).lastInsertRowid);
    const bB = Number(run('INSERT INTO stock_batches(ingredient_id, receipt_id, supplier_id, qty_in, qty_left, unit_cost, received_at, expiry_date) VALUES(?,?,?,?,?,?,?,?)', id, rec(supId, -2, 'INV'), supId, inB, leftB, cost, dayStr(-2), expB).lastInsertRowid);
    rows.push({ off: -8, type: 'purchase', qty: inA, time: '09:15:00', batch: bA, receipt: rec(supId, -8, 'INV'), sup: supId });
    rows.push({ off: -2, type: 'purchase', qty: inB, time: '09:15:00', batch: bB, receipt: rec(supId, -2, 'INV'), sup: supId });
    // أرصدة متسقة: نحسبها من الرصيد الحالي رجوعاً
    rows.sort((a, b) => (a.off - b.off) || a.time.localeCompare(b.time) || ((a.type === 'purchase' || a.type === 'adjust') ? -1 : 1));
    let bal = stock;
    for (let i = rows.length - 1; i >= 0; i--) { rows[i].bal = Math.round(bal * 1000) / 1000; bal -= rows[i].qty; }
    for (const r of rows) moves.push({ id, cost, supId, ...r });
  }
  for (const m of moves) {
    run('INSERT INTO stock_movements(ingredient_id, qty, type, unit_cost, user_id, created_at, reason, batch_id, receipt_id, supplier_id, balance_after) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      m.id, m.qty, m.type, m.cost, m.type === 'purchase' ? admin : kitchen, `${dayStr(m.off)} ${m.time}`, m.reason || null, m.batch || null, m.receipt || null, m.type === 'purchase' ? m.sup : null, m.bal);
  }
  for (const [key, id] of Object.entries(receipts)) {
    run('UPDATE stock_receipts SET total = (SELECT ROUND(SUM(qty_in * unit_cost), 2) FROM stock_batches WHERE receipt_id = ?) WHERE id = ?', id, id);
  }
}
